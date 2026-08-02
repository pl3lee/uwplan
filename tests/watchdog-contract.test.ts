/** @jest-environment node */

import { readFileSync } from "node:fs";

import {
  initialWatchdogState,
  runControlledFailureInjection,
  runWatchdogCycle,
} from "../ops/recovery/watchdog-lib.mjs";

describe("host watchdog recovery contract", () => {
  it("ships a one-minute host timer and no database restart capability", () => {
    const watchdog = readFileSync("ops/recovery/watchdog.mjs", "utf8");
    const timer = readFileSync("ops/recovery/uwplan-watchdog.timer", "utf8");

    expect(timer).toContain("OnUnitActiveSec=1min");
    expect(watchdog).toContain('compose(["restart", "app"])');
    expect(watchdog).not.toMatch(/compose\(\["restart",\s*"db"\]\)/);
  });

  it("restarts only app after exactly three consecutive failed liveness checks", async () => {
    let state = initialWatchdogState();
    const restartApp = jest.fn(async () => {});
    const publishAlert = jest.fn(async () => {});

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const result = await runWatchdogCycle({
        state,
        timestamp: `2026-08-02T00:0${cycle}:00.000Z`,
        appHealthy: false,
        databaseHealthy: true,
        restartCounters: { app: 0, db: 0, alloy: 0 },
        restartApp,
        publishAlert,
      });
      state = result.state;
      expect(restartApp).toHaveBeenCalledTimes(cycle === 3 ? 1 : 0);
    }

    expect(publishAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "application.recovery-requested",
        details: expect.objectContaining({
          target: "app",
          databaseRestartRequested: false,
          failedChecks: 3,
        }),
      }),
    );
  });

  it("alerts on database readiness failure and never requests a DB restart", async () => {
    const restartApp = jest.fn(async () => {});
    const publishAlert = jest.fn(async () => {});
    const result = await runWatchdogCycle({
      state: initialWatchdogState(),
      timestamp: "2026-08-02T00:01:00.000Z",
      appHealthy: true,
      databaseHealthy: false,
      restartCounters: { app: 0, db: 4, alloy: 0 },
      restartApp,
      publishAlert,
    });

    expect(result.actions).toEqual({
      appRestartRequested: false,
      databaseRestartRequested: false,
    });
    expect(restartApp).not.toHaveBeenCalled();
    expect(publishAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "database.readiness-failed",
        details: { databaseRestartRequested: false },
      }),
    );
  });

  it("proves recovery, alerting, and DB non-restart in rehearsal injection only", async () => {
    const restartApp = jest.fn(async () => {});
    const publishAlert = jest.fn(async () => {});
    const readDatabaseRestartCounter = jest.fn(async () => 9);

    const result = await runControlledFailureInjection({
      environment: "rehearsal",
      host: "v2.uwplan.com",
      restartApp,
      publishAlert,
      readDatabaseRestartCounter,
    });

    expect(result).toEqual(
      expect.objectContaining({
        appRecoveryRequested: true,
        databaseFailureAlerted: true,
        databaseRestartCounterBefore: 9,
        databaseRestartCounterAfter: 9,
        databaseRestarted: false,
      }),
    );
    expect(restartApp).toHaveBeenCalledTimes(1);
    expect(readDatabaseRestartCounter).toHaveBeenCalledTimes(2);
    expect(publishAlert).toHaveBeenCalledWith(
      expect.objectContaining({ event: "database.readiness-failed" }),
    );

    await expect(
      runControlledFailureInjection({
        environment: "production",
        host: "uwplan.com",
        restartApp,
        publishAlert,
      }),
    ).rejects.toThrow("restricted to v2.uwplan.com rehearsal");
  });
});
