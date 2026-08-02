#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const hostCommand = "/opt/uwplan/current/ops/database/host-command.mjs";
const original = process.env.SSH_ORIGINAL_COMMAND ?? "";
const fields = original.split(" ");
const [requestedCommand, action, runId, ...arguments_] = fields;
const expectedArguments = new Map([
  ["capture", 0],
  ["capture-candidate", 2],
  ["stream-manifest", 0],
  ["receive-manifest", 0],
  ["stream-archive", 0],
  ["receive-archive", 1],
  ["restore", 0],
  ["validate-integrity", 1],
  ["boot-candidate", 1],
  ["write-candidate-workflow", 1],
  ["verify-candidate-workflow", 2],
]);

if (
  requestedCommand !== hostCommand ||
  !expectedArguments.has(action) ||
  arguments_.length !== expectedArguments.get(action) ||
  !/^[0-9]{8}T[0-9]{9}Z$/.test(runId) ||
  (action === "receive-archive" && !/^[0-9a-f]{64}$/.test(arguments_[0])) ||
  (new Set([
    "boot-candidate",
    "capture-candidate",
    "validate-integrity",
    "verify-candidate-workflow",
    "write-candidate-workflow",
  ]).has(action) &&
    !/^uwplan_candidate_[0-9]{8}T[0-9]{9}Z$/.test(arguments_[0])) ||
  (new Set(["capture-candidate", "verify-candidate-workflow"]).has(action) &&
    !/^[0-9]{8}T[0-9]{9}Z$/.test(arguments_[1]))
) {
  process.stderr.write("database migration SSH command rejected\n");
  process.exit(64);
}

const result = spawnSync(
  process.execPath,
  [hostCommand, action, runId, ...arguments_],
  {
    stdio: "inherit",
    env: process.env,
  },
);
process.exit(result.status ?? 1);
