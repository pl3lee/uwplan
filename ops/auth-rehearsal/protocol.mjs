// @ts-nocheck -- Runtime-validated operational module consumed directly by Node.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { ROW_DIGEST_CONTRACT } from "../database/row-digest.mjs";

const runIdPattern = /^[0-9]{8}T[0-9]{9}Z$/;
const candidateDatabasePattern = /^uwplan_candidate_[0-9]{8}T[0-9]{9}Z$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const basicUserPattern = /^[A-Za-z0-9_.-]{1,64}$/;
export const AUTH_SCRUB_PROCEDURE_VERSION = "auth-artifact-scrub-v2";

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readProtectedEnvironment(path) {
  if (!path) throw new Error("protected rehearsal environment is required");
  const stat = statSync(path);
  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    (process.env.NODE_ENV !== "test" && stat.uid !== 0)
  ) {
    throw new Error(
      "protected rehearsal environment must be a root-owned mode-0600 file",
    );
  }

  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("invalid protected environment entry");
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || Object.hasOwn(values, key)) {
      throw new Error("invalid or duplicate protected environment key");
    }
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.includes("\n") || value.includes("\r")) {
      throw new Error("invalid protected environment value");
    }
    values[key] = value;
  }
  return values;
}

export function readProtectedJson(path, description = "protected evidence") {
  if (!path) throw new Error(`${description} is required`);
  const stat = statSync(path);
  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    (process.env.NODE_ENV !== "test" && stat.uid !== 0)
  ) {
    throw new Error(`${description} must be a root-owned mode-0600 file`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateAuthScrubMarker({
  runId,
  candidateDatabase,
  markerPath,
  integrityPath,
}) {
  const integrity = readProtectedJson(
    integrityPath,
    "candidate integrity evidence",
  );
  const marker = readProtectedJson(markerPath, "authentication scrub marker");
  const integrityMarkerSha256 = createHash("sha256")
    .update(readFileSync(integrityPath))
    .digest("hex");
  const expectedCandidate = `uwplan_candidate_${runId}`;
  const preservedCounts = marker?.preservedCounts ?? {};
  const preservedDigests = marker?.preservedDigests ?? {};
  if (
    !runIdPattern.test(runId ?? "") ||
    candidateDatabase !== expectedCandidate ||
    integrity?.status !== "accepted" ||
    integrity?.runId !== runId ||
    integrity?.candidateDatabase !== candidateDatabase ||
    !sha256Pattern.test(integrity?.sourceArchiveSha256 ?? "") ||
    marker?.schemaVersion !== 1 ||
    marker?.event !== "auth.artifact-scrub" ||
    marker?.status !== "accepted" ||
    marker?.procedureVersion !== AUTH_SCRUB_PROCEDURE_VERSION ||
    marker?.runId !== runId ||
    marker?.candidateDatabase !== candidateDatabase ||
    marker?.sourceArchiveSha256 !== integrity.sourceArchiveSha256 ||
    marker?.integrityMarkerSha256 !== integrityMarkerSha256 ||
    marker?.applicationStopped !== true ||
    JSON.stringify(marker?.rowDigest) !==
      JSON.stringify(ROW_DIGEST_CONTRACT) ||
    marker?.transaction?.committed !== true ||
    JSON.stringify(marker?.transaction?.lockedTables) !==
      JSON.stringify([
        "public.session",
        "public.verification_token",
        "public.account",
      ]) ||
    marker?.authArtifactCounts?.session !== 0 ||
    marker?.authArtifactCounts?.verificationToken !== 0 ||
    marker?.authArtifactCounts?.account !== 0 ||
    !isCount(preservedCounts.user) ||
    !isCount(preservedCounts.plan) ||
    !isCount(preservedCounts.schedule) ||
    !sha256Pattern.test(preservedDigests.user ?? "") ||
    !sha256Pattern.test(preservedDigests.plan ?? "") ||
    !sha256Pattern.test(preservedDigests.schedule ?? "")
  ) {
    throw new Error(
      "authentication scrub evidence is missing, stale, or mismatched",
    );
  }
  return marker;
}

export function validatePreparedCandidateSnapshot(marker, snapshot) {
  if (
    snapshot?.database !== marker.candidateDatabase ||
    JSON.stringify(snapshot?.rowDigest) !==
      JSON.stringify(ROW_DIGEST_CONTRACT) ||
    JSON.stringify(snapshot?.rowDigest) !== JSON.stringify(marker.rowDigest) ||
    snapshot?.authArtifactCounts?.session !== 0 ||
    snapshot?.authArtifactCounts?.verificationToken !== 0 ||
    snapshot?.authArtifactCounts?.account !== 0 ||
    snapshot?.preservedCounts?.user !== marker.preservedCounts.user ||
    snapshot?.preservedCounts?.plan !== marker.preservedCounts.plan ||
    snapshot?.preservedCounts?.schedule !== marker.preservedCounts.schedule ||
    snapshot?.preservedDigests?.user !== marker.preservedDigests.user ||
    snapshot?.preservedDigests?.plan !== marker.preservedDigests.plan ||
    snapshot?.preservedDigests?.schedule !== marker.preservedDigests.schedule
  ) {
    throw new Error("candidate authentication scrub is no longer current");
  }
}

export function validateRehearsalStartMarker({
  configuration,
  operatorEnvironment,
  runtimeEnvironmentPath,
  releaseEnvironmentPath,
  composeFilePath,
  containerId,
  imageId,
  startedAt,
  restartCount,
}) {
  const marker = readProtectedJson(
    operatorEnvironment.UWPLAN_AUTH_START_MARKER_FILE,
    "rehearsal start marker",
  );
  const expectedContainerId = /^[0-9a-f]{64}$/.test(containerId ?? "")
    ? containerId
    : "";
  const expectedImageId = /^sha256:[0-9a-f]{64}$/.test(imageId ?? "")
    ? imageId
    : "";
  const expectedStartedAt =
    typeof startedAt === "string" && !Number.isNaN(Date.parse(startedAt))
      ? startedAt
      : "";
  if (
    marker?.schemaVersion !== 1 ||
    marker?.event !== "auth.rehearsal-start" ||
    marker?.status !== "started" ||
    marker?.runId !== configuration.runId ||
    marker?.candidateDatabase !== configuration.database ||
    marker?.authScrubMarkerSha256 !==
      fileSha256(operatorEnvironment.UWPLAN_AUTH_SCRUB_MARKER_FILE) ||
    marker?.rehearsalEnvironmentSha256 !==
      fileSha256(operatorEnvironment.UWPLAN_REHEARSAL_APP_ENV_FILE) ||
    marker?.runtimeEnvironmentSha256 !==
      fileSha256(runtimeEnvironmentPath) ||
    marker?.releaseEnvironmentSha256 !==
      fileSha256(releaseEnvironmentPath) ||
    marker?.composeFileSha256 !== fileSha256(composeFilePath) ||
    marker?.containerId !== expectedContainerId ||
    marker?.imageId !== expectedImageId ||
    marker?.startedAt !== expectedStartedAt ||
    marker?.restartCount !== restartCount ||
    !Number.isSafeInteger(restartCount) ||
    restartCount !== 0
  ) {
    throw new Error("rehearsal start evidence is missing, stale, or mismatched");
  }
  return marker;
}

function requireValue(environment, key, pattern) {
  const value = environment[key] ?? "";
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`invalid rehearsal configuration: ${key}`);
  }
  return value;
}

function validateDedicatedCredential(
  rehearsalEnvironment,
  operatorEnvironment,
  key,
  minimumLength,
) {
  const value = requireValue(rehearsalEnvironment, key);
  if (value.length < minimumLength) {
    throw new Error(`invalid rehearsal configuration: ${key}`);
  }
  const productionFingerprint = requireValue(
    operatorEnvironment,
    `UWPLAN_PRODUCTION_${key}_SHA256`,
    sha256Pattern,
  );
  if (sha256(value) === productionFingerprint) {
    throw new Error(`rehearsal credential is not dedicated: ${key}`);
  }
}

export function validateRehearsalConfiguration(
  rehearsalEnvironment,
  operatorEnvironment,
) {
  const runId = requireValue(
    operatorEnvironment,
    "UWPLAN_REHEARSAL_RUN_ID",
    runIdPattern,
  );
  const publicUrl = new URL(
    requireValue(operatorEnvironment, "UWPLAN_REHEARSAL_URL"),
  );
  const databaseUrl = new URL(
    requireValue(rehearsalEnvironment, "DATABASE_URL"),
  );
  const database = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== "/" ||
    publicUrl.search ||
    publicUrl.hash ||
    databaseUrl.protocol !== "postgresql:" ||
    decodeURIComponent(databaseUrl.username) !== "uwplan_app" ||
    !candidateDatabasePattern.test(database) ||
    rehearsalEnvironment.AUTH_TRUST_HOST !== "true" ||
    Object.hasOwn(rehearsalEnvironment, "AUTH_URL") ||
    rehearsalEnvironment.UWPLAN_AUTH_REHEARSAL_ENABLED !== "true" ||
    rehearsalEnvironment.UWPLAN_DEPLOYMENT_ENVIRONMENT !== "rehearsal" ||
    rehearsalEnvironment.UWPLAN_REHEARSAL_PUBLIC_URL !== publicUrl.origin
  ) {
    throw new Error("rehearsal application boundary is not isolated");
  }

  if (database !== `uwplan_candidate_${runId}`) {
    throw new Error("rehearsal candidate identity does not match its run");
  }
  const authScrub = validateAuthScrubMarker({
    runId,
    candidateDatabase: database,
    markerPath: requireValue(
      operatorEnvironment,
      "UWPLAN_AUTH_SCRUB_MARKER_FILE",
    ),
    integrityPath: requireValue(
      operatorEnvironment,
      "UWPLAN_INTEGRITY_ACCEPTED_FILE",
    ),
  });

  for (const [key, minimumLength] of [
    ["AUTH_SECRET", 32],
    ["AUTH_GOOGLE_ID", 8],
    ["AUTH_GOOGLE_SECRET", 16],
    ["AUTH_GITHUB_ID", 8],
    ["AUTH_GITHUB_SECRET", 16],
  ]) {
    validateDedicatedCredential(
      rehearsalEnvironment,
      operatorEnvironment,
      key,
      minimumLength,
    );
  }

  const basicUser = requireValue(
    operatorEnvironment,
    "UWPLAN_REHEARSAL_BASIC_USER",
    basicUserPattern,
  );
  const basicPassword = requireValue(
    operatorEnvironment,
    "UWPLAN_REHEARSAL_BASIC_PASSWORD",
  );
  if (basicPassword.length < 20) {
    throw new Error("rehearsal Basic Auth password is too short");
  }

  const identities = {
    google: {
      email: requireValue(operatorEnvironment, "UWPLAN_GOOGLE_TEST_EMAIL"),
      marker: requireValue(operatorEnvironment, "UWPLAN_GOOGLE_WRITE_MARKER"),
      provider: "google",
    },
    github: {
      email: requireValue(operatorEnvironment, "UWPLAN_GITHUB_TEST_EMAIL"),
      marker: requireValue(operatorEnvironment, "UWPLAN_GITHUB_WRITE_MARKER"),
      provider: "github",
    },
  };
  const emails = Object.values(identities).map(({ email }) => email);
  if (
    new Set(emails.map((email) => email.toLowerCase())).size !==
      emails.length ||
    emails.some((email) => !/^\S+@\S+\.\S+$/.test(email)) ||
    identities.google.marker === "Default" ||
    identities.github.marker === "Default" ||
    identities.google.marker === identities.github.marker
  ) {
    throw new Error("rehearsal identities and write markers must be distinct");
  }

  return {
    schemaVersion: 1,
    runId,
    publicUrl: publicUrl.origin,
    databaseUrl: databaseUrl.toString(),
    database,
    databaseRole: decodeURIComponent(databaseUrl.username),
    basicUser,
    basicPassword,
    identities,
    authScrub,
  };
}

function assertIdentity(name, actual, expected) {
  const expectedAccounts = {
    google: expected.provider === "google" ? 1 : 0,
    github: expected.provider === "github" ? 1 : 0,
  };
  const required = {
    users: 1,
    accounts: expectedAccounts,
    plans: 1,
    schedules: {
      total: expected.marker ? 2 : 1,
      default: 1,
      marker: expected.marker ? 1 : 0,
    },
    termRanges: 1,
  };
  if (JSON.stringify(actual) !== JSON.stringify(required)) {
    throw new Error(`rehearsal identity invariant failed: ${name}`);
  }
}

export function validateRehearsalEvidence(
  configuration,
  snapshot,
  attestation,
) {
  if (
    configuration.authScrub?.status !== "accepted" ||
    configuration.authScrub?.runId !== configuration.runId ||
    configuration.authScrub?.candidateDatabase !== configuration.database ||
    snapshot?.schemaVersion !== 1 ||
    snapshot.database?.name !== configuration.database ||
    snapshot.database?.role !== "uwplan_app" ||
    snapshot.database?.productionContacted !== false
  ) {
    throw new Error("rehearsal database evidence is not isolated");
  }
  assertIdentity("google", snapshot.identities?.google, {
    provider: "google",
    marker: configuration.identities.google.marker,
  });
  assertIdentity("github", snapshot.identities?.github, {
    provider: "github",
    marker: configuration.identities.github.marker,
  });
  if (
    attestation?.schemaVersion !== 1 ||
    attestation.runId !== configuration.runId ||
    attestation.desktopChrome?.complete !== true ||
    attestation.desktopChrome?.signIns !== 2 ||
    attestation.desktopChrome?.writePersisted !== true ||
    attestation.desktopChrome?.provider !== "google" ||
    attestation.physicalIphoneSafari?.complete !== true ||
    attestation.physicalIphoneSafari?.signIns !== 2 ||
    attestation.physicalIphoneSafari?.writePersisted !== true ||
    attestation.physicalIphoneSafari?.provider !== "github"
  ) {
    throw new Error("browser/provider acceptance evidence is incomplete");
  }

  return {
    schemaVersion: 1,
    event: "auth.rehearsal",
    status: "accepted",
    runId: configuration.runId,
    target: configuration.publicUrl,
    candidateDatabase: configuration.database,
    databaseRole: "uwplan_app",
    productionDatabaseContacted: false,
    productionCredentialsUsed: false,
    authenticationArtifacts: {
      procedureVersion: AUTH_SCRUB_PROCEDURE_VERSION,
      sourceArchiveSha256: configuration.authScrub.sourceArchiveSha256,
      integrityMarkerSha256: configuration.authScrub.integrityMarkerSha256,
      preflightCounts: configuration.authScrub.authArtifactCounts,
    },
    basicAuth: {
      missingRejected: true,
      wrongRejected: true,
      authorizationStripped: true,
    },
    oauth: {
      google: "two-sign-in-idempotent",
      github: "two-sign-in-idempotent",
      crossProvider: "covered-by-automated-fail-closed-policy-test",
    },
    browsers: {
      desktopChrome: "write-persisted",
      physicalIphoneSafari: "write-persisted",
    },
    identityProofSha256: {
      google: sha256(configuration.identities.google.email.toLowerCase()),
      github: sha256(configuration.identities.github.email.toLowerCase()),
    },
  };
}
