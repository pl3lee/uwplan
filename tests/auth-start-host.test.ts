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

const command = join(process.cwd(), "ops/auth-rehearsal/start.mjs");
const runId = "20260802T213000000Z";
const candidateDatabase = `uwplan_candidate_${runId}`;
const containerId = "4".repeat(64);
const imageId = `sha256:${"5".repeat(64)}`;
const startedAt = "2026-08-02T21:30:00.000000000Z";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), "uwplan-auth-start-"));
  const operatorPath = join(root, "operator.env");
  const rehearsalPath = join(root, "rehearsal.env");
  const runtimePath = join(root, "runtime.env");
  const releasePath = join(root, "release.env");
  const composePath = join(root, "compose.yaml");
  const integrityPath = join(root, "integrity-accepted.json");
  const scrubPath = join(root, "auth-artifact-scrub-accepted.json");
  const startPath = join(root, "auth-rehearsal-started.json");
  const dockerLog = join(root, "docker.jsonl");
  const dockerPath = join(root, "fake-docker.mjs");
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const integrityText = `${JSON.stringify({
    schemaVersion: 1,
    status: "accepted",
    runId,
    candidateDatabase,
    sourceArchiveSha256: "a".repeat(64),
  })}\n`;
  writeFileSync(integrityPath, integrityText, { mode: 0o600 });
  const scrub = {
    schemaVersion: 1,
    event: "auth.artifact-scrub",
    status: "accepted",
    procedureVersion: "auth-artifact-scrub-v2",
    runId,
    candidateDatabase,
    sourceArchiveSha256: "a".repeat(64),
    integrityMarkerSha256: sha256(integrityText),
    applicationStopped: true,
    transaction: {
      committed: true,
      lockedTables: [
        "public.session",
        "public.verification_token",
        "public.account",
      ],
    },
    authArtifactCounts: { session: 0, verificationToken: 0, account: 0 },
    rowDigest: {
      algorithm: "sha256",
      canonicalization: "postgres-row-json-utf8-base64-lines-v1",
    },
    preservedCounts: { user: 7, plan: 5, schedule: 6 },
    preservedDigests: {
      user: "1".repeat(64),
      plan: "2".repeat(64),
      schedule: "3".repeat(64),
    },
  };
  writeFileSync(scrubPath, `${JSON.stringify(scrub)}\n`, { mode: 0o600 });
  writeFileSync(
    rehearsalPath,
    [
      "AUTH_SECRET=rehearsal-auth-secret-that-is-long-enough",
      "AUTH_GOOGLE_ID=rehearsal-google-client-id",
      "AUTH_GOOGLE_SECRET=rehearsal-google-client-secret",
      "AUTH_GITHUB_ID=rehearsal-github-client-id",
      "AUTH_GITHUB_SECRET=rehearsal-github-client-secret",
      "AUTH_TRUST_HOST=true",
      `DATABASE_URL=postgresql://uwplan_app:secret@db:5432/${candidateDatabase}`,
      "UWPLAN_AUTH_REHEARSAL_ENABLED=true",
      "UWPLAN_DEPLOYMENT_ENVIRONMENT=rehearsal",
      "UWPLAN_REHEARSAL_PUBLIC_URL=https://v2.uwplan.com",
      "NODE_ENV=production",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(runtimePath, "UWPLAN_IMAGE=fixture\n", { mode: 0o600 });
  writeFileSync(releasePath, "RELEASE_REVISION=fixture\n", { mode: 0o600 });
  writeFileSync(composePath, "services: {}\n", { mode: 0o600 });
  writeFileSync(
    operatorPath,
    [
      `UWPLAN_REHEARSAL_RUN_ID=${runId}`,
      "UWPLAN_REHEARSAL_URL=https://v2.uwplan.com",
      `UWPLAN_REHEARSAL_APP_ENV_FILE=${rehearsalPath}`,
      `UWPLAN_INTEGRITY_ACCEPTED_FILE=${integrityPath}`,
      `UWPLAN_AUTH_SCRUB_MARKER_FILE=${scrubPath}`,
      `UWPLAN_AUTH_START_MARKER_FILE=${startPath}`,
      "UWPLAN_REHEARSAL_BASIC_USER=named-tester",
      "UWPLAN_REHEARSAL_BASIC_PASSWORD=long-disposable-basic-password",
      "UWPLAN_GOOGLE_TEST_EMAIL=google@example.invalid",
      "UWPLAN_GOOGLE_WRITE_MARKER=chrome-persistence-proof",
      "UWPLAN_GITHUB_TEST_EMAIL=github@example.invalid",
      "UWPLAN_GITHUB_WRITE_MARKER=iphone-persistence-proof",
      `UWPLAN_PRODUCTION_AUTH_SECRET_SHA256=${sha256("production-auth-secret")}`,
      `UWPLAN_PRODUCTION_AUTH_GOOGLE_ID_SHA256=${sha256("production-google-id")}`,
      `UWPLAN_PRODUCTION_AUTH_GOOGLE_SECRET_SHA256=${sha256("production-google-secret")}`,
      `UWPLAN_PRODUCTION_AUTH_GITHUB_ID_SHA256=${sha256("production-github-id")}`,
      `UWPLAN_PRODUCTION_AUTH_GITHUB_SECRET_SHA256=${sha256("production-github-secret")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(
    dockerPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(dockerLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "inspect") {
  const format = args[2];
  if (format === "{{.State.StartedAt}}") process.stdout.write(${JSON.stringify(`${startedAt}\n`)});
  else if (format === "{{.RestartCount}}") process.stdout.write("0\\n");
  else process.stdout.write(${JSON.stringify(`${imageId}\n`)});
  process.exit(0);
}
if (args.includes("run")) {
  const snapshot = {
    database: ${JSON.stringify(candidateDatabase)},
    authArtifactCounts: { session: 0, verificationToken: 0, account: process.env.FAKE_STALE === "1" ? 1 : 0 },
    rowDigest: { algorithm: "sha256", canonicalization: "postgres-row-json-utf8-base64-lines-v1" },
    preservedCounts: { user: 7, plan: 5, schedule: 6 },
    preservedDigests: { user: "1".repeat(64), plan: "2".repeat(64), schedule: "3".repeat(64) },
  };
  process.stdout.write(JSON.stringify(snapshot) + "\\n");
  process.exit(0);
}
if (args.includes("ps")) {
  process.stdout.write(${JSON.stringify(`${containerId}\n`)});
  process.exit(0);
}
if (process.env.FAKE_APP_START_FAIL === "1" && args.includes("rehearsal-app") && args.includes("up")) {
  process.exit(42);
}
if (process.env.FAKE_CLEANUP_FAIL === "1" && args.includes("rm")) process.exit(43);
process.exit(0);
`,
    { mode: 0o700 },
  );
  chmodSync(dockerPath, 0o700);

  return {
    startPath,
    run(extraEnvironment: Record<string, string> = {}) {
      return spawnSync(process.execPath, [command], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          UWPLAN_AUTH_REHEARSAL_ENV_FILE: operatorPath,
          UWPLAN_AUTH_REHEARSAL_DOCKER_BIN: dockerPath,
          UWPLAN_AUTH_REHEARSAL_COMPOSE_FILE: composePath,
          UWPLAN_AUTH_REHEARSAL_RUNTIME_ENV: runtimePath,
          UWPLAN_AUTH_REHEARSAL_RELEASE_ENV: releasePath,
          ...extraEnvironment,
        },
      });
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

describe("guarded authentication rehearsal start", () => {
  it("preflights inside the Compose network and publishes live-bound evidence", () => {
    const test = harness();
    try {
      const result = test.run();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const evidence = JSON.parse(result.stdout);
      expect(evidence).toEqual(
        expect.objectContaining({
          event: "auth.rehearsal-start",
          status: "started",
          candidateDatabase,
          containerId,
          imageId,
          startedAt,
          restartCount: 0,
        }),
      );
      expect(statSync(test.startPath).mode & 0o777).toBe(0o600);
      const operations = test.operations();
      const preflight = operations.findIndex((args) => args.includes("run"));
      const appStart = operations.findIndex(
        (args) => args.includes("up") && args.includes("rehearsal-app"),
      );
      expect(preflight).toBeGreaterThanOrEqual(0);
      expect(appStart).toBeGreaterThan(preflight);
    } finally {
      test.cleanup();
    }
  });

  it("rejects stale scrub state before starting the application", () => {
    const test = harness();
    try {
      const result = test.run({ FAKE_STALE: "1" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "candidate authentication scrub is no longer current\n",
      );
      expect(existsSync(test.startPath)).toBe(false);
      expect(
        test
          .operations()
          .some(
            (args) => args.includes("up") && args.includes("rehearsal-app"),
          ),
      ).toBe(false);
    } finally {
      test.cleanup();
    }
  });

  it("removes a partially started app when start evidence cannot be published", () => {
    const test = harness();
    try {
      const result = test.run({ FAKE_APP_START_FAIL: "1" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("rehearsal application failed to start\n");
      expect(existsSync(test.startPath)).toBe(false);
      expect(
        test
          .operations()
          .some(
            (args) => args.includes("rm") && args.includes("rehearsal-app"),
          ),
      ).toBe(true);
    } finally {
      test.cleanup();
    }
  });

  it("reports an emergency when a partially started app cannot be removed", () => {
    const test = harness();
    try {
      const result = test.run({
        FAKE_APP_START_FAIL: "1",
        FAKE_CLEANUP_FAIL: "1",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "rehearsal application emergency stop failed\n",
      );
      expect(existsSync(test.startPath)).toBe(false);
    } finally {
      test.cleanup();
    }
  });
});
