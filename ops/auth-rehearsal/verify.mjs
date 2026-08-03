#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import {
  readProtectedEnvironment,
  readProtectedJson,
  validateRehearsalConfiguration,
  validateRehearsalEvidence,
  validateRehearsalStartMarker,
} from "./protocol.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runDocker(dockerBinary, args, environment, failureMessage, input) {
  const result = spawnSync(dockerBinary, args, {
    encoding: "utf8",
    env: environment,
    input,
  });
  if (result.error || result.status !== 0) throw new Error(failureMessage);
  return result.stdout.trim();
}

function runtimeConfiguration(operatorEnvironment) {
  const production = process.env.NODE_ENV !== "test";
  const result = {
    dockerBinary: production
      ? "/usr/bin/docker"
      : (process.env.UWPLAN_AUTH_REHEARSAL_DOCKER_BIN ?? "docker"),
    composeFile: production
      ? "/opt/uwplan/current/compose.yaml"
      : (process.env.UWPLAN_AUTH_REHEARSAL_COMPOSE_FILE ?? "compose.yaml"),
    runtimeEnvironment: production
      ? "/etc/uwplan/runtime.env"
      : (process.env.UWPLAN_AUTH_REHEARSAL_RUNTIME_ENV ?? ""),
    releaseEnvironment: production
      ? "/var/lib/uwplan-runtime/release.env"
      : (process.env.UWPLAN_AUTH_REHEARSAL_RELEASE_ENV ?? ""),
  };
  readProtectedEnvironment(result.runtimeEnvironment);
  readProtectedEnvironment(result.releaseEnvironment);
  result.environment = {
    ...process.env,
    UWPLAN_REHEARSAL_ENV_FILE:
      operatorEnvironment.UWPLAN_REHEARSAL_APP_ENV_FILE,
  };
  result.compose = [
    "compose",
    "--file",
    result.composeFile,
    "--env-file",
    result.runtimeEnvironment,
    "--env-file",
    result.releaseEnvironment,
    "--profile",
    "rehearsal",
  ];
  return result;
}

function runningRehearsal(configuration, operatorEnvironment) {
  const runtime = runtimeConfiguration(operatorEnvironment);
  const containerId = runDocker(
    runtime.dockerBinary,
    [...runtime.compose, "ps", "--quiet", "rehearsal-app"],
    runtime.environment,
    "running rehearsal application is unavailable",
  );
  const imageId = runDocker(
    runtime.dockerBinary,
    ["inspect", "--format", "{{.Image}}", containerId],
    runtime.environment,
    "running rehearsal image identity is unavailable",
  );
  const startedAt = runDocker(
    runtime.dockerBinary,
    ["inspect", "--format", "{{.State.StartedAt}}", containerId],
    runtime.environment,
    "running rehearsal start identity is unavailable",
  );
  const restartCount = Number(
    runDocker(
      runtime.dockerBinary,
      ["inspect", "--format", "{{.RestartCount}}", containerId],
      runtime.environment,
      "running rehearsal restart state is unavailable",
    ),
  );
  validateRehearsalStartMarker({
    configuration,
    operatorEnvironment,
    runtimeEnvironmentPath: runtime.runtimeEnvironment,
    releaseEnvironmentPath: runtime.releaseEnvironment,
    composeFilePath: runtime.composeFile,
    containerId,
    imageId,
    startedAt,
    restartCount,
  });
  return { ...runtime, containerId };
}

function databaseSnapshot(runtime, configuration) {
  const rawSnapshot = runDocker(
    runtime.dockerBinary,
    [
      "exec",
      "--interactive",
      runtime.containerId,
      "node",
      "/app/ops/auth-rehearsal/snapshot.mjs",
      "acceptance",
    ],
    runtime.environment,
    "candidate database acceptance snapshot failed",
    JSON.stringify(configuration.identities),
  );
  try {
    return JSON.parse(rawSnapshot);
  } catch {
    throw new Error("candidate database acceptance snapshot was not valid JSON");
  }
}

async function verifyHttpBoundary(configuration, sensitiveValues) {
  const request = async (path, credentials) => {
    const headers = {};
    if (credentials) {
      headers.authorization = `Basic ${Buffer.from(
        `${credentials.user}:${credentials.password}`,
      ).toString("base64")}`;
    }
    const response = await fetch(`${configuration.publicUrl}${path}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (sensitiveValues.some((value) => value && body.includes(value))) {
      throw new Error("rehearsal HTTP response exposed protected data");
    }
    return { status: response.status, body };
  };

  const readiness = await request("/api/ready");
  const missing = await request("/signin");
  const wrong = await request("/api/auth/callback/google", {
    user: configuration.basicUser,
    password: `${configuration.basicPassword}-wrong`,
  });
  const accepted = await request("/signin", {
    user: configuration.basicUser,
    password: configuration.basicPassword,
  });
  const stripped = await request("/api/rehearsal/request-boundary", {
    user: configuration.basicUser,
    password: configuration.basicPassword,
  });

  let strippedBody;
  try {
    strippedBody = JSON.parse(stripped.body);
  } catch {
    throw new Error("rehearsal request-boundary proof was not JSON");
  }
  if (
    readiness.status !== 200 ||
    missing.status !== 401 ||
    wrong.status !== 401 ||
    accepted.status !== 200 ||
    stripped.status !== 200 ||
    strippedBody?.status !== "accepted" ||
    strippedBody?.authorization !== "absent" ||
    strippedBody?.boundary !== "rehearsal-basic-auth" ||
    missing.body.includes("Sign in to your account") ||
    wrong.body.includes("Sign in to your account")
  ) {
    throw new Error("rehearsal Caddy authentication boundary failed");
  }
}

async function main() {
  const operatorEnvironment = readProtectedEnvironment(
    process.env.UWPLAN_AUTH_REHEARSAL_ENV_FILE,
  );
  const rehearsalEnvironment = readProtectedEnvironment(
    operatorEnvironment.UWPLAN_REHEARSAL_APP_ENV_FILE,
  );
  const configuration = validateRehearsalConfiguration(
    rehearsalEnvironment,
    operatorEnvironment,
  );
  const attestation = readProtectedJson(
    operatorEnvironment.UWPLAN_REHEARSAL_ATTESTATION_FILE,
    "browser attestation",
  );
  const sensitiveValues = [
    ...Object.values(rehearsalEnvironment),
    ...Object.values(configuration.identities).map(({ email }) => email),
    configuration.basicPassword,
  ].filter((value) => typeof value === "string" && value.length >= 6);

  const runtime = runningRehearsal(configuration, operatorEnvironment);
  await verifyHttpBoundary(configuration, sensitiveValues);
  const snapshot = databaseSnapshot(runtime, configuration);
  const evidence = validateRehearsalEvidence(
    configuration,
    snapshot,
    attestation,
  );
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "auth rehearsal failed");
});
