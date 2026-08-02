#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runControlledFailureInjection } from "./watchdog-lib.mjs";

const environment = process.env.UWPLAN_FAILURE_INJECTION_ENVIRONMENT;
const host = process.env.UWPLAN_FAILURE_INJECTION_HOST;
const markerPath = "/etc/uwplan/allow-rehearsal-failure-injection";
const composeArguments = [
  "compose",
  "--project-name",
  "uwplan",
  "--file",
  "/opt/uwplan/current/compose.yaml",
  "--env-file",
  "/etc/uwplan/runtime.env",
  "--env-file",
  "/var/lib/uwplan-runtime/release.env",
];

function compose(args) {
  return spawnSync("docker", [...composeArguments, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
    timeout: 20_000,
  });
}

function databaseRestartCounter() {
  const id = compose(["ps", "--quiet", "db"]).stdout.trim();
  if (!id) throw new Error("rehearsal database container is unavailable");
  const result = spawnSync(
    "docker",
    ["inspect", "--format", "{{.RestartCount}}", id],
    { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 5_000 },
  );
  const counter = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("rehearsal database restart counter is unavailable");
  }
  return counter;
}

async function waitForAppRecovery() {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:5000/api/live", {
        signal: AbortSignal.timeout(3_000),
      });
      const body = await response.json();
      if (response.ok && body?.status === "live") {
        return Date.now() - startedAt;
      }
    } catch {
      // The bounded operational drill waits for the restarted app below.
    }
    if (attempt < 59) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error("rehearsal app did not recover within two minutes");
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("failure injection accepts no arguments");
  }
  if (process.getuid?.() !== 0) {
    throw new Error("failure injection must run as root");
  }
  let marker;
  try {
    marker = readFileSync(markerPath, "utf8").trim();
  } catch {
    throw new Error("rehearsal failure-injection marker is missing");
  }
  if (marker !== "v2.uwplan.com") {
    throw new Error("rehearsal failure-injection marker is invalid");
  }

  let appRecoveryMilliseconds = null;
  const result = await runControlledFailureInjection({
    environment,
    host,
    restartApp: async () => {
      const restarted = compose(["restart", "app"]);
      if (restarted.error !== undefined || restarted.status !== 0) {
        throw new Error("rehearsal app-only restart failed");
      }
      appRecoveryMilliseconds = await waitForAppRecovery();
    },
    publishAlert: async (entry) => {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    },
    readDatabaseRestartCounter: async () => databaseRestartCounter(),
  });
  if (
    !result.appRecoveryRequested ||
    !result.databaseFailureAlerted ||
    result.databaseRestarted ||
    appRecoveryMilliseconds === null
  ) {
    throw new Error(
      "controlled failure injection did not satisfy recovery gates",
    );
  }
  process.stdout.write(
    `${JSON.stringify({ ...result, appRecoveryConfirmed: true, appRecoveryMilliseconds })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "failure injection failed"}\n`,
  );
  process.exitCode = 1;
});
