/** @jest-environment node */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const command = join(process.cwd(), "ops/database/host-command.mjs");
const runId = "20260802T211500000Z";
const candidateDatabase = `uwplan_candidate_${runId}`;
const sentinel = "student-secret-sentinel@example.invalid";

function harness() {
  const root = mkdtempSync(join(tmpdir(), "uwplan-auth-scrub-host-"));
  const stateRoot = join(root, "state");
  const runDirectory = join(stateRoot, runId);
  const integrityPath = join(runDirectory, "integrity-accepted.json");
  const markerPath = join(runDirectory, "auth-artifact-scrub-accepted.json");
  const targetEnvironment = join(root, "target.env");
  const dockerLog = join(root, "docker.jsonl");
  const docker = join(root, "fake-docker.mjs");
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    integrityPath,
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      candidateDatabase,
      status: "accepted",
      sourceArchiveSha256: "a".repeat(64),
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    targetEnvironment,
    "PGHOST=db\nPGUSER=postgres\nPGPASSWORD=protected\nPGDATABASE=postgres\nUWPLAN_DB_DOCKER_NETWORK=fixture\n",
    { mode: 0o600 },
  );
  writeFileSync(
    docker,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(dockerLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "ps") {
  if (process.env.FAKE_ACTIVE_APP === "1") process.stdout.write("container-id\\n");
  process.exit(0);
}
if (!args.includes("psql")) process.exit(64);
if (args.includes("/auth-scrub.sql")) {
  if (process.env.FAKE_SCRUB_FAIL === "1") {
    process.stderr.write(${JSON.stringify(sentinel)} + "\\n");
    process.exit(42);
  }
  process.exit(0);
}
const query = args.at(-1) ?? "";
const after = query.includes("authArtifactCounts");
const preserved = process.env.FAKE_CHANGED_PRESERVED === "1" && after
  ? { user: 8, plan: 5, schedule: 6 }
  : { user: 7, plan: 5, schedule: 6 };
const result = {
  database: ${JSON.stringify(candidateDatabase)},
  preservedCounts: preserved,
  preservedDigests: {
    user: process.env.FAKE_CHANGED_DIGEST === "1" && after ? "4".repeat(32) : "1".repeat(32),
    plan: "2".repeat(32),
    schedule: "3".repeat(32),
  },
};
if (after) result.authArtifactCounts = {
  session: 0,
  verificationToken: 0,
  account: process.env.FAKE_NONZERO_AUTH === "1" ? 1 : 0,
};
process.stdout.write(JSON.stringify(result) + "\\n");
`,
    { mode: 0o700 },
  );
  chmodSync(docker, 0o700);

  return {
    markerPath,
    run(
      candidate = candidateDatabase,
      extraEnvironment: Record<string, string> = {},
    ) {
      return spawnSync(
        process.execPath,
        [command, "scrub-candidate-auth", runId, candidate],
        {
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            UWPLAN_DB_STATE_ROOT: stateRoot,
            UWPLAN_DB_TARGET_ENV: targetEnvironment,
            UWPLAN_DB_DOCKER_BIN: docker,
            COMPOSE_PROJECT_NAME: "uwplan-auth-scrub-test",
            ...extraEnvironment,
          },
        },
      );
    },
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

describe("candidate authentication artifact scrub", () => {
  it("locks and truncates only the three authentication tables in one transaction", () => {
    const sql = readFileSync(
      join(process.cwd(), "ops/auth-rehearsal/scrub.sql"),
      "utf8",
    );
    expect(sql).toMatch(/^\\set ON_ERROR_STOP on\n\nBEGIN;/);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("SET LOCAL statement_timeout = '30s';");
    expect(sql).toContain(
      "public.session,\n  public.verification_token,\n  public.account",
    );
    expect(sql).toContain("IN ACCESS EXCLUSIVE MODE;");
    expect(sql).toMatch(/TRUNCATE TABLE[\s\S]*COMMIT;\n$/);
    expect(sql).not.toContain('public."user"');
    expect(sql).not.toContain("public.plan");
    expect(sql).not.toContain("public.schedule");
  });

  it("publishes protected, sanitized evidence and preserves planning rows", () => {
    const test = harness();
    try {
      const result = test.run();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const evidence = JSON.parse(result.stdout);
      expect(evidence).toEqual(
        expect.objectContaining({
          status: "accepted",
          procedureVersion: "auth-artifact-scrub-v1",
          candidateDatabase,
          authArtifactCounts: { session: 0, verificationToken: 0, account: 0 },
          preservedCounts: { user: 7, plan: 5, schedule: 6 },
          preservedDigests: {
            user: "1".repeat(32),
            plan: "2".repeat(32),
            schedule: "3".repeat(32),
          },
        }),
      );
      expect(statSync(test.markerPath).mode & 0o777).toBe(0o600);
      expect(readFileSync(test.markerPath, "utf8")).not.toContain(sentinel);
      expect(result.stdout).not.toContain(sentinel);
      expect(
        test.operations().some((args) => args.includes("/auth-scrub.sql")),
      ).toBe(true);
    } finally {
      test.cleanup();
    }
  });

  it("rejects the serving uwplan database before invoking Docker", () => {
    const test = harness();
    try {
      const result = test.run("uwplan");
      expect(result.status).toBe(64);
      expect(result.stderr).toBe(
        "authentication scrub requires the run's fresh candidate\n",
      );
      expect(test.operations()).toEqual([]);
      expect(existsSync(test.markerPath)).toBe(false);
    } finally {
      test.cleanup();
    }
  });

  it("rejects an active candidate app before running SQL", () => {
    const test = harness();
    try {
      const result = test.run(candidateDatabase, { FAKE_ACTIVE_APP: "1" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "candidate application must be stopped before authentication scrub\n",
      );
      expect(test.operations().every((args) => !args.includes("psql"))).toBe(
        true,
      );
    } finally {
      test.cleanup();
    }
  });

  it("fails closed without leaking row data when transactional SQL fails", () => {
    const test = harness();
    try {
      const result = test.run(candidateDatabase, { FAKE_SCRUB_FAIL: "1" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "candidate authentication scrub failed and rolled back\n",
      );
      expect(result.stderr).not.toContain(sentinel);
      expect(existsSync(test.markerPath)).toBe(false);
      const retry = test.run();
      expect(retry.status).toBe(1);
      expect(retry.stderr).toBe(
        "failed candidate identity cannot be scrubbed again\n",
      );
    } finally {
      test.cleanup();
    }
  });

  it.each([
    ["nonzero auth artifacts", { FAKE_NONZERO_AUTH: "1" }],
    ["changed planning counts", { FAKE_CHANGED_PRESERVED: "1" }],
    ["changed planning content", { FAKE_CHANGED_DIGEST: "1" }],
  ])("rejects postcondition: %s", (_name, environment) => {
    const test = harness();
    try {
      const result = test.run(candidateDatabase, environment);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "candidate authentication scrub postcondition failed\n",
      );
      expect(existsSync(test.markerPath)).toBe(false);
    } finally {
      test.cleanup();
    }
  });
});
