import { createHmac, timingSafeEqual } from "node:crypto";

export const PRE_WRITE_DEADLINE_MS = 45 * 60 * 1000;
export const ACTIVITY_SAMPLE_INTERVAL_MS = 30 * 1000;
export const REQUIRED_ACTIVITY_SAMPLES = 3;

const runIdPattern = /^[0-9]{8}T[0-9]{9}Z$/;
const walLsnPattern = /^[0-9A-F]+\/[0-9A-F]+$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

class RecoveryRequired extends Error {
  constructor(reason) {
    super(reason);
    this.name = "RecoveryRequired";
    this.reason = reason;
  }
}

export class PreWriteRecoveryRejected extends Error {
  constructor() {
    super(
      "unchanged-source recovery is forbidden after the DigitalOcean write epoch",
    );
    this.name = "PreWriteRecoveryRejected";
  }
}

function canonicalFencePayload(fence) {
  return JSON.stringify({
    schemaVersion: 1,
    runId: fence.runId,
    fencedAt: fence.fencedAt,
    sourceWalLsn: fence.sourceWalLsn,
    sourceWriteCounter: fence.sourceWriteCounter,
    sourceAppRestartCounter: fence.sourceAppRestartCounter,
  });
}

function normalizedSigningKey(signingKey) {
  const key = Buffer.isBuffer(signingKey)
    ? signingKey
    : Buffer.from(String(signingKey ?? ""), "utf8");
  if (key.length < 32)
    throw new Error("the evidence signing key must contain at least 32 bytes");
  return key;
}

function signatureFor(fence, signingKey) {
  return createHmac("sha256", normalizedSigningKey(signingKey))
    .update(canonicalFencePayload(fence))
    .digest("hex");
}

export function verifyFenceEvidence(fence, signingKey) {
  if (
    fence?.schemaVersion !== 1 ||
    !runIdPattern.test(fence?.runId ?? "") ||
    !Number.isSafeInteger(fence?.sourceWriteCounter) ||
    !Number.isSafeInteger(fence?.sourceAppRestartCounter) ||
    !walLsnPattern.test(fence?.sourceWalLsn ?? "") ||
    !sha256Pattern.test(fence?.signature ?? "") ||
    !Number.isFinite(Date.parse(fence?.fencedAt ?? ""))
  ) {
    return false;
  }
  let expected;
  try {
    expected = Buffer.from(signatureFor(fence, signingKey), "hex");
  } catch {
    return false;
  }
  const actual = Buffer.from(fence.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function accepted(value, message) {
  if (value?.accepted !== true) throw new RecoveryRequired(message);
  return value;
}

function assertSafeInteger(value, message) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RecoveryRequired(message);
}

function evidenceRecord(evidence, now, event, details = {}) {
  evidence.push({
    timestamp: new Date(now()).toISOString(),
    event,
    status: "accepted",
    details,
  });
}

function validateDependencies(adapters) {
  for (const [boundary, methods] of Object.entries({
    deploy: ["freeze", "thaw"],
    edge: [
      "captureDns",
      "enableMaintenance",
      "verifyMaintenance",
      "dnsChanged",
      "restoreDns",
      "disableMaintenance",
    ],
    source: [
      "stopProductionAppAndDisableRecreate",
      "sampleApplicationSessions",
      "captureFence",
      "assertFenceUnchanged",
      "startProductionApp",
      "validatePrivate",
    ],
    candidate: [
      "restorePostFenceArchive",
      "validateIntegrity",
      "validateReadOnly",
    ],
    epoch: ["hasDigitalOceanWriteEpoch"],
  })) {
    if (!adapters?.[boundary])
      throw new Error(`missing ${boundary} operational boundary`);
    for (const method of methods) {
      if (typeof adapters[boundary][method] !== "function")
        throw new Error(`missing ${boundary}.${method} operational boundary`);
    }
  }
}

function validateStoppedApp(result) {
  if (
    result?.stoppedService !== "racknerd-production-app" ||
    result?.recreateDisabled !== true ||
    result?.databaseStopped !== false ||
    result?.stagingTouched !== false
  ) {
    throw new RecoveryRequired("source-application-scope-invalid");
  }
}

function validateActivitySample(sample) {
  assertSafeInteger(sample?.applicationSessions, "activity-sample-invalid");
  if (sample.applicationSessions !== 0)
    throw new RecoveryRequired("application-session-after-stop");
}

function validateFenceSnapshot(snapshot) {
  if (!walLsnPattern.test(snapshot?.walLsn ?? ""))
    throw new RecoveryRequired("source-wal-position-invalid");
  assertSafeInteger(snapshot?.writeCounter, "source-write-counter-invalid");
  assertSafeInteger(
    snapshot?.appRestartCounter,
    "source-restart-counter-invalid",
  );
}

function validateFenceObservation(observation, fence) {
  validateActivitySample(observation);
  validateFenceSnapshot(observation);
  if (observation.appRestartCounter !== fence.sourceAppRestartCounter)
    throw new RecoveryRequired("source-app-restarted-after-fence");
  if (observation.writeCounter !== fence.sourceWriteCounter)
    throw new RecoveryRequired("source-write-after-fence");
  if (observation.walLsn !== fence.sourceWalLsn)
    throw new RecoveryRequired("source-wal-advanced-after-fence");
}

function validateArchive(archive, fence) {
  if (
    !sha256Pattern.test(archive?.sha256 ?? "") ||
    typeof archive?.candidateDatabase !== "string" ||
    archive.candidateDatabase.length === 0 ||
    archive?.restored !== true ||
    archive?.freshCandidate !== true ||
    archive?.sourceFenceSignature !== fence.signature ||
    !Number.isFinite(Date.parse(archive?.createdAt ?? "")) ||
    Date.parse(archive.createdAt) < Date.parse(fence.fencedAt)
  ) {
    throw new RecoveryRequired("post-fence-archive-invalid");
  }
}

function stopReason(shouldStop) {
  const value = shouldStop?.();
  if (value === true) return "operator-stop";
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

async function recoverUnchangedRackNerd({
  adapters,
  context,
  evidence,
  now,
  reason,
}) {
  if (await adapters.epoch.hasDigitalOceanWriteEpoch())
    throw new PreWriteRecoveryRejected();

  if (context.dnsSnapshot && (await adapters.edge.dnsChanged())) {
    accepted(
      await adapters.edge.restoreDns(context.dnsSnapshot),
      "dns-restore-failed",
    );
    evidenceRecord(evidence, now, "pre-write.dns-restored");
  }
  if (context.sourceAppStopped) {
    accepted(
      await adapters.source.startProductionApp({
        service: "racknerd-production-app",
      }),
      "source-app-restart-failed",
    );
    evidenceRecord(evidence, now, "pre-write.source-app-restarted");
  }
  if (context.sourceAppStopped || context.maintenanceEnabled) {
    const validation = accepted(
      await adapters.source.validatePrivate(),
      "source-private-validation-failed",
    );
    if (
      validation.database !== "racknerd-production" ||
      validation.application !== "racknerd-production-app" ||
      validation.ready !== true
    ) {
      throw new Error("unchanged RackNerd private validation was ambiguous");
    }
    evidenceRecord(evidence, now, "pre-write.source-privately-validated");
  }
  if (context.maintenanceEnabled) {
    accepted(
      await adapters.edge.disableMaintenance(),
      "maintenance-removal-failed",
    );
    evidenceRecord(evidence, now, "pre-write.maintenance-removed");
  }
  for (const environment of [...context.frozen].reverse()) {
    const thawed = accepted(
      await adapters.deploy.thaw(environment),
      `${environment}-deploy-thaw-failed`,
    );
    if (thawed.environment !== environment || thawed.frozen !== false)
      throw new Error(`${environment} deployment thaw was ambiguous`);
  }
  evidenceRecord(evidence, now, "pre-write.recovered", { reason });
  return {
    schemaVersion: 1,
    runId: context.runId,
    status: "recovered",
    authority: "racknerd-production",
    reason,
    evidence,
  };
}

export async function runPreWriteCutover({
  runId,
  signingKey,
  maintenanceNetworks,
  adapters,
  now = Date.now,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  shouldStop = () => false,
  deadlineMs = PRE_WRITE_DEADLINE_MS,
}) {
  if (!runIdPattern.test(runId ?? ""))
    throw new Error("invalid UTC migration run identifier");
  normalizedSigningKey(signingKey);
  validateDependencies(adapters);
  const networks = [...new Set(maintenanceNetworks ?? [])];
  if (networks.length !== 2 || networks.some((network) => !network))
    throw new Error(
      "exactly two distinct maintenance verification networks are required",
    );
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0)
    throw new Error("pre-write deadline must be a positive integer");

  const startedAtMs = now();
  const evidence = [];
  const context = {
    runId,
    dnsSnapshot: null,
    maintenanceEnabled: false,
    sourceAppStopped: false,
    frozen: [],
  };
  const checkpoint = () => {
    const immediate = stopReason(shouldStop);
    if (immediate) throw new RecoveryRequired(immediate);
    if (now() - startedAtMs >= deadlineMs)
      throw new RecoveryRequired("minute-45-deadline");
  };

  try {
    context.dnsSnapshot = await adapters.edge.captureDns();
    for (const environment of [
      "racknerd-production",
      "digitalocean-production",
    ]) {
      checkpoint();
      const freezeResult = await adapters.deploy.freeze(environment);
      context.frozen.push(environment);
      const frozen = accepted(
        freezeResult,
        `${environment}-deploy-freeze-failed`,
      );
      if (frozen.environment !== environment || frozen.frozen !== true)
        throw new RecoveryRequired(`${environment}-deploy-freeze-ambiguous`);
      evidenceRecord(evidence, now, "pre-write.deploy-frozen", { environment });
    }

    checkpoint();
    const maintenanceResult = await adapters.edge.enableMaintenance();
    context.maintenanceEnabled = true;
    accepted(maintenanceResult, "maintenance-activation-failed");
    for (const network of networks) {
      const maintenance = accepted(
        await adapters.edge.verifyMaintenance(network),
        `maintenance-verification-failed:${network}`,
      );
      if (
        maintenance.network !== network ||
        maintenance.status !== 503 ||
        maintenance.originContacted !== false
      ) {
        throw new RecoveryRequired(
          `maintenance-verification-ambiguous:${network}`,
        );
      }
    }
    evidenceRecord(evidence, now, "pre-write.maintenance-verified", {
      networkCount: networks.length,
    });

    checkpoint();
    const stopped = await adapters.source.stopProductionAppAndDisableRecreate({
      service: "racknerd-production-app",
    });
    context.sourceAppStopped = true;
    validateStoppedApp(stopped);
    evidenceRecord(evidence, now, "pre-write.source-app-stopped", {
      recreateDisabled: true,
      databaseStopped: false,
      stagingTouched: false,
    });

    const activitySamples = [];
    for (let index = 0; index < REQUIRED_ACTIVITY_SAMPLES; index += 1) {
      checkpoint();
      const sample = await adapters.source.sampleApplicationSessions();
      validateActivitySample(sample);
      activitySamples.push({
        sampledAt: new Date(now()).toISOString(),
        applicationSessions: sample.applicationSessions,
      });
      if (index < REQUIRED_ACTIVITY_SAMPLES - 1)
        await sleep(ACTIVITY_SAMPLE_INTERVAL_MS);
    }
    const sampleSpanMs =
      Date.parse(activitySamples.at(-1).sampledAt) -
      Date.parse(activitySamples[0].sampledAt);
    if (sampleSpanMs < 60_000)
      throw new RecoveryRequired("activity-sample-window-too-short");
    evidenceRecord(evidence, now, "pre-write.application-sessions-cleared", {
      sampleCount: activitySamples.length,
      sampleSpanMs,
    });

    checkpoint();
    const snapshot = await adapters.source.captureFence();
    validateFenceSnapshot(snapshot);
    const unsignedFence = {
      schemaVersion: 1,
      runId,
      fencedAt: new Date(now()).toISOString(),
      sourceWalLsn: snapshot.walLsn,
      sourceWriteCounter: snapshot.writeCounter,
      sourceAppRestartCounter: snapshot.appRestartCounter,
    };
    const fence = {
      ...unsignedFence,
      signature: signatureFor(unsignedFence, signingKey),
    };
    evidenceRecord(evidence, now, "pre-write.source-fenced", {
      fence,
      activitySamples,
    });

    checkpoint();
    validateFenceObservation(
      await adapters.source.assertFenceUnchanged(fence),
      fence,
    );
    const archive = await adapters.candidate.restorePostFenceArchive({
      runId,
      fence,
    });
    validateArchive(archive, fence);
    validateFenceObservation(
      await adapters.source.assertFenceUnchanged(fence),
      fence,
    );
    const integrity = accepted(
      await adapters.candidate.validateIntegrity(archive.candidateDatabase),
      "candidate-integrity-rejected",
    );
    if (
      !Array.isArray(integrity.failedGates) ||
      integrity.failedGates.length !== 0 ||
      integrity.archiveSha256 !== archive.sha256
    ) {
      throw new RecoveryRequired("candidate-integrity-evidence-invalid");
    }
    const readOnly = accepted(
      await adapters.candidate.validateReadOnly(archive.candidateDatabase),
      "candidate-read-only-gates-rejected",
    );
    if (
      readOnly.writeAttemptRejected !== true ||
      readOnly.writeEpochDeclared !== false ||
      readOnly.readiness !== "ready" ||
      readOnly.applicationRole !== "uwplan_app"
    ) {
      throw new RecoveryRequired("candidate-read-only-boundary-invalid");
    }
    validateFenceObservation(
      await adapters.source.assertFenceUnchanged(fence),
      fence,
    );
    checkpoint();
    evidenceRecord(evidence, now, "pre-write.candidate-accepted", {
      archiveSha256: archive.sha256,
      candidateDatabase: archive.candidateDatabase,
      integrity: "accepted",
      readOnly: true,
    });

    return {
      schemaVersion: 1,
      runId,
      status: "ready-for-origin-switch",
      authority: "racknerd-production",
      fence,
      archive: {
        sha256: archive.sha256,
        createdAt: archive.createdAt,
        candidateDatabase: archive.candidateDatabase,
      },
      evidence,
    };
  } catch (error) {
    const reason =
      error instanceof RecoveryRequired
        ? error.reason
        : error instanceof Error
          ? `operation-failed:${error.message}`
          : "operation-failed";
    return await recoverUnchangedRackNerd({
      adapters,
      context,
      evidence,
      now,
      reason,
    });
  }
}
