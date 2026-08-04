/** @jest-environment node */

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import { oauthProviderSecurityOptions } from "../src/server/auth/provider-policy";
import { resolveAuthRehearsalBoundaryConfiguration } from "../src/server/auth/rehearsal";
import {
  readProtectedEnvironment,
  fileSha256,
  sha256,
  validateAuthScrubMarker,
  validatePreparedCandidateSnapshot,
  validateRehearsalConfiguration,
  validateRehearsalEvidence,
  validateRehearsalStartMarker,
} from "../ops/auth-rehearsal/protocol.mjs";

const runId = "20260802T210000000Z";
const evidenceRoot = mkdtempSync(join(tmpdir(), "uwplan-auth-evidence-"));

afterAll(() => {
  rmSync(evidenceRoot, { recursive: true, force: true });
});

function scrubEvidence(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(evidenceRoot, "case-"));
  const integrityPath = join(root, "integrity-accepted.json");
  const markerPath = join(root, "auth-artifact-scrub-accepted.json");
  const integrityText = `${JSON.stringify({
    schemaVersion: 1,
    status: "accepted",
    runId,
    candidateDatabase: `uwplan_candidate_${runId}`,
    sourceArchiveSha256: "a".repeat(64),
  })}\n`;
  writeFileSync(integrityPath, integrityText, { mode: 0o600 });
  const marker = {
    schemaVersion: 1,
    event: "auth.artifact-scrub",
    status: "accepted",
    procedureVersion: "auth-artifact-scrub-v2",
    runId,
    candidateDatabase: `uwplan_candidate_${runId}`,
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
    preservedCounts: { user: 11, plan: 7, schedule: 9 },
    preservedDigests: {
      user: "1".repeat(64),
      plan: "2".repeat(64),
      schedule: "3".repeat(64),
    },
    ...overrides,
  };
  writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
  return { integrityPath, markerPath, marker };
}

function environments() {
  const evidence = scrubEvidence();
  const rehearsal = {
    AUTH_SECRET: "rehearsal-auth-secret-that-is-long-enough",
    AUTH_GOOGLE_ID: "rehearsal-google-client-id",
    AUTH_GOOGLE_SECRET: "rehearsal-google-client-secret",
    AUTH_GITHUB_ID: "rehearsal-github-client-id",
    AUTH_GITHUB_SECRET: "rehearsal-github-client-secret",
    AUTH_TRUST_HOST: "true",
    DATABASE_URL: `postgresql://uwplan_app:secret@db:5432/uwplan_candidate_${runId}`,
    UWPLAN_AUTH_REHEARSAL_ENABLED: "true",
    UWPLAN_DEPLOYMENT_ENVIRONMENT: "rehearsal",
    UWPLAN_REHEARSAL_PUBLIC_URL: "https://v2.uwplan.com",
    NODE_ENV: "production" as const,
  };
  const operator = {
    UWPLAN_REHEARSAL_RUN_ID: runId,
    UWPLAN_REHEARSAL_URL: "https://v2.uwplan.com",
    UWPLAN_REHEARSAL_BASIC_USER: "named-tester",
    UWPLAN_REHEARSAL_BASIC_PASSWORD: "long-disposable-basic-password",
    UWPLAN_AUTH_SCRUB_MARKER_FILE: evidence.markerPath,
    UWPLAN_INTEGRITY_ACCEPTED_FILE: evidence.integrityPath,
    UWPLAN_GOOGLE_TEST_EMAIL: "google@example.invalid",
    UWPLAN_GOOGLE_WRITE_MARKER: "chrome-persistence-proof",
    UWPLAN_GITHUB_TEST_EMAIL: "github@example.invalid",
    UWPLAN_GITHUB_WRITE_MARKER: "iphone-persistence-proof",
    UWPLAN_PRODUCTION_AUTH_SECRET_SHA256: sha256("production-auth-secret"),
    UWPLAN_PRODUCTION_AUTH_GOOGLE_ID_SHA256: sha256("production-google-id"),
    UWPLAN_PRODUCTION_AUTH_GOOGLE_SECRET_SHA256: sha256(
      "production-google-secret",
    ),
    UWPLAN_PRODUCTION_AUTH_GITHUB_ID_SHA256: sha256("production-github-id"),
    UWPLAN_PRODUCTION_AUTH_GITHUB_SECRET_SHA256: sha256(
      "production-github-secret",
    ),
  };
  return { rehearsal, operator };
}

function acceptedSnapshot() {
  const identity = (provider: "google" | "github", marker: boolean) => ({
    users: 1,
    accounts: {
      google: provider === "google" ? 1 : 0,
      github: provider === "github" ? 1 : 0,
    },
    plans: 1,
    schedules: {
      total: marker ? 2 : 1,
      default: 1,
      marker: marker ? 1 : 0,
    },
    termRanges: 1,
  });
  return {
    schemaVersion: 1,
    database: {
      name: `uwplan_candidate_${runId}`,
      role: "uwplan_app",
      productionContacted: false,
    },
    identities: {
      google: identity("google", true),
      github: identity("github", true),
    },
  };
}

function acceptedAttestation() {
  return {
    schemaVersion: 1,
    runId,
    desktopChrome: {
      complete: true,
      provider: "google",
      signIns: 2,
      writePersisted: true,
    },
    physicalIphoneSafari: {
      complete: true,
      provider: "github",
      signIns: 2,
      writePersisted: true,
    },
  };
}

describe("isolated authentication rehearsal", () => {
  it("pins both OAuth providers to fail-closed email linking", () => {
    expect(oauthProviderSecurityOptions).toEqual({
      allowDangerousEmailAccountLinking: false,
    });
  });

  it("rejects an automated same-email cross-provider attempt before mutation", () => {
    const result = spawnSync(
      process.execPath,
      [
        join(
          process.cwd(),
          "tests/fixtures/auth-rehearsal/cross-provider-proof.mjs",
        ),
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      error: "OAuthAccountNotLinked",
      mutations: {
        users: 0,
        accounts: 0,
        sessions: 0,
        plans: 0,
        schedules: 0,
      },
      allowDangerousEmailAccountLinking: false,
      githubScopes: "read:user user:email",
    });
  });

  it("admits only an enabled rehearsal app using a fresh candidate database", () => {
    const { rehearsal } = environments();
    expect(resolveAuthRehearsalBoundaryConfiguration(rehearsal)).toEqual({
      hostname: "v2.uwplan.com",
      database: `uwplan_candidate_${runId}`,
    });
    expect(
      resolveAuthRehearsalBoundaryConfiguration({
        ...rehearsal,
        UWPLAN_DEPLOYMENT_ENVIRONMENT: "production",
      }),
    ).toBeNull();
    expect(
      resolveAuthRehearsalBoundaryConfiguration({
        ...rehearsal,
        DATABASE_URL: "postgresql://uwplan_app:secret@db:5432/uwplan",
      }),
    ).toBeNull();
    expect(
      resolveAuthRehearsalBoundaryConfiguration({
        ...rehearsal,
        AUTH_URL: "https://v2.uwplan.com",
      }),
    ).toBeNull();
  });

  it("requires trust-host, an unset AUTH_URL, and dedicated credentials", () => {
    const { rehearsal, operator } = environments();
    expect(validateRehearsalConfiguration(rehearsal, operator)).toEqual(
      expect.objectContaining({
        database: `uwplan_candidate_${runId}`,
        databaseRole: "uwplan_app",
        publicUrl: "https://v2.uwplan.com",
      }),
    );
    expect(() =>
      validateRehearsalConfiguration(
        { ...rehearsal, AUTH_URL: "https://v2.uwplan.com" },
        operator,
      ),
    ).toThrow("boundary is not isolated");
    expect(() =>
      validateRehearsalConfiguration(rehearsal, {
        ...operator,
        UWPLAN_PRODUCTION_AUTH_SECRET_SHA256: sha256(rehearsal.AUTH_SECRET),
      }),
    ).toThrow("credential is not dedicated: AUTH_SECRET");
    expect(() =>
      validateRehearsalConfiguration(
        {
          ...rehearsal,
          DATABASE_URL:
            "postgresql://uwplan_app:secret@db:5432/uwplan_candidate_20260802T220000000Z",
        },
        operator,
      ),
    ).toThrow("candidate identity does not match its run");
  });

  it("requires a mode-0600 scrub marker bound to accepted integrity evidence", () => {
    const evidence = scrubEvidence();
    expect(
      validateAuthScrubMarker({
        runId,
        candidateDatabase: `uwplan_candidate_${runId}`,
        markerPath: evidence.markerPath,
        integrityPath: evidence.integrityPath,
      }),
    ).toEqual(expect.objectContaining({ status: "accepted" }));

    chmodSync(evidence.markerPath, 0o644);
    expect(() =>
      validateAuthScrubMarker({
        runId,
        candidateDatabase: `uwplan_candidate_${runId}`,
        markerPath: evidence.markerPath,
        integrityPath: evidence.integrityPath,
      }),
    ).toThrow("mode-0600");
  });

  it("rejects legacy MD5 scrub evidence", () => {
    const evidence = scrubEvidence({
      procedureVersion: "auth-artifact-scrub-v1",
      rowDigest: undefined,
      preservedDigests: {
        user: "1".repeat(32),
        plan: "2".repeat(32),
        schedule: "3".repeat(32),
      },
    });

    expect(() =>
      validateAuthScrubMarker({
        runId,
        candidateDatabase: `uwplan_candidate_${runId}`,
        markerPath: evidence.markerPath,
        integrityPath: evidence.integrityPath,
      }),
    ).toThrow("missing, stale, or mismatched");
  });

  it("binds guarded start evidence to protected files and the live container", () => {
    const root = mkdtempSync(join(evidenceRoot, "start-"));
    const rehearsalEnvironmentPath = join(root, "rehearsal.env");
    const runtimeEnvironmentPath = join(root, "runtime.env");
    const releaseEnvironmentPath = join(root, "release.env");
    const composeFilePath = join(root, "compose.yaml");
    const markerPath = join(root, "auth-rehearsal-started.json");
    for (const [path, contents] of [
      [rehearsalEnvironmentPath, "DATABASE_URL=protected\n"],
      [runtimeEnvironmentPath, "UWPLAN_IMAGE=protected\n"],
      [releaseEnvironmentPath, "RELEASE_REVISION=protected\n"],
      [composeFilePath, "services: {}\n"],
    ] as Array<[string, string]>) {
      writeFileSync(path, contents, { mode: 0o600 });
    }
    const { rehearsal, operator } = environments();
    const configuration = validateRehearsalConfiguration(rehearsal, operator);
    const containerId = "4".repeat(64);
    const imageId = `sha256:${"5".repeat(64)}`;
    const startedAt = "2026-08-02T21:30:00.000000000Z";
    const restartCount = 0;
    const marker = {
      schemaVersion: 1,
      event: "auth.rehearsal-start",
      status: "started",
      runId,
      candidateDatabase: configuration.database,
      authScrubMarkerSha256: fileSha256(operator.UWPLAN_AUTH_SCRUB_MARKER_FILE),
      rehearsalEnvironmentSha256: fileSha256(rehearsalEnvironmentPath),
      runtimeEnvironmentSha256: fileSha256(runtimeEnvironmentPath),
      releaseEnvironmentSha256: fileSha256(releaseEnvironmentPath),
      composeFileSha256: fileSha256(composeFilePath),
      containerId,
      imageId,
      startedAt,
      restartCount,
    };
    writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    const startOperator = {
      ...operator,
      UWPLAN_REHEARSAL_APP_ENV_FILE: rehearsalEnvironmentPath,
      UWPLAN_AUTH_START_MARKER_FILE: markerPath,
    };
    const input = {
      configuration,
      operatorEnvironment: startOperator,
      runtimeEnvironmentPath,
      releaseEnvironmentPath,
      composeFilePath,
      containerId,
      imageId,
      startedAt,
      restartCount,
    };
    expect(validateRehearsalStartMarker(input)).toEqual(marker);
    expect(() =>
      validateRehearsalStartMarker({
        ...input,
        containerId: "6".repeat(64),
      }),
    ).toThrow("missing, stale, or mismatched");
    expect(() =>
      validateRehearsalStartMarker({ ...input, restartCount: 1 }),
    ).toThrow("missing, stale, or mismatched");
    writeFileSync(releaseEnvironmentPath, "RELEASE_REVISION=changed\n", {
      mode: 0o600,
    });
    expect(() => validateRehearsalStartMarker(input)).toThrow(
      "missing, stale, or mismatched",
    );
  });

  it.each([
    ["nonzero account count", { account: 1 }],
    ["nonzero session count", { session: 1 }],
    ["nonzero verification-token count", { verificationToken: 1 }],
  ])("rejects scrub evidence with %s", (_name, changedCount) => {
    const counts = { session: 0, verificationToken: 0, account: 0 };
    const evidence = scrubEvidence({
      authArtifactCounts: { ...counts, ...changedCount },
    });
    expect(() =>
      validateAuthScrubMarker({
        runId,
        candidateDatabase: `uwplan_candidate_${runId}`,
        markerPath: evidence.markerPath,
        integrityPath: evidence.integrityPath,
      }),
    ).toThrow("missing, stale, or mismatched");
  });

  it("rejects a stale marker and a prepared candidate whose rows changed", () => {
    const evidence = scrubEvidence();
    writeFileSync(
      evidence.integrityPath,
      `${JSON.stringify({
        schemaVersion: 1,
        status: "accepted",
        runId,
        candidateDatabase: `uwplan_candidate_${runId}`,
        sourceArchiveSha256: "b".repeat(64),
      })}\n`,
      { mode: 0o600 },
    );
    expect(() =>
      validateAuthScrubMarker({
        runId,
        candidateDatabase: `uwplan_candidate_${runId}`,
        markerPath: evidence.markerPath,
        integrityPath: evidence.integrityPath,
      }),
    ).toThrow("missing, stale, or mismatched");

    expect(() =>
      validatePreparedCandidateSnapshot(evidence.marker, {
        database: `uwplan_candidate_${runId}`,
        authArtifactCounts: { session: 0, verificationToken: 0, account: 1 },
        preservedCounts: evidence.marker.preservedCounts,
        preservedDigests: evidence.marker.preservedDigests,
      }),
    ).toThrow("no longer current");
  });

  it("accepts exactly two providers' idempotency, write, and browser evidence", () => {
    const { rehearsal, operator } = environments();
    const configuration = validateRehearsalConfiguration(rehearsal, operator);
    expect(
      validateRehearsalEvidence(
        configuration,
        acceptedSnapshot(),
        acceptedAttestation(),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "accepted",
        productionDatabaseContacted: false,
        productionCredentialsUsed: false,
        basicAuth: {
          missingRejected: true,
          wrongRejected: true,
          authorizationStripped: true,
        },
      }),
    );
  });

  it.each([
    ["duplicate user", ["identities", "google", "users"], 2],
    ["duplicate account", ["identities", "github", "accounts", "github"], 2],
    ["duplicate plan", ["identities", "google", "plans"], 2],
    [
      "duplicate default schedule",
      ["identities", "github", "schedules", "default"],
      2,
    ],
  ])("rejects %s evidence", (_name, path, value) => {
    const { rehearsal, operator } = environments();
    const configuration = validateRehearsalConfiguration(rehearsal, operator);
    const snapshot = acceptedSnapshot() as Record<string, any>;
    let target = snapshot;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)!] = value;
    expect(() =>
      validateRehearsalEvidence(configuration, snapshot, acceptedAttestation()),
    ).toThrow("identity invariant failed");
  });

  it("does not accept a claimed physical-iPhone result without evidence", () => {
    const { rehearsal, operator } = environments();
    const configuration = validateRehearsalConfiguration(rehearsal, operator);
    const attestation = acceptedAttestation();
    attestation.physicalIphoneSafari.complete = false;
    expect(() =>
      validateRehearsalEvidence(configuration, acceptedSnapshot(), attestation),
    ).toThrow("browser/provider acceptance evidence is incomplete");
  });

  it("reads only protected environment files", () => {
    const root = mkdtempSync(join(tmpdir(), "uwplan-auth-rehearsal-"));
    const path = join(root, "rehearsal.env");
    try {
      writeFileSync(path, "AUTH_TRUST_HOST=true\n", { mode: 0o600 });
      expect(readProtectedEnvironment(path)).toEqual({
        AUTH_TRUST_HOST: "true",
      });
      chmodSync(path, 0o644);
      expect(() => readProtectedEnvironment(path)).toThrow("mode-0600");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the rehearsal app isolated behind loopback and its own profile", () => {
    const compose = parse(
      readFileSync(join(process.cwd(), "compose.yaml"), "utf8"),
    );
    expect(compose.services["rehearsal-app"]).toEqual(
      expect.objectContaining({
        profiles: ["rehearsal"],
        restart: "unless-stopped",
        mem_limit: "256m",
      }),
    );
    expect(compose.services["rehearsal-app"].ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", published: "5001" }),
    ]);
    expect(compose.services.app.env_file).not.toEqual(
      compose.services["rehearsal-app"].env_file,
    );
  });
});
