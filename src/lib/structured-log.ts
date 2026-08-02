import { getReleaseIdentity } from "./release";

type LogAttribute = string | number | boolean;

export function safeErrorType(error: unknown) {
  return error instanceof Error ? "Error" : "UnknownError";
}

export function writeStructuredLog(
  severity: "info" | "error",
  event: string,
  attributes: Record<string, LogAttribute> = {},
) {
  const release = getReleaseIdentity();
  const serialized = JSON.stringify({
    ...attributes,
    timestamp: new Date().toISOString(),
    severity,
    service: "uwplan",
    event,
    release_digest: release.digest,
    release_revision: release.revision,
  });

  if (severity === "error") console.error(serialized);
  else console.log(serialized);
}

export function writeApplicationError(
  event: string,
  error: unknown,
  attributes: Record<string, LogAttribute> = {},
) {
  writeStructuredLog("error", event, {
    ...attributes,
    error_type: safeErrorType(error),
  });
}
