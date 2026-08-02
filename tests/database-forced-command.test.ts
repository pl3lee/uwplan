/** @jest-environment node */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dispatcher = join(process.cwd(), "ops/database/forced-command.mjs");
const runId = "20260802T203000000Z";
const proofRunId = "20260802T193000000Z";
const candidate = `uwplan_candidate_${proofRunId}`;

function run(original: string) {
  return spawnSync(process.execPath, [dispatcher], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      SSH_ORIGINAL_COMMAND: original,
    },
  });
}

describe("database forced SSH command", () => {
  it.each([
    ["capture-candidate", [candidate, proofRunId]],
    ["write-candidate-workflow", [candidate]],
    ["verify-candidate-workflow", [candidate, proofRunId]],
  ])("allows the fixed %s action with exact arguments", (action, args) => {
    const result = run(
      [
        "/opt/uwplan/current/ops/database/host-command.mjs",
        action,
        runId,
        ...args,
      ].join(" "),
    );
    expect(result.status).not.toBe(64);
    expect(result.stderr).not.toContain(
      "database migration SSH command rejected",
    );
  });

  it.each([
    `capture-candidate ${runId} ${candidate}`,
    `capture-candidate ${runId} ${candidate} bad-run`,
    `verify-candidate-workflow ${runId} production ${proofRunId}`,
    `write-candidate-workflow ${runId} ${candidate} extra`,
    `capture-candidate;touch /tmp/pwned ${runId} ${candidate} ${proofRunId}`,
  ])("rejects malformed command %s", (suffix) => {
    const result = run(
      `/opt/uwplan/current/ops/database/host-command.mjs ${suffix}`,
    );
    expect(result.status).toBe(64);
    expect(result.stderr).toBe("database migration SSH command rejected\n");
  });
});
