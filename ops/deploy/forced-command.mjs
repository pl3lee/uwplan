#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isDigest,
  isRepository,
  isRevision,
  parseAdapterRequest,
  PRODUCTION_DISPATCHER,
  ROOT_COMPOSE_HELPER,
} from "./protocol.mjs";

const exit = {
  rejected: 64,
  unavailable: 69,
  temporaryFailure: 75,
};
const stateDirectory =
  process.env.UWPLAN_DEPLOY_STATE_DIR ?? "/var/lib/uwplan-deploy";
const statePath = join(stateDirectory, "state.json");
const evidencePath = join(stateDirectory, "evidence.jsonl");
const lockPath = join(stateDirectory, "deployment.lock");
const imageRepository =
  process.env.UWPLAN_IMAGE_REPOSITORY ?? "ghcr.io/pl3lee/uwplan";
const lockTimeoutMs = Number(
  process.env.UWPLAN_DEPLOY_LOCK_TIMEOUT_MS ?? "120000",
);
const sleepSignal = new Int32Array(new SharedArrayBuffer(4));
const disposableTestAdapter = (() => {
  const path = process.env.UWPLAN_DEPLOY_TEST_ADAPTER;
  if (
    realpathSync(process.argv[1]) !== PRODUCTION_DISPATCHER &&
    process.env.NODE_ENV === "test" &&
    path?.startsWith(`${tmpdir()}/`) &&
    stateDirectory.startsWith(`${tmpdir()}/`)
  ) {
    return path;
  }
  return null;
})();

class CommandError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}

function initialState() {
  return {
    schemaVersion: 1,
    frozen: false,
    previous: null,
    current: null,
    lastAttempt: null,
  };
}

function ensureStateDirectory() {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  chmodSync(stateDirectory, 0o700);
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.schemaVersion !== 1 || typeof state.frozen !== "boolean") {
      throw new Error("unsupported state schema");
    }
    return state;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return initialState();
    }
    throw new CommandError("deployment state is unreadable", exit.unavailable);
  }
}

function writeState(state) {
  const temporaryPath = join(
    stateDirectory,
    `.state-${process.pid}-${Date.now()}.json`,
  );
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, statePath);
  chmodSync(statePath, 0o600);
}

function recordEvidence(event, status, details = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    service: "uwplan-deployer",
    event,
    status,
    details,
  };
  appendFileSync(evidencePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function acquireLock() {
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0) {
    throw new CommandError(
      "deployment lock timeout is invalid",
      exit.unavailable,
    );
  }
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      writeFileSync(join(lockPath, "owner"), `${process.pid}\n`, {
        mode: 0o600,
      });
      return;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new CommandError(
          "deployment lock timed out",
          exit.temporaryFailure,
        );
      }
      Atomics.wait(sleepSignal, 0, 0, Math.min(50, deadline - Date.now()));
    }
  }
}

function releaseLock() {
  rmSync(lockPath, { recursive: true, force: true });
}

function runAdapter(operation, release) {
  const requestArguments = [
    operation,
    imageRepository,
    release.digest,
    release.revision,
  ];
  if (!parseAdapterRequest(requestArguments)) return false;
  const result = spawnSync(
    disposableTestAdapter ?? "sudo",
    disposableTestAdapter
      ? requestArguments
      : ["-n", ROOT_COMPOSE_HELPER, ...requestArguments],
    {
      encoding: "utf8",
      env: process.env,
      timeout: 10 * 60 * 1000,
    },
  );
  return result.error === undefined && result.status === 0;
}

function deploymentAttempt(previous, candidate, outcome) {
  return {
    timestamp: new Date().toISOString(),
    previous,
    candidate,
    outcome,
    schemaRollback: false,
  };
}

function deploy(digest, revision) {
  if (!isDigest(digest)) {
    throw new CommandError(
      "requested manifest digest is invalid",
      exit.rejected,
    );
  }
  if (!isRevision(revision)) {
    throw new CommandError(
      "requested release revision is invalid",
      exit.rejected,
    );
  }
  if (!isRepository(imageRepository)) {
    throw new CommandError(
      "configured image repository is invalid",
      exit.unavailable,
    );
  }

  ensureStateDirectory();
  acquireLock();
  try {
    const state = readState();
    if (state.frozen) {
      throw new CommandError("deployments are frozen", exit.temporaryFailure);
    }

    const candidate = { digest, revision };
    const previous = state.current;
    recordEvidence("deployment.requested", "accepted", {
      previous,
      candidate,
    });

    if (!runAdapter("migrate", candidate)) {
      state.lastAttempt = deploymentAttempt(
        previous,
        candidate,
        "migration-failed",
      );
      writeState(state);
      recordEvidence("deployment.migration", "rejected", {
        previous,
        candidate,
        appRecreated: false,
      });
      throw new CommandError("release migration failed", 1);
    }

    if (
      runAdapter("recreate-app", candidate) &&
      runAdapter("wait-ready", candidate)
    ) {
      state.previous = previous;
      state.current = candidate;
      state.lastAttempt = deploymentAttempt(previous, candidate, "deployed");
      writeState(state);
      recordEvidence("deployment.completed", "accepted", {
        previous,
        current: candidate,
      });
      return;
    }

    if (previous) {
      const rollbackHealthy =
        runAdapter("recreate-app", previous) &&
        runAdapter("wait-ready", previous);
      state.current = rollbackHealthy ? previous : null;
      state.lastAttempt = deploymentAttempt(
        previous,
        candidate,
        rollbackHealthy ? "readiness-rollback" : "rollback-failed",
      );
      writeState(state);
      recordEvidence("deployment.readiness", "rejected", {
        candidate,
        attemptedRestore: previous,
        restored: rollbackHealthy ? previous : null,
        rollbackHealthy,
        databaseSchemaReversed: false,
      });
      throw new CommandError(
        rollbackHealthy
          ? "release was unhealthy; previous app image restored without reversing database schema"
          : "release and previous app image both failed readiness",
        1,
      );
    }

    state.lastAttempt = deploymentAttempt(
      previous,
      candidate,
      "readiness-failed-no-previous-release",
    );
    writeState(state);
    recordEvidence("deployment.readiness", "rejected", {
      candidate,
      restored: null,
      databaseSchemaReversed: false,
    });
    throw new CommandError(
      "release was unhealthy and no previous app image is recorded",
      1,
    );
  } finally {
    releaseLock();
  }
}

function setFrozen(frozen) {
  ensureStateDirectory();
  acquireLock();
  try {
    const state = readState();
    const changed = state.frozen !== frozen;
    state.frozen = frozen;
    writeState(state);
    recordEvidence(
      frozen ? "deployment.frozen" : "deployment.thawed",
      "accepted",
      {
        changed,
        current: state.current,
        imageReleased: false,
      },
    );
  } finally {
    releaseLock();
  }
}

function parseOriginalCommand() {
  const original = process.env.SSH_ORIGINAL_COMMAND ?? "";
  if (/[^\x20-\x7e]/.test(original)) {
    throw new CommandError(
      "command contains invalid characters",
      exit.rejected,
    );
  }
  const tokens = original.trim().split(/ +/).filter(Boolean);
  if (tokens[0] === "deploy" && tokens.length === 3) {
    return { action: "deploy", digest: tokens[1], revision: tokens[2] };
  }
  if ((tokens[0] === "freeze" || tokens[0] === "thaw") && tokens.length === 1) {
    return { action: tokens[0] };
  }
  throw new CommandError("command is not permitted", exit.rejected);
}

try {
  const command = parseOriginalCommand();
  if (command.action === "deploy") deploy(command.digest, command.revision);
  else setFrozen(command.action === "freeze");
} catch (error) {
  if (error instanceof CommandError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write("deployment command failed safely\n");
    process.exitCode = 1;
  }
}
