/** @jest-environment node */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const utilityImage =
  "docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55";
const rowDigest = {
  algorithm: "sha256",
  canonicalization: "postgres-row-json-utf8-base64-lines-v1",
};

function integrityManifest() {
  return {
    schemaVersion: 1,
    runId,
    utilityImage,
    utilityVersionNum: "160014",
    rowDigest,
    database: {
      serverVersionNum: "160014",
      encoding: "UTF8",
      collation: "C",
      ctype: "C",
      localeProvider: "c",
      defaultTablespace: "pg_default",
    },
    schemaSha256: "e".repeat(64),
    extensions: [],
    tablespaces: [],
    ledger: { count: 1, maxId: 1, sha256: "f".repeat(64) },
    tables: [
      { schemaIdentity: "cHVibGlj", nameIdentity: "dXNlcg==", count: 7, sha256: "1".repeat(64) },
      { schemaIdentity: "cHVibGlj", nameIdentity: "cGxhbg==", count: 5, sha256: "2".repeat(64) },
      { schemaIdentity: "cHVibGlj", nameIdentity: "c2NoZWR1bGU=", count: 6, sha256: "3".repeat(64) },
    ],
    sequences: [],
    unvalidatedConstraints: [],
    invalidIndexes: [],
    ownershipViolations: [],
    appRole: { login: true, superuser: false, createdb: false, createrole: false, replication: false, bypassRls: false },
  };
}

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
  const candidateIntegrityText = `${JSON.stringify(integrityManifest())}\n`;
  writeFileSync(
    join(runDirectory, "candidate-integrity-manifest.json"),
    candidateIntegrityText,
    { mode: 0o600 },
  );
  writeFileSync(
    integrityPath,
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      candidateDatabase,
      status: "accepted",
      sourceArchiveSha256: "a".repeat(64),
      candidateIntegrityManifestSha256: createHash("sha256")
        .update(candidateIntegrityText)
        .digest("hex"),
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
if (args.includes("/integrity.sh")) {
  const manifest = ${JSON.stringify(integrityManifest())};
  const user = manifest.tables.find((table) => table.nameIdentity === "dXNlcg==");
  if (process.env.FAKE_CHANGED_PRESERVED === "1") user.count = 8;
  if (process.env.FAKE_CHANGED_DIGEST === "1") user.sha256 = "4".repeat(64);
  process.stdout.write(JSON.stringify(manifest) + "\\n");
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
const result = {
  database: ${JSON.stringify(candidateDatabase)},
  authArtifactCounts: {
    session: 0,
    verificationToken: 0,
    account: process.env.FAKE_NEGATIVE_AUTH === "1"
      ? -1
      : process.env.FAKE_NONZERO_AUTH === "1"
        ? 1
        : 0,
  },
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
          procedureVersion: "auth-artifact-scrub-v2",
          candidateDatabase,
          authArtifactCounts: { session: 0, verificationToken: 0, account: 0 },
          preservedCounts: { user: 7, plan: 5, schedule: 6 },
          preservedDigests: {
            user: "1".repeat(64),
            plan: "2".repeat(64),
            schedule: "3".repeat(64),
          },
          rowDigest,
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

  it("rejects impossible negative authentication counts", () => {
    const test = harness();
    try {
      const result = test.run(candidateDatabase, { FAKE_NEGATIVE_AUTH: "1" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "candidate authentication count evidence was invalid\n",
      );
      expect(existsSync(test.markerPath)).toBe(false);
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
