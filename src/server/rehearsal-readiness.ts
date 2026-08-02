import { randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";

import { isValidationId } from "@/lib/validation-id";
import { writeStructuredLog } from "@/lib/structured-log";

type FailureState = "ready" | "unready";

interface RehearsalConfiguration {
  host: string;
  stateFile: string;
  token: string;
}

interface StoredState {
  schemaVersion: 1;
  state: FailureState;
  validationId: string;
}

function isStoredState(value: unknown): value is StoredState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    (candidate.state === "ready" || candidate.state === "unready") &&
    isValidationId(candidate.validationId)
  );
}

function configuredHost(request: Request) {
  return (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
}

function configuration():
  | { status: "disabled" }
  | { status: "invalid"; host?: string }
  | { status: "enabled"; value: RehearsalConfiguration } {
  if (process.env.UWPLAN_REHEARSAL_FAILURE_CONTROL_ENABLED !== "true") {
    return { status: "disabled" };
  }
  const host = (process.env.UWPLAN_REHEARSAL_HOST ?? "").toLowerCase();
  const token = process.env.UWPLAN_REHEARSAL_FAILURE_CONTROL_TOKEN ?? "";
  const stateFile = process.env.UWPLAN_REHEARSAL_FAILURE_STATE_FILE ?? "";
  if (
    process.env.UWPLAN_DEPLOYMENT_ENVIRONMENT !== "rehearsal" ||
    !/^[a-z0-9.-]{1,253}$/.test(host) ||
    host === "uwplan.com" ||
    host === "www.uwplan.com" ||
    token.length < 32 ||
    token.length > 256 ||
    /\s/.test(token) ||
    !isAbsolute(stateFile) ||
    !/^uwplan-rehearsal-[a-zA-Z0-9._-]+\.json$/.test(basename(stateFile))
  ) {
    return { status: "invalid", ...(host ? { host } : {}) };
  }
  return { status: "enabled", value: { host, stateFile, token } };
}

function authorized(request: Request, expected: string) {
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  const supplied = Buffer.from(authorization.slice(prefix.length));
  const target = Buffer.from(expected);
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}

async function writeState(
  stateFile: string,
  state: FailureState,
  validationId: string,
) {
  const temporary = `${stateFile}.${randomUUID()}`;
  try {
    await writeFile(
      temporary,
      `${JSON.stringify({ schemaVersion: 1, state, validationId })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    await rename(temporary, stateFile);
    await chmod(stateFile, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function setRehearsalReadiness(
  request: Request,
  body: unknown,
): Promise<
  | { status: "not-found" }
  | { status: "invalid-request" }
  | { status: "changed"; state: FailureState; validationId: string }
> {
  const configured = configuration();
  if (
    configured.status !== "enabled" ||
    configuredHost(request) !== configured.value.host ||
    !authorized(request, configured.value.token)
  ) {
    return { status: "not-found" };
  }
  if (
    !body ||
    typeof body !== "object" ||
    !(
      (body as { state?: unknown }).state === "ready" ||
      (body as { state?: unknown }).state === "unready"
    ) ||
    !isValidationId((body as { validationId?: unknown }).validationId)
  ) {
    return { status: "invalid-request" };
  }
  const state = (body as { state: FailureState }).state;
  const validationId = (body as { validationId: string }).validationId;
  await writeState(configured.value.stateFile, state, validationId);
  writeStructuredLog("info", "rehearsal.readiness-control", {
    state,
    validation_id: validationId,
  });
  return { status: "changed", state, validationId };
}

export async function getRehearsalReadinessOverride(request: Request) {
  const configured = configuration();
  const host = configuredHost(request);
  if (host === "uwplan.com" || host === "www.uwplan.com") return false;
  if (configured.status === "disabled") return false;
  if (configured.status === "invalid") {
    return configured.host === host;
  }
  if (host !== configured.value.host) return false;
  try {
    const state = JSON.parse(
      await readFile(configured.value.stateFile, "utf8"),
    ) as unknown;
    if (!isStoredState(state)) return true;
    return state.state === "unready";
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    return true;
  }
}
