/** @jest-environment node */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const command = join(process.cwd(), "ops/database/host-command.mjs");
const runId = "20260802T203000000Z";
const candidateDatabase = `uwplan_candidate_${runId}`;
const digest = `sha256:${"e".repeat(64)}`;
const revision = "database-host-fixture";

function harness() {
  const root = mkdtempSync(join(tmpdir(), "uwplan-db-host-candidate-"));
  const stateRoot = join(root, "state");
  const runDirectory = join(stateRoot, runId);
  const appEnvironment = join(root, "app.env");
  const runtimeEnvironment = join(root, "runtime.env");
  const releaseEnvironment = join(root, "release.env");
  const dockerLog = join(root, "docker.jsonl");
  const docker = join(root, "fake-docker.mjs");
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(runDirectory, "integrity-accepted.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      candidateDatabase,
      status: "accepted",
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    appEnvironment,
    [
      "AUTH_SECRET=disposable-auth-secret",
      "DATABASE_URL=postgresql://uwplan_app:disposable-password@db:5432/uwplan",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(runtimeEnvironment, `UWPLAN_ENV_FILE=${appEnvironment}\n`, {
    mode: 0o600,
  });
  writeFileSync(
    releaseEnvironment,
    `RELEASE_DIGEST=${digest}\nRELEASE_REVISION=${revision}\nUWPLAN_IMAGE=fixture.invalid/image@${digest}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    docker,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(dockerLog)}, JSON.stringify(args) + "\\n");
if (args.includes("rm")) process.exit(process.env.FAKE_CANDIDATE_RM_FAIL === "1" ? 42 : 0);
if (args.includes("up")) process.exit(0);
if (args.includes("exec")) {
  const script = args.at(-1) ?? "";
  if (script.includes("/api/ready")) {
    process.stdout.write(JSON.stringify({ status: "ready", dependencies: { database: "available" }, release: { digest: process.env.RELEASE_DIGEST, revision: process.env.FAKE_READINESS_REVISION ?? process.env.RELEASE_REVISION } }));
  } else if (script.includes("/api/candidate/restore-proof")) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, event: "database.workflow-proof", status: "written", proofRunId: ${JSON.stringify(runId)}, candidateDatabase: ${JSON.stringify(candidateDatabase)}, applicationRole: "uwplan_app", workflow: "user-plan-schedule", recordCount: 3, proofSha256: "f".repeat(64) }));
  } else process.exit(64);
} else process.exit(64);
`,
  );
  chmodSync(docker, 0o700);

  return {
    run(extraEnvironment: Record<string, string> = {}) {
      return spawnSync(
        process.execPath,
        [command, "write-candidate-workflow", runId, candidateDatabase],
        {
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            UWPLAN_DB_STATE_ROOT: stateRoot,
            UWPLAN_DB_RUNTIME_ENV: runtimeEnvironment,
            UWPLAN_DB_RELEASE_ENV: releaseEnvironment,
            UWPLAN_DB_COMPOSE_FILE: join(root, "compose.yaml"),
            UWPLAN_DB_DOCKER_BIN: docker,
            COMPOSE_PROJECT_NAME: "uwplan-host-candidate-test",
            ...extraEnvironment,
          },
        },
      );
    },
    candidateEnvironment: join(runDirectory, "candidate-app.env"),
    releaseEnvironment,
    operations() {
      if (!existsSync(dockerLog)) return [];
      return readFileSync(dockerLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("candidate host workflow lifecycle", () => {
  it("removes the token-bearing environment after accepted application writes", () => {
    const test = harness();
    try {
      const result = test.run();
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({ status: "written", proofRunId: runId }),
      );
      expect(existsSync(test.candidateEnvironment)).toBe(false);
      expect(test.operations().some((args) => args.includes("rm"))).toBe(true);
    } finally {
      test.cleanup();
    }
  });

  it("cleans up and rejects readiness with a mismatched protected release", () => {
    const test = harness();
    try {
      const result = test.run({ FAKE_READINESS_REVISION: "wrong-revision" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "candidate readiness release identity did not match protected state\n",
      );
      expect(existsSync(test.candidateEnvironment)).toBe(false);
      expect(test.operations().some((args) => args.includes("rm"))).toBe(true);
    } finally {
      test.cleanup();
    }
  });

  it("does not write candidate secrets when release preflight fails", () => {
    const test = harness();
    try {
      rmSync(test.releaseEnvironment);
      const result = test.run();
      expect(result.status).toBe(1);
      expect(existsSync(test.candidateEnvironment)).toBe(false);
      expect(test.operations()).toEqual([]);
    } finally {
      test.cleanup();
    }
  });

  it("rejects accepted evidence when candidate removal fails", () => {
    const test = harness();
    try {
      const result = test.run({ FAKE_CANDIDATE_RM_FAIL: "1" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("candidate app cleanup failed\n");
      expect(existsSync(test.candidateEnvironment)).toBe(false);
    } finally {
      test.cleanup();
    }
  });
});
