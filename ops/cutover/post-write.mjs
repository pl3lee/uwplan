import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_SAMPLE_INTERVAL_MS = 30 * 1000;
export const REQUIRED_ZERO_SESSION_SAMPLES = 3;
export const MAINTENANCE_READINESS_INTERVAL_MS = 60 * 1000;
export const MAINTENANCE_READINESS_WINDOW_MS = 5 * 60 * 1000;
export const PUBLIC_MONITOR_INTERVAL_MS = 5 * 60 * 1000;
export const PUBLIC_MONITOR_WINDOW_MS = 60 * 60 * 1000;
export const DIGITALOCEAN_READ_ONLY_GATES = Object.freeze([
  "digitalocean-integrity",
  "digitalocean-read-only",
  "digitalocean-origin-readiness",
]);
export const RACKNERD_REVERSE_READ_ONLY_GATES = Object.freeze([
  "racknerd-reverse-integrity",
  "racknerd-reverse-read-only",
  "racknerd-maintenance-readiness",
]);

const runIdPattern = /^[0-9]{8}T[0-9]{9}Z$/;
const databasePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const epochActions = new Set([
  "declare-digitalocean-write-epoch",
  "declare-racknerd-write-epoch",
]);

function normalizedSigningKey(signingKey) {
  const key = Buffer.isBuffer(signingKey)
    ? signingKey
    : Buffer.from(String(signingKey ?? ""), "utf8");
  if (key.length < 32)
    throw new Error("the evidence signing key must contain at least 32 bytes");
  return key;
}

function canonicalGateReceipts(receipts) {
  return [...receipts]
    .map(({ gate, verifiedAt, digest }) => ({ gate, verifiedAt, digest }))
    .sort((left, right) => left.gate.localeCompare(right.gate));
}

function canonicalEpochPayload(action) {
  return JSON.stringify({
    schemaVersion: 1,
    runId: action.runId,
    operator: action.operator,
    action: action.action,
    database: action.database,
    issuedAt: action.issuedAt,
    gateReceipts: canonicalGateReceipts(action.gateReceipts ?? []),
  });
}

export function signEpochAction(unsignedAction, signingKey) {
  const action = {
    ...unsignedAction,
    gateReceipts: canonicalGateReceipts(unsignedAction.gateReceipts ?? []),
  };
  return {
    ...action,
    signature: createHmac("sha256", normalizedSigningKey(signingKey))
      .update(canonicalEpochPayload(action))
      .digest("hex"),
  };
}

function validGateReceipt(receipt) {
  return (
    typeof receipt?.gate === "string" &&
    receipt.gate.length > 0 &&
    Number.isFinite(Date.parse(receipt?.verifiedAt ?? "")) &&
    sha256Pattern.test(receipt?.digest ?? "")
  );
}

export function verifyEpochAction(
  action,
  { signingKey, runId, expectedAction, expectedDatabase, requiredGates },
) {
  if (
    action?.schemaVersion !== 1 ||
    action?.runId !== runId ||
    !runIdPattern.test(action?.runId ?? "") ||
    action?.operator !== "pl3lee" ||
    action?.action !== expectedAction ||
    !epochActions.has(action?.action) ||
    action?.database !== expectedDatabase ||
    !databasePattern.test(action?.database ?? "") ||
    !Number.isFinite(Date.parse(action?.issuedAt ?? "")) ||
    !Array.isArray(action?.gateReceipts) ||
    !sha256Pattern.test(action?.signature ?? "") ||
    action.gateReceipts.some((receipt) => !validGateReceipt(receipt))
  ) {
    return false;
  }

  const gates = action.gateReceipts.map(({ gate }) => gate);
  const uniqueGates = new Set(gates);
  const expectedGates = new Set(requiredGates);
  if (
    uniqueGates.size !== gates.length ||
    uniqueGates.size !== expectedGates.size ||
    [...expectedGates].some((gate) => !uniqueGates.has(gate))
  ) {
    return false;
  }
  const issuedAt = Date.parse(action.issuedAt);
  if (
    action.gateReceipts.some(
      ({ verifiedAt }) => issuedAt <= Date.parse(verifiedAt),
    )
  ) {
    return false;
  }

  let expected;
  try {
    expected = Buffer.from(
      createHmac("sha256", normalizedSigningKey(signingKey))
        .update(canonicalEpochPayload(action))
        .digest("hex"),
      "hex",
    );
  } catch {
    return false;
  }
  const actual = Buffer.from(action.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function accepted(result, reason) {
  if (result?.accepted !== true) throw new Error(reason);
  return result;
}

function assertSafeCount(value, reason) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(reason);
}

function record(evidence, now, event, details = {}) {
  evidence.push({
    timestamp: new Date(now()).toISOString(),
    event,
    status: "accepted",
    details,
  });
}

function validateAdapters(adapters) {
  const boundaries = {
    deploy: ["freeze", "thaw"],
    edge: [
      "enableMaintenance",
      "verifyMaintenance",
      "switchToRackNerd",
      "sampleMaintenanceReadiness",
      "readinessGateReceipt",
      "disableMaintenance",
      "samplePublicReadiness",
    ],
    source: [
      "verifyReadable",
      "stopWritersAndDisableRecreate",
      "sampleApplicationSessions",
      "captureCurrentData",
    ],
    backup: ["latestVerified"],
    candidate: [
      "restoreFresh",
      "validateIntegrity",
      "validateReadOnly",
      "attachPreservedApp",
      "declareWriteEpoch",
      "validatePrivateAuthAndWrite",
    ],
    operator: ["authorizeRackNerdWriteEpoch"],
  };
  for (const [boundary, methods] of Object.entries(boundaries)) {
    if (!adapters?.[boundary])
      throw new Error(`missing ${boundary} operational boundary`);
    for (const method of methods) {
      if (typeof adapters[boundary][method] !== "function")
        throw new Error(`missing ${boundary}.${method} operational boundary`);
    }
  }
}

function validateGateReceipt(
  receipt,
  gate,
  {
    notBefore = Number.NEGATIVE_INFINITY,
    notAfter = Number.POSITIVE_INFINITY,
  } = {},
) {
  const verifiedAt = Date.parse(receipt?.verifiedAt ?? "");
  if (
    !validGateReceipt(receipt) ||
    receipt.gate !== gate ||
    verifiedAt < notBefore ||
    verifiedAt > notAfter
  )
    throw new Error(`${gate} gate receipt is invalid`);
  return receipt;
}

async function sampleWindow({
  durationMs,
  intervalMs,
  now,
  sleep,
  sample,
  validate,
}) {
  const startedAt = now();
  const sampleCount = durationMs / intervalMs + 1;
  for (let index = 0; index < sampleCount; index += 1) {
    validate(await sample(), index);
    if (index + 1 < sampleCount) await sleep(intervalMs);
  }
  const completedAt = now();
  if (completedAt - startedAt < durationMs)
    throw new Error("the required observation window did not elapse");
  return { sampleCount, startedAt, completedAt };
}

function validateOptions({
  runId,
  digitalOceanDatabase,
  initialReadOnlyGates,
  maintenanceNetworks,
}) {
  if (!runIdPattern.test(runId ?? ""))
    throw new Error("invalid UTC migration run identifier");
  if (!databasePattern.test(digitalOceanDatabase ?? ""))
    throw new Error("invalid DigitalOcean database identity");
  if (!Array.isArray(initialReadOnlyGates) || initialReadOnlyGates.length === 0)
    throw new Error("DigitalOcean read-only gate receipts are required");
  if (initialReadOnlyGates.some((receipt) => !validGateReceipt(receipt)))
    throw new Error("DigitalOcean read-only gate receipt is invalid");
  const initialGateNames = initialReadOnlyGates.map(({ gate }) => gate);
  if (
    new Set(initialGateNames).size !== initialGateNames.length ||
    initialGateNames.length !== DIGITALOCEAN_READ_ONLY_GATES.length ||
    DIGITALOCEAN_READ_ONLY_GATES.some(
      (gate) => !initialGateNames.includes(gate),
    )
  ) {
    throw new Error("the complete DigitalOcean read-only gate set is required");
  }
  const networks = [...new Set(maintenanceNetworks ?? [])];
  if (networks.length !== 2 || networks.some((network) => !network))
    throw new Error("exactly two distinct verification networks are required");
  return networks;
}

export async function runPostWriteReverseMigration({
  runId,
  signingKey,
  digitalOceanDatabase,
  digitalOceanEpochAction,
  initialReadOnlyGates,
  maintenanceNetworks,
  adapters,
  now = Date.now,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  normalizedSigningKey(signingKey);
  const networks = validateOptions({
    runId,
    digitalOceanDatabase,
    initialReadOnlyGates,
    maintenanceNetworks,
  });
  validateAdapters(adapters);

  if (
    !verifyEpochAction(digitalOceanEpochAction, {
      signingKey,
      runId,
      expectedAction: "declare-digitalocean-write-epoch",
      expectedDatabase: digitalOceanDatabase,
      requiredGates: [...DIGITALOCEAN_READ_ONLY_GATES],
    }) ||
    Date.parse(digitalOceanEpochAction.issuedAt) > now()
  ) {
    throw new Error(
      "DigitalOcean write epoch requires a signed operator action after every read-only gate",
    );
  }

  const evidence = [];
  record(evidence, now, "post-write.digitalocean-epoch-verified", {
    operator: "pl3lee",
    database: digitalOceanDatabase,
    readOnlyGateCount: initialReadOnlyGates.length,
  });

  const readable = await adapters.source.verifyReadable({
    database: digitalOceanDatabase,
  });
  if (readable?.readable !== true) {
    const backup = await adapters.backup.latestVerified();
    if (
      backup?.verified !== true ||
      !Number.isFinite(Date.parse(backup?.capturedAt ?? "")) ||
      Date.parse(backup.capturedAt) > now() ||
      !sha256Pattern.test(backup?.sha256 ?? "")
    ) {
      throw new Error(
        "DigitalOcean is unreadable and no verified recovery point is available",
      );
    }
    const rpoSeconds = Math.max(
      0,
      Math.floor((now() - Date.parse(backup.capturedAt)) / 1000),
    );
    record(evidence, now, "post-write.human-acceptance-required", {
      latestVerifiedBackupAt: backup.capturedAt,
      rpoSeconds,
    });
    return {
      schemaVersion: 1,
      runId,
      status: "human-acceptance-required",
      authority: "digitalocean-final",
      explicitAcceptanceRequired: true,
      latestVerifiedBackup: {
        capturedAt: backup.capturedAt,
        sha256: backup.sha256,
        rpoSeconds,
      },
      evidence,
    };
  }

  for (const environment of [
    "digitalocean-production",
    "racknerd-production",
  ]) {
    const frozen = accepted(
      await adapters.deploy.freeze(environment),
      `${environment} deployment freeze failed`,
    );
    if (frozen.environment !== environment || frozen.frozen !== true)
      throw new Error(`${environment} deployment freeze was ambiguous`);
  }
  record(evidence, now, "post-write.deployments-frozen", {
    environments: 2,
  });

  accepted(
    await adapters.edge.enableMaintenance(),
    "maintenance activation failed",
  );
  for (const network of networks) {
    const maintenance = accepted(
      await adapters.edge.verifyMaintenance(network),
      `maintenance verification failed:${network}`,
    );
    if (
      maintenance.network !== network ||
      maintenance.status !== 503 ||
      maintenance.originContacted !== false
    ) {
      throw new Error(`maintenance verification was ambiguous:${network}`);
    }
  }
  record(evidence, now, "post-write.maintenance-verified", {
    networkCount: networks.length,
  });

  const stopped = await adapters.source.stopWritersAndDisableRecreate({
    service: "digitalocean-production-app",
  });
  if (
    stopped?.stoppedService !== "digitalocean-production-app" ||
    stopped?.recreateDisabled !== true ||
    stopped?.databaseStopped !== false ||
    stopped?.rackNerdTouched !== false
  ) {
    throw new Error("DigitalOcean writer stop scope was ambiguous");
  }
  for (let index = 0; index < REQUIRED_ZERO_SESSION_SAMPLES; index += 1) {
    const sample = await adapters.source.sampleApplicationSessions();
    assertSafeCount(sample?.applicationSessions, "activity sample is invalid");
    if (sample.applicationSessions !== 0)
      throw new Error("DigitalOcean still has application sessions");
    if (index + 1 < REQUIRED_ZERO_SESSION_SAMPLES)
      await sleep(SESSION_SAMPLE_INTERVAL_MS);
  }
  record(evidence, now, "post-write.digitalocean-writers-fenced", {
    sampleCount: REQUIRED_ZERO_SESSION_SAMPLES,
    sampleSpanMs:
      SESSION_SAMPLE_INTERVAL_MS * (REQUIRED_ZERO_SESSION_SAMPLES - 1),
  });
  const writersFencedAt = now();

  const capture = await adapters.source.captureCurrentData({
    runId,
    database: digitalOceanDatabase,
  });
  if (
    capture?.database !== digitalOceanDatabase ||
    capture?.current !== true ||
    capture?.protected !== true ||
    !sha256Pattern.test(capture?.sha256 ?? "") ||
    !Number.isFinite(Date.parse(capture?.capturedAt ?? "")) ||
    Date.parse(capture.capturedAt) < writersFencedAt ||
    Date.parse(capture.capturedAt) > now()
  ) {
    throw new Error("current DigitalOcean capture is invalid");
  }
  const restored = await adapters.candidate.restoreFresh({
    runId,
    capture,
    target: "racknerd",
    forbiddenDatabase: "racknerd-production",
  });
  const candidateDatabase = restored?.candidateDatabase;
  if (
    !databasePattern.test(candidateDatabase ?? "") ||
    candidateDatabase === "racknerd-production" ||
    restored?.freshCandidate !== true ||
    restored?.restored !== true ||
    restored?.archiveSha256 !== capture.sha256 ||
    restored?.staleDatabaseStarted !== false
  ) {
    throw new Error("fresh RackNerd reverse candidate restore is invalid");
  }
  const integrity = accepted(
    await adapters.candidate.validateIntegrity(candidateDatabase),
    "reverse candidate integrity failed",
  );
  if (
    integrity.database !== candidateDatabase ||
    !Array.isArray(integrity.failedGates) ||
    integrity.failedGates.length !== 0 ||
    integrity.archiveSha256 !== capture.sha256
  ) {
    throw new Error("reverse candidate integrity was ambiguous");
  }
  const integrityReceipt = validateGateReceipt(
    integrity.gateReceipt,
    "racknerd-reverse-integrity",
    { notAfter: now() },
  );
  const readOnly = accepted(
    await adapters.candidate.validateReadOnly(candidateDatabase),
    "reverse candidate read-only validation failed",
  );
  if (
    readOnly.database !== candidateDatabase ||
    readOnly.writeAttemptRejected !== true ||
    readOnly.writeEpochDeclared !== false ||
    readOnly.readiness !== "ready"
  ) {
    throw new Error("reverse candidate read-only state was ambiguous");
  }
  const readOnlyReceipt = validateGateReceipt(
    readOnly.gateReceipt,
    "racknerd-reverse-read-only",
    { notAfter: now() },
  );
  const attached = accepted(
    await adapters.candidate.attachPreservedApp({
      application: "racknerd-production-app",
      database: candidateDatabase,
    }),
    "preserved RackNerd app attachment failed",
  );
  if (
    attached.application !== "racknerd-production-app" ||
    attached.database !== candidateDatabase ||
    attached.otherDatabasesAttached !== 0
  ) {
    throw new Error("preserved RackNerd app attachment was ambiguous");
  }
  record(evidence, now, "post-write.reverse-candidate-accepted", {
    database: candidateDatabase,
    archiveSha256: capture.sha256,
  });

  const switched = accepted(
    await adapters.edge.switchToRackNerd({
      database: candidateDatabase,
      maintenance: true,
    }),
    "RackNerd origin switch failed",
  );
  if (
    switched.database !== candidateDatabase ||
    switched.maintenance !== true ||
    switched.origin !== "racknerd"
  ) {
    throw new Error("RackNerd origin switch was ambiguous");
  }
  const readinessWindow = await sampleWindow({
    durationMs: MAINTENANCE_READINESS_WINDOW_MS,
    intervalMs: MAINTENANCE_READINESS_INTERVAL_MS,
    now,
    sleep,
    sample: () =>
      adapters.edge.sampleMaintenanceReadiness({
        networks,
        database: candidateDatabase,
      }),
    validate: (sample) => {
      if (
        sample?.maintenance !== true ||
        sample?.publicStatus !== 503 ||
        sample?.readiness !== "ready" ||
        sample?.origin !== "racknerd" ||
        sample?.database !== candidateDatabase ||
        sample?.networkCount !== networks.length
      ) {
        throw new Error("maintenance readiness window was not continuous");
      }
    },
  });
  const readinessGate = validateGateReceipt(
    await adapters.edge.readinessGateReceipt({
      database: candidateDatabase,
      sampleCount: readinessWindow.sampleCount,
    }),
    "racknerd-maintenance-readiness",
    {
      notBefore: readinessWindow.completedAt,
      notAfter: now(),
    },
  );
  record(evidence, now, "post-write.racknerd-ready-under-maintenance", {
    durationMs: MAINTENANCE_READINESS_WINDOW_MS,
    sampleCount: readinessWindow.sampleCount,
  });

  const reverseGates = [integrityReceipt, readOnlyReceipt, readinessGate];
  const rackNerdEpochAction =
    await adapters.operator.authorizeRackNerdWriteEpoch({
      runId,
      database: candidateDatabase,
      gateReceipts: reverseGates,
    });
  if (
    !verifyEpochAction(rackNerdEpochAction, {
      signingKey,
      runId,
      expectedAction: "declare-racknerd-write-epoch",
      expectedDatabase: candidateDatabase,
      requiredGates: [...RACKNERD_REVERSE_READ_ONLY_GATES],
    }) ||
    Date.parse(rackNerdEpochAction.issuedAt) > now()
  ) {
    throw new Error(
      "RackNerd write epoch requires a signed operator action after every reverse read-only gate",
    );
  }
  const epoch = accepted(
    await adapters.candidate.declareWriteEpoch({
      database: candidateDatabase,
      action: rackNerdEpochAction,
    }),
    "RackNerd write epoch declaration failed",
  );
  if (epoch.database !== candidateDatabase || epoch.writeEpoch !== true)
    throw new Error("RackNerd write epoch declaration was ambiguous");
  record(evidence, now, "post-write.racknerd-write-epoch", {
    operator: "pl3lee",
    database: candidateDatabase,
    readOnlyGateCount: reverseGates.length,
  });

  const privateValidation = accepted(
    await adapters.candidate.validatePrivateAuthAndWrite(candidateDatabase),
    "private RackNerd auth/write validation failed",
  );
  if (
    privateValidation.database !== candidateDatabase ||
    privateValidation.authenticated !== true ||
    privateValidation.writePreserved !== true
  ) {
    throw new Error("private RackNerd auth/write validation was ambiguous");
  }
  record(evidence, now, "post-write.private-auth-write-validated");

  accepted(
    await adapters.edge.disableMaintenance(),
    "maintenance removal failed",
  );
  const publicWindow = await sampleWindow({
    durationMs: PUBLIC_MONITOR_WINDOW_MS,
    intervalMs: PUBLIC_MONITOR_INTERVAL_MS,
    now,
    sleep,
    sample: () =>
      adapters.edge.samplePublicReadiness({ database: candidateDatabase }),
    validate: (sample) => {
      if (
        sample?.status !== 200 ||
        sample?.readiness !== "ready" ||
        sample?.database !== candidateDatabase ||
        sample?.origin !== "racknerd" ||
        sample?.clean !== true
      ) {
        throw new Error("public monitoring hour was not clean");
      }
    },
  });
  record(evidence, now, "post-write.public-monitoring-complete", {
    durationMs: PUBLIC_MONITOR_WINDOW_MS,
    sampleCount: publicWindow.sampleCount,
  });

  for (const environment of [
    "racknerd-production",
    "digitalocean-production",
  ]) {
    const thawed = accepted(
      await adapters.deploy.thaw(environment),
      `${environment} deployment thaw failed`,
    );
    if (thawed.environment !== environment || thawed.frozen !== false)
      throw new Error(`${environment} deployment thaw was ambiguous`);
  }
  record(evidence, now, "post-write.deployments-thawed", {
    afterCleanPublicWindowMs: PUBLIC_MONITOR_WINDOW_MS,
  });

  return {
    schemaVersion: 1,
    runId,
    status: "rolled-back",
    authority: "racknerd-reverse-candidate",
    authoritativeDatabase: candidateDatabase,
    staleDatabases: ["racknerd-production", digitalOceanDatabase],
    evidence,
  };
}
