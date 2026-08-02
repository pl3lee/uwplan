#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  initialWatchdogState,
  runWatchdogCycle,
  validateWatchdogState,
} from "./watchdog-lib.mjs";

const stateDirectory = "/var/lib/uwplan-watchdog";
const statePath = join(stateDirectory, "state.json");
const evidencePath = join(stateDirectory, "evidence.jsonl");
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

function ensureStateDirectory() {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  chmodSync(stateDirectory, 0o700);
}

function readState() {
  try {
    return validateWatchdogState(JSON.parse(readFileSync(statePath, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return initialWatchdogState();
    }
    throw new Error("watchdog state is unreadable");
  }
}

function writeState(state) {
  const temporary = `${statePath}.${process.pid}.${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, statePath);
  chmodSync(statePath, 0o600);
}

function compose(args) {
  return spawnSync("docker", [...composeArguments, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
    timeout: 20_000,
  });
}

async function appIsHealthy() {
  try {
    const response = await fetch("http://127.0.0.1:5000/api/live", {
      signal: AbortSignal.timeout(3_000),
    });
    const body = await response.json();
    return response.ok && body?.status === "live";
  } catch {
    return false;
  }
}

function databaseIsHealthy() {
  const result = compose([
    "exec",
    "--no-TTY",
    "db",
    "pg_isready",
    "--username=uwplan_app",
    "--dbname=uwplan",
  ]);
  return result.error === undefined && result.status === 0;
}

function restartCounters() {
  const counters = { app: 0, db: 0, alloy: 0 };
  for (const service of Object.keys(counters)) {
    const id = compose(["ps", "--quiet", service]).stdout.trim();
    if (!id) continue;
    const result = spawnSync(
      "docker",
      ["inspect", "--format", "{{.RestartCount}}", id],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH },
        timeout: 5_000,
      },
    );
    const value = Number(result.stdout.trim());
    if (result.status === 0 && Number.isSafeInteger(value) && value >= 0) {
      counters[service] = value;
    }
  }
  return counters;
}

function record(entry) {
  const serialized = `${JSON.stringify(entry)}\n`;
  appendFileSync(evidencePath, serialized, { mode: 0o600 });
  process.stdout.write(serialized);
}

async function main() {
  if (process.getuid?.() !== 0) {
    throw new Error("the host watchdog must run as root");
  }
  ensureStateDirectory();
  const state = readState();
  const result = await runWatchdogCycle({
    state,
    timestamp: new Date().toISOString(),
    appHealthy: await appIsHealthy(),
    databaseHealthy: databaseIsHealthy(),
    restartCounters: restartCounters(),
    restartApp: async () => {
      const restarted = compose(["restart", "app"]);
      if (restarted.error !== undefined || restarted.status !== 0) {
        throw new Error("app-only Compose restart failed");
      }
    },
    publishAlert: async () => {},
  });
  writeState(result.state);
  result.events.forEach(record);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "watchdog failed"}\n`,
  );
  process.exitCode = 1;
});
