#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  fileSha256,
  readProtectedEnvironment,
  validatePreparedCandidateSnapshot,
  validateRehearsalConfiguration,
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

function publishMarker(path, evidence) {
  if (!path) throw new Error("rehearsal start marker path is required");
  if (existsSync(path)) throw new Error("rehearsal start marker already exists");
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.partial`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(evidence)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporaryPath, path);
    unlinkSync(temporaryPath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
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

  const production = process.env.NODE_ENV !== "test";
  const dockerBinary = production
    ? "/usr/bin/docker"
    : (process.env.UWPLAN_AUTH_REHEARSAL_DOCKER_BIN ?? "docker");
  const composeFile = production
    ? "/opt/uwplan/current/compose.yaml"
    : (process.env.UWPLAN_AUTH_REHEARSAL_COMPOSE_FILE ?? "compose.yaml");
  const runtimeEnvironment = production
    ? "/etc/uwplan/runtime.env"
    : (process.env.UWPLAN_AUTH_REHEARSAL_RUNTIME_ENV ?? "");
  const releaseEnvironment = production
    ? "/var/lib/uwplan-runtime/release.env"
    : (process.env.UWPLAN_AUTH_REHEARSAL_RELEASE_ENV ?? "");
  readProtectedEnvironment(runtimeEnvironment);
  readProtectedEnvironment(releaseEnvironment);
  const markerPath = operatorEnvironment.UWPLAN_AUTH_START_MARKER_FILE;
  if (!markerPath) throw new Error("rehearsal start marker path is required");
  if (existsSync(markerPath)) {
    throw new Error("rehearsal start marker already exists");
  }

  const environment = {
    ...process.env,
    UWPLAN_REHEARSAL_ENV_FILE:
      operatorEnvironment.UWPLAN_REHEARSAL_APP_ENV_FILE,
  };
  const compose = [
    "compose",
    "--file",
    composeFile,
    "--env-file",
    runtimeEnvironment,
    "--env-file",
    releaseEnvironment,
    "--profile",
    "rehearsal",
  ];

  runDocker(
    dockerBinary,
    [...compose, "up", "--detach", "--wait", "db", "alloy"],
    environment,
    "rehearsal dependencies failed to start",
  );
  const rawSnapshot = runDocker(
    dockerBinary,
    [
      ...compose,
      "run",
      "--rm",
      "--no-deps",
      "rehearsal-app",
      "node",
      "/app/ops/auth-rehearsal/snapshot.mjs",
      "prepared",
    ],
    environment,
    "candidate database preflight failed",
  );
  let snapshot;
  try {
    snapshot = JSON.parse(rawSnapshot);
  } catch {
    throw new Error("candidate database preflight was not valid JSON");
  }
  validatePreparedCandidateSnapshot(configuration.authScrub, snapshot);

  let appStartAttempted = false;
  try {
    appStartAttempted = true;
    runDocker(
      dockerBinary,
      [...compose, "up", "--detach", "--wait", "rehearsal-app"],
      environment,
      "rehearsal application failed to start",
    );
    const containerId = runDocker(
      dockerBinary,
      [...compose, "ps", "--quiet", "rehearsal-app"],
      environment,
      "rehearsal application identity is unavailable",
    );
    const imageId = runDocker(
      dockerBinary,
      ["inspect", "--format", "{{.Image}}", containerId],
      environment,
      "rehearsal application image identity is unavailable",
    );
    const startedAt = runDocker(
      dockerBinary,
      ["inspect", "--format", "{{.State.StartedAt}}", containerId],
      environment,
      "rehearsal application start identity is unavailable",
    );
    const restartCount = Number(
      runDocker(
        dockerBinary,
        ["inspect", "--format", "{{.RestartCount}}", containerId],
        environment,
        "rehearsal application restart state is unavailable",
      ),
    );
    if (
      !/^[0-9a-f]{64}$/.test(containerId) ||
      !/^sha256:[0-9a-f]{64}$/.test(imageId) ||
      Number.isNaN(Date.parse(startedAt)) ||
      restartCount !== 0
    ) {
      throw new Error("rehearsal application identity is invalid");
    }

    const evidence = {
      schemaVersion: 1,
      event: "auth.rehearsal-start",
      status: "started",
      runId: configuration.runId,
      candidateDatabase: configuration.database,
      authScrubMarkerSha256: fileSha256(
        operatorEnvironment.UWPLAN_AUTH_SCRUB_MARKER_FILE,
      ),
      rehearsalEnvironmentSha256: fileSha256(
        operatorEnvironment.UWPLAN_REHEARSAL_APP_ENV_FILE,
      ),
      runtimeEnvironmentSha256: fileSha256(runtimeEnvironment),
      releaseEnvironmentSha256: fileSha256(releaseEnvironment),
      composeFileSha256: fileSha256(composeFile),
      containerId,
      imageId,
      startedAt,
      restartCount,
    };
    publishMarker(markerPath, evidence);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    if (appStartAttempted) {
      const cleanup = spawnSync(
        dockerBinary,
        [...compose, "rm", "--force", "--stop", "rehearsal-app"],
        { encoding: "utf8", env: environment },
      );
      if (cleanup.error || cleanup.status !== 0) {
        throw new Error("rehearsal application emergency stop failed");
      }
    }
    throw error;
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "rehearsal start rejected");
});
