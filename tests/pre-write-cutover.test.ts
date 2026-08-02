/** @jest-environment node */

import {
  PRE_WRITE_DEADLINE_MS,
  PreWriteRecoveryRejected,
  runPreWriteCutover,
  verifyFenceEvidence,
  type PreWriteAdapters,
} from "../ops/cutover/pre-write.mjs";

const runId = "20260802T201500000Z";
const signingKey = "fixture-only-signing-key-that-is-at-least-32-bytes";
const archiveSha256 = "a".repeat(64);

function harness(
  options: {
    activitySessions?: number[];
    dnsChanged?: boolean;
    writeEpoch?: boolean;
    fenceObservations?: Array<
      Partial<{
        applicationSessions: number;
        walLsn: string;
        writeCounter: number;
        appRestartCounter: number;
      }>
    >;
    stopAfterOperation?: string;
    deadlineAfterOperation?: string;
  } = {},
) {
  let timestamp = Date.parse("2026-08-02T20:15:00.000Z");
  let latestOperation = "start";
  const operations: string[] = [];
  const activity = [...(options.activitySessions ?? [0, 0, 0])];
  const fenceObservations = [...(options.fenceObservations ?? [])];
  const record = (operation: string) => {
    latestOperation = operation;
    operations.push(operation);
    if (options.deadlineAfterOperation === operation)
      timestamp += PRE_WRITE_DEADLINE_MS;
  };
  const accepted = (operation: string) => {
    record(operation);
    return Promise.resolve({ accepted: true });
  };
  const baseline = {
    applicationSessions: 0,
    walLsn: "0/16B6C50",
    writeCounter: 41,
    appRestartCounter: 7,
  };

  const adapters: PreWriteAdapters = {
    deploy: {
      freeze: async (environment) => {
        record(`freeze:${environment}`);
        return { accepted: true, environment, frozen: true };
      },
      thaw: async (environment) => {
        record(`thaw:${environment}`);
        return { accepted: true, environment, frozen: false };
      },
    },
    edge: {
      captureDns: async () => {
        record("capture-dns");
        return { records: ["apex", "www"] };
      },
      enableMaintenance: async () => accepted("maintenance:on"),
      verifyMaintenance: async (network) => {
        record(`maintenance:verify:${network}`);
        return {
          accepted: true,
          network,
          status: 503,
          originContacted: false,
        };
      },
      dnsChanged: async () => {
        record("dns:changed?");
        return options.dnsChanged ?? false;
      },
      restoreDns: async () => accepted("dns:restore"),
      disableMaintenance: async () => accepted("maintenance:off"),
    },
    source: {
      stopProductionAppAndDisableRecreate: async ({ service }) => {
        record(`stop:${service}`);
        return {
          stoppedService: "racknerd-production-app",
          recreateDisabled: true,
          databaseStopped: false,
          stagingTouched: false,
        };
      },
      sampleApplicationSessions: async () => {
        record("source:activity-sample");
        return { applicationSessions: activity.shift() ?? 0 };
      },
      captureFence: async () => {
        record("source:capture-fence");
        return baseline;
      },
      assertFenceUnchanged: async () => {
        record("source:assert-fence");
        return { ...baseline, ...(fenceObservations.shift() ?? {}) };
      },
      startProductionApp: async ({ service }) => accepted(`start:${service}`),
      validatePrivate: async () => {
        record("source:private-validation");
        return {
          accepted: true,
          database: "racknerd-production",
          application: "racknerd-production-app",
          ready: true,
        };
      },
    },
    candidate: {
      restorePostFenceArchive: async ({ fence }) => {
        record("candidate:restore-post-fence");
        return {
          sha256: archiveSha256,
          createdAt: fence.fencedAt,
          candidateDatabase: `uwplan_candidate_${runId}`,
          restored: true,
          freshCandidate: true,
          sourceFenceSignature: fence.signature,
        };
      },
      validateIntegrity: async (database) => {
        record(`candidate:integrity:${database}`);
        return {
          accepted: true,
          failedGates: [],
          archiveSha256,
        };
      },
      validateReadOnly: async (database) => {
        record(`candidate:read-only:${database}`);
        return {
          accepted: true,
          writeAttemptRejected: true,
          writeEpochDeclared: false,
          readiness: "ready",
          applicationRole: "uwplan_app",
        };
      },
    },
    epoch: {
      hasDigitalOceanWriteEpoch: async () => {
        record("epoch:digitalocean?");
        return options.writeEpoch ?? false;
      },
    },
  };

  return {
    adapters,
    operations,
    now: () => timestamp,
    sleep: async (milliseconds: number) => {
      operations.push(`sleep:${milliseconds}`);
      timestamp += milliseconds;
    },
    shouldStop: () =>
      options.stopAfterOperation === latestOperation
        ? "operator-stop-condition"
        : false,
  };
}

function execute(test: ReturnType<typeof harness>) {
  return runPreWriteCutover({
    runId,
    signingKey,
    maintenanceNetworks: ["tailscale-vantage", "external-vantage"],
    adapters: test.adapters,
    now: test.now,
    sleep: test.sleep,
    shouldStop: test.shouldStop,
  });
}

describe("pre-write RackNerd fence", () => {
  it("freezes both deploy paths before maintenance and accepts a signed post-fence candidate", async () => {
    const test = harness();
    const result = await execute(test);

    expect(result.status).toBe("ready-for-origin-switch");
    if (result.status !== "ready-for-origin-switch") return;
    expect(result.authority).toBe("racknerd-production");
    expect(verifyFenceEvidence(result.fence, signingKey)).toBe(true);
    expect(
      verifyFenceEvidence(
        { ...result.fence, sourceWriteCounter: 42 },
        signingKey,
      ),
    ).toBe(false);
    expect(result.archive).toEqual({
      sha256: archiveSha256,
      createdAt: result.fence.fencedAt,
      candidateDatabase: `uwplan_candidate_${runId}`,
    });

    expect(test.operations.slice(0, 6)).toEqual([
      "capture-dns",
      "freeze:racknerd-production",
      "freeze:digitalocean-production",
      "maintenance:on",
      "maintenance:verify:tailscale-vantage",
      "maintenance:verify:external-vantage",
    ]);
    expect(test.operations).toContain("stop:racknerd-production-app");
    expect(test.operations).not.toContain("stop:racknerd-production-db");
    expect(test.operations).not.toContain("stop:racknerd-staging-app");
    expect(
      test.operations.filter((item) => item === "source:activity-sample"),
    ).toHaveLength(3);
    expect(
      test.operations.filter((item) => item === "sleep:30000"),
    ).toHaveLength(2);
    expect(
      test.operations.filter((item) => item === "source:assert-fence"),
    ).toHaveLength(3);
    expect(test.operations.indexOf("source:capture-fence")).toBeLessThan(
      test.operations.indexOf("candidate:restore-post-fence"),
    );
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "pre-write.application-sessions-cleared",
          details: { sampleCount: 3, sampleSpanMs: 60_000 },
        }),
        expect.objectContaining({ event: "pre-write.source-fenced" }),
        expect.objectContaining({ event: "pre-write.candidate-accepted" }),
      ]),
    );
  });

  it("invalidates the fence on a later app restart and performs unchanged-source recovery", async () => {
    const test = harness({
      dnsChanged: true,
      fenceObservations: [{}, { appRestartCounter: 8 }],
    });
    const result = await execute(test);

    expect(result).toEqual(
      expect.objectContaining({
        status: "recovered",
        authority: "racknerd-production",
        reason: "source-app-restarted-after-fence",
      }),
    );
    expect(test.operations).toEqual(
      expect.arrayContaining([
        "dns:restore",
        "start:racknerd-production-app",
        "source:private-validation",
        "maintenance:off",
        "thaw:digitalocean-production",
        "thaw:racknerd-production",
      ]),
    );
    expect(test.operations).not.toContain("start:racknerd-production-db");
  });

  it.each([
    [
      "application session",
      { applicationSessions: 1 },
      "application-session-after-stop",
    ],
    ["source write", { writeCounter: 42 }, "source-write-after-fence"],
    ["WAL advance", { walLsn: "0/16B6C51" }, "source-wal-advanced-after-fence"],
  ])(
    "invalidates the fence on a later %s",
    async (_name, observation, reason) => {
      const test = harness({ fenceObservations: [observation] });
      const result = await execute(test);

      expect(result).toEqual(
        expect.objectContaining({ status: "recovered", reason }),
      );
      expect(test.operations).not.toContain("candidate:restore-post-fence");
    },
  );

  it("routes a non-operator pg_stat_activity session through recovery before archive", async () => {
    const test = harness({ activitySessions: [0, 1] });
    const result = await execute(test);

    expect(result).toEqual(
      expect.objectContaining({
        status: "recovered",
        reason: "application-session-after-stop",
      }),
    );
    expect(test.operations).not.toContain("candidate:restore-post-fence");
    expect(test.operations).toContain("start:racknerd-production-app");
  });

  it("fails closed on an ambiguous source stop and still requests idempotent app recovery", async () => {
    const test = harness();
    test.adapters.source.stopProductionAppAndDisableRecreate = async () => ({
      stoppedService: "racknerd-production-app",
      recreateDisabled: true,
      databaseStopped: false,
      stagingTouched: true,
    });

    await expect(execute(test)).resolves.toEqual(
      expect.objectContaining({
        status: "recovered",
        reason: "source-application-scope-invalid",
      }),
    );
    expect(test.operations).toContain("start:racknerd-production-app");
    expect(test.operations).not.toContain("start:racknerd-production-db");
  });

  it("routes the minute-45 deadline through pre-write recovery", async () => {
    const test = harness({
      deadlineAfterOperation: "maintenance:verify:external-vantage",
    });
    const result = await execute(test);

    expect(result).toEqual(
      expect.objectContaining({
        status: "recovered",
        reason: "minute-45-deadline",
      }),
    );
    expect(test.operations).not.toContain("stop:racknerd-production-app");
    expect(test.operations).toContain("maintenance:off");
  });

  it("routes an immediate operator stop condition through recovery", async () => {
    const test = harness({
      stopAfterOperation: "maintenance:verify:external-vantage",
    });
    const result = await execute(test);

    expect(result).toEqual(
      expect.objectContaining({
        status: "recovered",
        reason: "operator-stop-condition",
      }),
    );
    expect(test.operations).not.toContain("stop:racknerd-production-app");
  });

  it("rejects unchanged-source recovery after the DigitalOcean write epoch", async () => {
    const test = harness({
      activitySessions: [1],
      writeEpoch: true,
    });

    await expect(execute(test)).rejects.toBeInstanceOf(
      PreWriteRecoveryRejected,
    );
    expect(test.operations).not.toContain("start:racknerd-production-app");
    expect(test.operations).not.toContain("maintenance:off");
  });

  it("fails closed on ambiguous maintenance networks and weak evidence keys", async () => {
    const test = harness();
    await expect(
      runPreWriteCutover({
        runId,
        signingKey,
        maintenanceNetworks: ["same-network", "same-network"],
        adapters: test.adapters,
      }),
    ).rejects.toThrow("two distinct");
    await expect(
      runPreWriteCutover({
        runId,
        signingKey: "too-short",
        maintenanceNetworks: ["one", "two"],
        adapters: test.adapters,
      }),
    ).rejects.toThrow("at least 32 bytes");
    expect(test.operations).toHaveLength(0);
  });

  it("recovers when either candidate acceptance gate rejects", async () => {
    for (const gate of ["integrity", "read-only"] as const) {
      const test = harness();
      if (gate === "integrity") {
        test.adapters.candidate.validateIntegrity = async () => ({
          accepted: false,
          failedGates: ["schema"],
          archiveSha256,
        });
      } else {
        test.adapters.candidate.validateReadOnly = async () => ({
          accepted: false,
          writeAttemptRejected: false,
          writeEpochDeclared: false,
          readiness: "unready",
          applicationRole: "uwplan_app",
        });
      }

      await expect(execute(test)).resolves.toEqual(
        expect.objectContaining({
          status: "recovered",
          reason:
            gate === "integrity"
              ? "candidate-integrity-rejected"
              : "candidate-read-only-gates-rejected",
        }),
      );
      expect(test.operations).toContain("start:racknerd-production-app");
    }
  });
});
