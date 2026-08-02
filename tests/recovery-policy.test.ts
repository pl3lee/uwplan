/** @jest-environment node */

import {
  evaluateRecoveryPolicy,
  RESOURCE_POLICY,
} from "../ops/recovery/policy.mjs";

function healthyObservation(overrides: Record<string, unknown> = {}) {
  return {
    windowSeconds: 60,
    events: { oomKills: 0, memoryLimitKills: 0 },
    restarts: {
      resourceCaused: 0,
      unexplained: 0,
      counterIncrease: 0,
      noticed: 0,
    },
    host: {
      memoryAvailablePercent: 30,
      activeSwapBytesPerSecond: 0,
      cpuPercent: 25,
      diskUsedPercent: 30,
      diskFreeBytes: 20 * 1024 ** 3,
      inodeUsedPercent: 10,
    },
    services: {
      app: { memoryLimitPercent: 50 },
      db: { memoryLimitPercent: 50 },
      alloy: { memoryLimitPercent: 50 },
    },
    availability: {
      successfulProbes: 1_000,
      totalProbes: 1_000,
      maximumConsecutiveFailures: 0,
      plannedRecoveryMilliseconds: 60_000,
    },
    latency: {
      externalReadinessMilliseconds: [100, 200, 500],
      coreRequestMilliseconds: [300, 900, 2_000],
    },
    ...overrides,
  };
}

describe("recovery and capacity decision policy", () => {
  it("accepts exact availability, resource, and response-time boundaries", () => {
    const decision = evaluateRecoveryPolicy([
      healthyObservation({
        host: {
          memoryAvailablePercent: 15,
          activeSwapBytesPerSecond: 1024 ** 2,
          cpuPercent: 90,
          diskUsedPercent: 79.99,
          diskFreeBytes: 5 * 1024 ** 3,
          inodeUsedPercent: 79.99,
        },
      }),
    ]);

    expect(decision).toEqual(
      expect.objectContaining({
        outcome: "accept",
        accepted: true,
        repeatSoak: false,
      }),
    );
    expect(decision.evidence.readinessLatency).toEqual(
      expect.objectContaining({
        p95Milliseconds: 500,
        maximumMilliseconds: 500,
      }),
    );
    expect(decision.evidence.coreLatency).toEqual(
      expect.objectContaining({
        p95Milliseconds: 2_000,
        maximumMilliseconds: 2_000,
      }),
    );
  });

  it("turns any OOM or resource restart into a 2 GiB repeat-soak decision", () => {
    const decision = evaluateRecoveryPolicy([
      healthyObservation({
        events: { oomKills: 1, memoryLimitKills: 1 },
        restarts: {
          resourceCaused: 1,
          unexplained: 0,
          counterIncrease: 1,
          noticed: 1,
        },
      }),
    ]);

    expect(decision).toEqual(
      expect.objectContaining({
        outcome: "resize-repeat-soak",
        accepted: false,
        repeatSoak: true,
        minimumHostMemoryBytes: 2 * 1024 ** 3,
      }),
    );
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "resource-restart" }),
      ]),
    );
  });

  it("encodes five-minute and three-period memory/swap gates without sleeping", () => {
    const fiveMinuteSwap = Array.from({ length: 5 }, () =>
      healthyObservation({
        host: {
          ...healthyObservation().host,
          activeSwapBytesPerSecond:
            RESOURCE_POLICY.activeSwapMaximumBytesPerSecond + 1,
        },
      }),
    );
    const threeMemoryPeriods = Array.from({ length: 5 }, (_, index) =>
      healthyObservation({
        host: {
          ...healthyObservation().host,
          memoryAvailablePercent: index % 2 === 0 ? 14 : 30,
        },
      }),
    );

    expect(evaluateRecoveryPolicy(fiveMinuteSwap).reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "active-swap" }),
      ]),
    );
    expect(evaluateRecoveryPolicy(threeMemoryPeriods).reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "host-memory" }),
      ]),
    );
  });

  it("blocks disk, inode, unnoticed restart, availability, and latency breaches", () => {
    const decision = evaluateRecoveryPolicy([
      healthyObservation({
        restarts: {
          resourceCaused: 0,
          unexplained: 1,
          counterIncrease: 2,
          noticed: 0,
        },
        host: {
          ...healthyObservation().host,
          diskUsedPercent: 80,
          diskFreeBytes: 5 * 1024 ** 3 - 1,
          inodeUsedPercent: 80,
        },
        availability: {
          successfulProbes: 998,
          totalProbes: 1_000,
          maximumConsecutiveFailures: 2,
          plannedRecoveryMilliseconds: 120_001,
        },
        latency: {
          externalReadinessMilliseconds: [501, 2_001],
          coreRequestMilliseconds: [2_001, 5_001],
        },
      }),
    ]);

    expect(decision.outcome).toBe("block-cutover");
    expect(decision.reasons.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "unexplained-restart",
        "unnoticed-restart-counter",
        "disk-capacity",
        "inode-capacity",
        "availability",
        "planned-recovery-time",
        "readiness-latency",
        "core-latency",
      ]),
    );
  });

  it("fails closed when probe or latency evidence is missing", () => {
    const observation = healthyObservation({
      availability: {},
      latency: {},
    });

    expect(
      evaluateRecoveryPolicy([observation]).reasons.map((entry) => entry.code),
    ).toEqual(
      expect.arrayContaining([
        "missing-resource-evidence",
        "missing-availability-evidence",
        "missing-readiness-latency",
        "missing-core-latency",
      ]),
    );
  });
});
