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
  sha256,
  validateRehearsalConfiguration,
  validateRehearsalEvidence,
} from "../ops/auth-rehearsal/protocol.mjs";

const runId = "20260802T210000000Z";

function environments() {
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
