// @ts-nocheck -- Runtime-validated operational module consumed directly by Node.

export const RESOURCE_POLICY = Object.freeze({
  schemaVersion: 1,
  fiveMinuteSeconds: 5 * 60,
  separatePeriods: 3,
  minimumHostMemoryBytesAfterResize: 2 * 1024 ** 3,
  memoryAvailableMinimumPercent: 15,
  activeSwapMaximumBytesPerSecond: 1024 ** 2,
  serviceMemoryMaximumPercent: 90,
  hostCpuMaximumPercent: 90,
  diskMaximumPercent: 80,
  inodeMaximumPercent: 80,
  diskFreeMinimumBytes: 5 * 1024 ** 3,
  readinessSuccessMinimumPercent: 99.9,
  readinessMaximumConsecutiveFailures: 1,
  plannedRecoveryMaximumMilliseconds: 2 * 60 * 1000,
  readinessP95MaximumMilliseconds: 500,
  readinessMaximumMilliseconds: 2_000,
  coreP95MaximumMilliseconds: 2_000,
  coreMaximumMilliseconds: 5_000,
});

const services = ["app", "db", "alloy"];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegative(value, fallback = 0) {
  return finite(value) && value >= 0 ? value : fallback;
}

function percentile(values, percentileRank) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values.filter(finite)].sort((left, right) => left - right);
  if (sorted.length !== values.length || sorted.length === 0) return null;
  const index = Math.max(
    0,
    Math.ceil((percentileRank / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

function longestBreachSeconds(observations, predicate) {
  let longest = 0;
  let current = 0;
  for (const observation of observations) {
    if (predicate(observation)) {
      current += nonNegative(observation.windowSeconds, 60);
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function breachPeriods(observations, predicate) {
  let periods = 0;
  let active = false;
  for (const observation of observations) {
    const breached = predicate(observation);
    if (breached && !active) periods += 1;
    active = breached;
  }
  return periods;
}

function thresholdTriggered(observations, predicate) {
  return (
    longestBreachSeconds(observations, predicate) >=
      RESOURCE_POLICY.fiveMinuteSeconds ||
    breachPeriods(observations, predicate) >= RESOURCE_POLICY.separatePeriods
  );
}

function total(observations, read) {
  return observations.reduce(
    (sum, observation) => sum + nonNegative(read(observation)),
    0,
  );
}

function reason(code, message, evidence) {
  return { code, message, evidence };
}

function missingMeasurementFields(observation) {
  const numericPaths = [
    ["windowSeconds"],
    ["events", "oomKills"],
    ["events", "memoryLimitKills"],
    ["restarts", "resourceCaused"],
    ["restarts", "unexplained"],
    ["restarts", "counterIncrease"],
    ["restarts", "noticed"],
    ["host", "memoryAvailablePercent"],
    ["host", "activeSwapBytesPerSecond"],
    ["host", "cpuPercent"],
    ["host", "diskUsedPercent"],
    ["host", "diskFreeBytes"],
    ["host", "inodeUsedPercent"],
    ["services", "app", "memoryLimitPercent"],
    ["services", "db", "memoryLimitPercent"],
    ["services", "alloy", "memoryLimitPercent"],
    ["availability", "successfulProbes"],
    ["availability", "totalProbes"],
    ["availability", "maximumConsecutiveFailures"],
    ["availability", "plannedRecoveryMilliseconds"],
  ];
  return numericPaths
    .filter((path) => {
      const value = path.reduce(
        (candidate, key) => candidate?.[key],
        observation,
      );
      return !finite(value) || value < 0;
    })
    .map((path) => path.join("."));
}

function latencyEvidence(observations, key) {
  const samples = observations.flatMap((observation) => {
    const value = observation.latency?.[key];
    return Array.isArray(value) ? value : [];
  });
  return {
    samples: samples.length,
    p95Milliseconds: percentile(samples, 95),
    maximumMilliseconds: samples.length === 0 ? null : Math.max(...samples),
  };
}

/**
 * Evaluate already-measured soak observations. The evaluator is deliberately
 * clock-free: callers supply sample durations and counters, so CI can exercise
 * every five-minute/three-period branch without sleeping.
 */
export function evaluateRecoveryPolicy(observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new TypeError("at least one recovery observation is required");
  }

  const resizeReasons = [];
  const blockers = [];
  const investigations = [];

  const missingMeasurements = observations.flatMap((observation, index) =>
    missingMeasurementFields(observation).map((field) => ({ index, field })),
  );
  if (missingMeasurements.length > 0) {
    blockers.push(
      reason(
        "missing-resource-evidence",
        "Every resource, OOM, restart, availability, and service-limit measurement is required.",
        { missingMeasurements },
      ),
    );
  }

  const oomKills = total(observations, (entry) => entry.events?.oomKills);
  const memoryLimitKills = total(
    observations,
    (entry) => entry.events?.memoryLimitKills,
  );
  const resourceRestarts = total(
    observations,
    (entry) => entry.restarts?.resourceCaused,
  );
  const unexplainedRestarts = total(
    observations,
    (entry) => entry.restarts?.unexplained,
  );
  const restartCounterIncrease = total(
    observations,
    (entry) => entry.restarts?.counterIncrease,
  );
  const noticedRestarts = total(
    observations,
    (entry) => entry.restarts?.noticed,
  );

  if (oomKills > 0 || memoryLimitKills > 0 || resourceRestarts > 0) {
    resizeReasons.push(
      reason(
        "resource-restart",
        "An OOM, memory-limit kill, or resource-caused restart requires at least 2 GiB and a complete repeat soak.",
        { oomKills, memoryLimitKills, resourceRestarts },
      ),
    );
  }
  if (unexplainedRestarts > 0) {
    blockers.push(
      reason(
        "unexplained-restart",
        "Every unexplained app, PostgreSQL, or Alloy restart blocks cutover.",
        { unexplainedRestarts },
      ),
    );
  }
  if (restartCounterIncrease > noticedRestarts) {
    blockers.push(
      reason(
        "unnoticed-restart-counter",
        "A container restart counter increased without a matching noticed event.",
        { restartCounterIncrease, noticedRestarts },
      ),
    );
  }

  const memoryPredicate = (entry) =>
    finite(entry.host?.memoryAvailablePercent) &&
    entry.host.memoryAvailablePercent <
      RESOURCE_POLICY.memoryAvailableMinimumPercent;
  if (thresholdTriggered(observations, memoryPredicate)) {
    resizeReasons.push(
      reason(
        "host-memory",
        "MemAvailable breached the accepted five-minute or three-period threshold.",
        {
          longestSeconds: longestBreachSeconds(observations, memoryPredicate),
          periods: breachPeriods(observations, memoryPredicate),
        },
      ),
    );
  }

  const swapPredicate = (entry) =>
    finite(entry.host?.activeSwapBytesPerSecond) &&
    entry.host.activeSwapBytesPerSecond >
      RESOURCE_POLICY.activeSwapMaximumBytesPerSecond;
  if (thresholdTriggered(observations, swapPredicate)) {
    resizeReasons.push(
      reason(
        "active-swap",
        "Active swap I/O breached 1 MiB/s for five minutes or three periods.",
        {
          longestSeconds: longestBreachSeconds(observations, swapPredicate),
          periods: breachPeriods(observations, swapPredicate),
        },
      ),
    );
  }

  for (const service of services) {
    const servicePredicate = (entry) =>
      finite(entry.services?.[service]?.memoryLimitPercent) &&
      entry.services[service].memoryLimitPercent >
        RESOURCE_POLICY.serviceMemoryMaximumPercent;
    if (
      longestBreachSeconds(observations, servicePredicate) >=
      RESOURCE_POLICY.fiveMinuteSeconds
    ) {
      resizeReasons.push(
        reason(
          `service-memory-${service}`,
          `${service} exceeded 90% of its memory limit for five minutes.`,
          {
            service,
            longestSeconds: longestBreachSeconds(
              observations,
              servicePredicate,
            ),
          },
        ),
      );
    }
  }

  const cpuPredicate = (entry) =>
    finite(entry.host?.cpuPercent) &&
    entry.host.cpuPercent > RESOURCE_POLICY.hostCpuMaximumPercent;
  if (
    longestBreachSeconds(observations, cpuPredicate) >=
    RESOURCE_POLICY.fiveMinuteSeconds
  ) {
    investigations.push(
      reason(
        "host-cpu",
        "Host CPU exceeded 90% for five minutes and requires attribution before cutover.",
        {
          longestSeconds: longestBreachSeconds(observations, cpuPredicate),
        },
      ),
    );
  }

  for (const entry of observations) {
    if (
      (finite(entry.host?.diskUsedPercent) &&
        entry.host.diskUsedPercent >= RESOURCE_POLICY.diskMaximumPercent) ||
      (finite(entry.host?.diskFreeBytes) &&
        entry.host.diskFreeBytes < RESOURCE_POLICY.diskFreeMinimumBytes)
    ) {
      blockers.push(
        reason(
          "disk-capacity",
          "Disk capacity reached 80% or fell below 5 GiB free.",
          {
            diskUsedPercent: entry.host?.diskUsedPercent,
            diskFreeBytes: entry.host?.diskFreeBytes,
          },
        ),
      );
      break;
    }
  }
  const inodeBreach = observations.find(
    (entry) =>
      finite(entry.host?.inodeUsedPercent) &&
      entry.host.inodeUsedPercent >= RESOURCE_POLICY.inodeMaximumPercent,
  );
  if (inodeBreach) {
    blockers.push(
      reason(
        "inode-capacity",
        "Inode use reached the accepted 80% stop threshold.",
        { inodeUsedPercent: inodeBreach.host.inodeUsedPercent },
      ),
    );
  }

  const successfulProbes = total(
    observations,
    (entry) => entry.availability?.successfulProbes,
  );
  const totalProbes = total(
    observations,
    (entry) => entry.availability?.totalProbes,
  );
  const successPercent =
    totalProbes === 0 ? null : (successfulProbes / totalProbes) * 100;
  const maximumConsecutiveFailures = observations.reduce(
    (maximum, entry) =>
      Math.max(
        maximum,
        nonNegative(entry.availability?.maximumConsecutiveFailures),
      ),
    0,
  );
  if (successPercent === null) {
    blockers.push(
      reason(
        "missing-availability-evidence",
        "External readiness probe evidence is required.",
        { totalProbes },
      ),
    );
  } else if (
    successPercent < RESOURCE_POLICY.readinessSuccessMinimumPercent ||
    maximumConsecutiveFailures >
      RESOURCE_POLICY.readinessMaximumConsecutiveFailures
  ) {
    blockers.push(
      reason(
        "availability",
        "Readiness probes missed the 99.9% or consecutive-failure tolerance.",
        { successPercent, maximumConsecutiveFailures },
      ),
    );
  }

  const plannedRecoveryMilliseconds = observations.reduce(
    (maximum, entry) =>
      Math.max(
        maximum,
        nonNegative(entry.availability?.plannedRecoveryMilliseconds),
      ),
    0,
  );
  if (
    plannedRecoveryMilliseconds >
    RESOURCE_POLICY.plannedRecoveryMaximumMilliseconds
  ) {
    blockers.push(
      reason(
        "planned-recovery-time",
        "The planned restart test did not restore readiness within two minutes.",
        { plannedRecoveryMilliseconds },
      ),
    );
  }

  const readinessLatency = latencyEvidence(
    observations,
    "externalReadinessMilliseconds",
  );
  if (readinessLatency.samples === 0) {
    blockers.push(
      reason(
        "missing-readiness-latency",
        "External readiness latency samples are required.",
        readinessLatency,
      ),
    );
  } else if (
    readinessLatency.p95Milliseconds >
      RESOURCE_POLICY.readinessP95MaximumMilliseconds ||
    readinessLatency.maximumMilliseconds >
      RESOURCE_POLICY.readinessMaximumMilliseconds
  ) {
    blockers.push(
      reason(
        "readiness-latency",
        "Readiness latency exceeded the accepted p95 or individual response threshold.",
        readinessLatency,
      ),
    );
  }

  const coreLatency = latencyEvidence(observations, "coreRequestMilliseconds");
  if (coreLatency.samples === 0) {
    blockers.push(
      reason(
        "missing-core-latency",
        "Core page and server-action latency samples are required.",
        coreLatency,
      ),
    );
  } else if (
    coreLatency.p95Milliseconds > RESOURCE_POLICY.coreP95MaximumMilliseconds ||
    coreLatency.maximumMilliseconds > RESOURCE_POLICY.coreMaximumMilliseconds
  ) {
    blockers.push(
      reason(
        "core-latency",
        "Core request latency exceeded the accepted p95 or individual response threshold.",
        coreLatency,
      ),
    );
  }

  const reasons = [...resizeReasons, ...blockers, ...investigations];
  const outcome =
    resizeReasons.length > 0
      ? "resize-repeat-soak"
      : blockers.length > 0
        ? "block-cutover"
        : investigations.length > 0
          ? "investigate"
          : "accept";

  return Object.freeze({
    schemaVersion: RESOURCE_POLICY.schemaVersion,
    outcome,
    accepted: outcome === "accept",
    repeatSoak: outcome === "resize-repeat-soak",
    minimumHostMemoryBytes:
      outcome === "resize-repeat-soak"
        ? RESOURCE_POLICY.minimumHostMemoryBytesAfterResize
        : null,
    observationCount: observations.length,
    reasons: Object.freeze(reasons.map((entry) => Object.freeze(entry))),
    evidence: Object.freeze({
      oomKills,
      memoryLimitKills,
      resourceRestarts,
      unexplainedRestarts,
      restartCounterIncrease,
      noticedRestarts,
      successfulProbes,
      totalProbes,
      successPercent,
      maximumConsecutiveFailures,
      plannedRecoveryMilliseconds,
      readinessLatency,
      coreLatency,
    }),
  });
}
