// @ts-nocheck -- Runtime-validated operational module consumed directly by Node.

export const WATCHDOG_POLICY = Object.freeze({
  schemaVersion: 1,
  appFailureThreshold: 3,
});

export function initialWatchdogState() {
  return {
    schemaVersion: WATCHDOG_POLICY.schemaVersion,
    consecutiveAppFailures: 0,
    lastRestartCounters: { app: 0, db: 0, alloy: 0 },
  };
}

function validCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateWatchdogState(state) {
  if (
    state?.schemaVersion !== WATCHDOG_POLICY.schemaVersion ||
    !validCounter(state.consecutiveAppFailures) ||
    !["app", "db", "alloy"].every((service) =>
      validCounter(state.lastRestartCounters?.[service]),
    )
  ) {
    throw new TypeError("watchdog state is invalid");
  }
  return state;
}

function event(timestamp, name, status, details = {}) {
  return {
    schemaVersion: WATCHDOG_POLICY.schemaVersion,
    timestamp,
    service: "uwplan-watchdog",
    event: name,
    status,
    details,
  };
}

/**
 * Execute one measurement cycle through explicit adapters. Keeping time,
 * probes, alerts, and Compose outside this function makes the recovery policy
 * deterministic and permits safe non-production failure injection.
 */
export async function runWatchdogCycle({
  state,
  timestamp,
  appHealthy,
  databaseHealthy,
  restartCounters,
  restartApp,
  publishAlert,
}) {
  validateWatchdogState(state);
  if (
    typeof timestamp !== "string" ||
    typeof appHealthy !== "boolean" ||
    typeof databaseHealthy !== "boolean" ||
    typeof restartApp !== "function" ||
    typeof publishAlert !== "function" ||
    !["app", "db", "alloy"].every((service) =>
      validCounter(restartCounters?.[service]),
    )
  ) {
    throw new TypeError("watchdog cycle input is invalid");
  }

  const events = [];
  const alerts = [];
  const nextState = {
    schemaVersion: WATCHDOG_POLICY.schemaVersion,
    consecutiveAppFailures: appHealthy ? 0 : state.consecutiveAppFailures + 1,
    lastRestartCounters: { ...restartCounters },
  };
  let appRestartRequested = false;

  for (const service of ["app", "db", "alloy"]) {
    const previous = state.lastRestartCounters[service];
    const current = restartCounters[service];
    if (current > previous) {
      const restartEvent = event(
        timestamp,
        "container.restart-counter-increased",
        "alerting",
        { service, previous, current, delta: current - previous },
      );
      events.push(restartEvent);
      alerts.push(restartEvent);
      await publishAlert(restartEvent);
    }
  }

  if (!databaseHealthy) {
    const databaseEvent = event(
      timestamp,
      "database.readiness-failed",
      "alerting",
      { databaseRestartRequested: false },
    );
    events.push(databaseEvent);
    alerts.push(databaseEvent);
    await publishAlert(databaseEvent);
  }

  if (!appHealthy) {
    const livenessEvent = event(
      timestamp,
      "application.liveness-failed",
      "observed",
      {
        consecutiveFailures: nextState.consecutiveAppFailures,
        threshold: WATCHDOG_POLICY.appFailureThreshold,
      },
    );
    events.push(livenessEvent);

    if (
      nextState.consecutiveAppFailures >= WATCHDOG_POLICY.appFailureThreshold
    ) {
      await restartApp();
      appRestartRequested = true;
      nextState.consecutiveAppFailures = 0;
      const recoveryEvent = event(
        timestamp,
        "application.recovery-requested",
        "alerting",
        {
          target: "app",
          databaseRestartRequested: false,
          failedChecks: WATCHDOG_POLICY.appFailureThreshold,
        },
      );
      events.push(recoveryEvent);
      alerts.push(recoveryEvent);
      await publishAlert(recoveryEvent);
    }
  } else {
    events.push(event(timestamp, "application.liveness-passed", "healthy"));
  }

  if (databaseHealthy) {
    events.push(event(timestamp, "database.readiness-passed", "healthy"));
  }

  return {
    state: nextState,
    events,
    alerts,
    actions: {
      appRestartRequested,
      databaseRestartRequested: false,
    },
  };
}

export async function runControlledFailureInjection({
  environment,
  host,
  restartApp,
  publishAlert,
  readDatabaseRestartCounter = async () => 11,
}) {
  if (environment !== "rehearsal" || host !== "v2.uwplan.com") {
    throw new Error(
      "controlled failure injection is restricted to v2.uwplan.com rehearsal",
    );
  }

  let state = initialWatchdogState();
  const databaseRestartCounterBefore = await readDatabaseRestartCounter();
  if (!validCounter(databaseRestartCounterBefore)) {
    throw new Error("database restart counter is unavailable");
  }
  const restartCountersBefore = {
    app: 7,
    db: databaseRestartCounterBefore,
    alloy: 3,
  };
  const evidence = [];
  for (
    let cycle = 1;
    cycle <= WATCHDOG_POLICY.appFailureThreshold;
    cycle += 1
  ) {
    const result = await runWatchdogCycle({
      state,
      timestamp: `2026-08-02T00:0${cycle}:00.000Z`,
      appHealthy: false,
      databaseHealthy: cycle !== 2,
      restartCounters: restartCountersBefore,
      restartApp,
      publishAlert,
    });
    state = result.state;
    evidence.push(...result.events);
  }

  const databaseRestartCounterAfter = await readDatabaseRestartCounter();
  if (!validCounter(databaseRestartCounterAfter)) {
    throw new Error("database restart counter is unavailable after injection");
  }
  return {
    schemaVersion: WATCHDOG_POLICY.schemaVersion,
    environment,
    host,
    appRecoveryRequested: evidence.some(
      (entry) => entry.event === "application.recovery-requested",
    ),
    databaseFailureAlerted: evidence.some(
      (entry) => entry.event === "database.readiness-failed",
    ),
    databaseRestartCounterBefore,
    databaseRestartCounterAfter,
    databaseRestarted:
      databaseRestartCounterAfter !== databaseRestartCounterBefore,
    evidence,
  };
}
