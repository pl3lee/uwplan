/** @jest-environment node */

import {
  MAINTENANCE_READINESS_INTERVAL_MS,
  MAINTENANCE_READINESS_WINDOW_MS,
  PUBLIC_MONITOR_INTERVAL_MS,
  PUBLIC_MONITOR_WINDOW_MS,
  SESSION_SAMPLE_INTERVAL_MS,
  runPostWriteReverseMigration,
  signEpochAction,
  verifyEpochAction,
  type GateReceipt,
  type PostWriteAdapters,
  type SignedEpochAction,
} from "../ops/cutover/post-write.mjs";

const runId = "20260802T201500000Z";
const signingKey = "fixture-only-signing-key-that-is-at-least-32-bytes";
const digitalOceanDatabase = "uwplan-cutover-20260802";
const candidateDatabase = "uwplan_reverse_20260802T201500000Z";
const captureSha256 = "a".repeat(64);
const backupSha256 = "b".repeat(64);
const initialReadOnlyGates: GateReceipt[] = [
  {
    gate: "digitalocean-integrity",
    verifiedAt: "2026-08-02T20:00:00.000Z",
    digest: "c".repeat(64),
  },
  {
    gate: "digitalocean-read-only",
    verifiedAt: "2026-08-02T20:01:00.000Z",
    digest: "d".repeat(64),
  },
  {
    gate: "digitalocean-origin-readiness",
    verifiedAt: "2026-08-02T20:02:00.000Z",
    digest: "e".repeat(64),
  },
];

function digitalOceanAction(
  overrides: Partial<Omit<SignedEpochAction, "signature">> = {},
) {
  return signEpochAction(
    {
      schemaVersion: 1,
      runId,
      operator: "pl3lee",
      action: "declare-digitalocean-write-epoch",
      database: digitalOceanDatabase,
      issuedAt: "2026-08-02T20:03:00.000Z",
      gateReceipts: initialReadOnlyGates,
      ...overrides,
    },
    signingKey,
  );
}

function harness(
  options: {
    unreadable?: boolean;
    sessionSamples?: number[];
    staleRestore?: boolean;
    wrongAttachment?: boolean;
    forgedRackNerdAction?: boolean;
    maintenanceReadinessFailureAt?: number;
    publicFailureAt?: number;
  } = {},
) {
  let timestamp = Date.parse("2026-08-02T20:15:00.000Z");
  const operations: Array<{ operation: string; timestamp: number }> = [];
  const sessionSamples = [...(options.sessionSamples ?? [0, 0, 0])];
  let maintenanceReadinessSamples = 0;
  let publicSamples = 0;
  const record = (operation: string) => {
    operations.push({ operation, timestamp });
  };
  const accepted = (operation: string) => {
    record(operation);
    return Promise.resolve({ accepted: true });
  };
  const gateReceipt = (gate: string, digest: string): GateReceipt => ({
    gate,
    verifiedAt: new Date(timestamp).toISOString(),
    digest,
  });

  const adapters: PostWriteAdapters = {
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
      switchToRackNerd: async ({ database, maintenance }) => {
        record(`edge:switch:${database}`);
        return {
          accepted: true,
          database,
          maintenance,
          origin: "racknerd",
        };
      },
      sampleMaintenanceReadiness: async ({ networks, database }) => {
        maintenanceReadinessSamples += 1;
        record(`maintenance:readiness:${maintenanceReadinessSamples}`);
        const failed =
          maintenanceReadinessSamples === options.maintenanceReadinessFailureAt;
        return {
          maintenance: true,
          publicStatus: 503,
          readiness: failed ? "unready" : "ready",
          origin: "racknerd",
          database,
          networkCount: networks.length,
        };
      },
      readinessGateReceipt: async ({ database, sampleCount }) => {
        record(`maintenance:receipt:${database}:${sampleCount}`);
        return gateReceipt("racknerd-maintenance-readiness", "f".repeat(64));
      },
      disableMaintenance: async () => accepted("maintenance:off"),
      samplePublicReadiness: async ({ database }) => {
        publicSamples += 1;
        record(`public:readiness:${publicSamples}`);
        const failed = publicSamples === options.publicFailureAt;
        return {
          status: failed ? 500 : 200,
          readiness: failed ? "unready" : "ready",
          origin: "racknerd",
          database,
          clean: !failed,
        };
      },
    },
    source: {
      verifyReadable: async ({ database }) => {
        record(`source:readable:${database}`);
        return { readable: !options.unreadable };
      },
      stopWritersAndDisableRecreate: async ({ service }) => {
        record(`source:stop:${service}`);
        return {
          stoppedService: service,
          recreateDisabled: true,
          databaseStopped: false,
          rackNerdTouched: false,
        };
      },
      sampleApplicationSessions: async () => {
        record("source:session-sample");
        return { applicationSessions: sessionSamples.shift() ?? 0 };
      },
      captureCurrentData: async ({ database }) => {
        record(`source:capture:${database}`);
        return {
          database,
          current: true,
          protected: true,
          sha256: captureSha256,
          capturedAt: new Date(timestamp).toISOString(),
        };
      },
    },
    backup: {
      latestVerified: async () => {
        record("backup:latest-verified");
        return {
          verified: true,
          capturedAt: "2026-08-02T20:05:00.000Z",
          sha256: backupSha256,
        };
      },
    },
    candidate: {
      restoreFresh: async ({ target, forbiddenDatabase }) => {
        record(`candidate:restore:${target}:${forbiddenDatabase}`);
        return {
          candidateDatabase: options.staleRestore
            ? "racknerd-production"
            : candidateDatabase,
          freshCandidate: !options.staleRestore,
          restored: true,
          archiveSha256: captureSha256,
          staleDatabaseStarted: false,
        };
      },
      validateIntegrity: async (database) => {
        record(`candidate:integrity:${database}`);
        return {
          accepted: true,
          database,
          failedGates: [],
          archiveSha256: captureSha256,
          gateReceipt: gateReceipt(
            "racknerd-reverse-integrity",
            "1".repeat(64),
          ),
        };
      },
      validateReadOnly: async (database) => {
        record(`candidate:read-only:${database}`);
        return {
          accepted: true,
          database,
          writeAttemptRejected: true,
          writeEpochDeclared: false,
          readiness: "ready",
          gateReceipt: gateReceipt(
            "racknerd-reverse-read-only",
            "2".repeat(64),
          ),
        };
      },
      attachPreservedApp: async ({ application, database }) => {
        record(`candidate:attach:${application}:${database}`);
        return {
          accepted: true,
          application,
          database: options.wrongAttachment ? "racknerd-production" : database,
          otherDatabasesAttached: 0,
        };
      },
      declareWriteEpoch: async ({ database }) => {
        record(`candidate:epoch:${database}`);
        return { accepted: true, database, writeEpoch: true };
      },
      validatePrivateAuthAndWrite: async (database) => {
        record(`candidate:private:${database}`);
        return {
          accepted: true,
          database,
          authenticated: true,
          writePreserved: true,
        };
      },
    },
    operator: {
      authorizeRackNerdWriteEpoch: async ({
        runId: actionRunId,
        database,
        gateReceipts,
      }) => {
        record("operator:racknerd-epoch");
        if (!options.forgedRackNerdAction) timestamp += 1;
        const issuedAt = options.forgedRackNerdAction
          ? gateReceipts[0]!.verifiedAt
          : new Date(timestamp).toISOString();
        return signEpochAction(
          {
            schemaVersion: 1,
            runId: actionRunId,
            operator: "pl3lee",
            action: "declare-racknerd-write-epoch",
            database,
            issuedAt,
            gateReceipts,
          },
          signingKey,
        );
      },
    },
  };

  return {
    adapters,
    operations,
    now: () => timestamp,
    sleep: async (milliseconds: number) => {
      record(`sleep:${milliseconds}`);
      timestamp += milliseconds;
    },
  };
}

function execute(
  test: ReturnType<typeof harness>,
  epochAction = digitalOceanAction(),
) {
  return runPostWriteReverseMigration({
    runId,
    signingKey,
    digitalOceanDatabase,
    digitalOceanEpochAction: epochAction,
    initialReadOnlyGates,
    maintenanceNetworks: ["tailscale-vantage", "external-vantage"],
    adapters: test.adapters,
    now: test.now,
    sleep: test.sleep,
  });
}

function operationNames(test: ReturnType<typeof harness>) {
  return test.operations.map(({ operation }) => operation);
}

describe("post-write reverse migration", () => {
  it("moves current post-write data into a fresh RackNerd candidate and thaws only after a clean hour", async () => {
    const test = harness();
    const result = await execute(test);

    expect(result).toEqual(
      expect.objectContaining({
        status: "rolled-back",
        authority: "racknerd-reverse-candidate",
        authoritativeDatabase: candidateDatabase,
        staleDatabases: ["racknerd-production", digitalOceanDatabase],
      }),
    );
    const names = operationNames(test);
    expect(names.slice(0, 7)).toEqual([
      `source:readable:${digitalOceanDatabase}`,
      "freeze:digitalocean-production",
      "freeze:racknerd-production",
      "maintenance:on",
      "maintenance:verify:tailscale-vantage",
      "maintenance:verify:external-vantage",
      "source:stop:digitalocean-production-app",
    ]);
    expect(
      names.filter((operation) => operation === "source:session-sample"),
    ).toHaveLength(3);
    expect(names).toContain(`source:capture:${digitalOceanDatabase}`);
    expect(names).toContain("candidate:restore:racknerd:racknerd-production");
    expect(names).toContain(
      `candidate:attach:racknerd-production-app:${candidateDatabase}`,
    );
    expect(
      names.filter((operation) =>
        operation.startsWith("maintenance:readiness:"),
      ),
    ).toHaveLength(
      MAINTENANCE_READINESS_WINDOW_MS / MAINTENANCE_READINESS_INTERVAL_MS + 1,
    );
    expect(names.indexOf("operator:racknerd-epoch")).toBeLessThan(
      names.indexOf(`candidate:epoch:${candidateDatabase}`),
    );
    expect(names.indexOf(`candidate:epoch:${candidateDatabase}`)).toBeLessThan(
      names.indexOf(`candidate:private:${candidateDatabase}`),
    );
    expect(names.indexOf("maintenance:off")).toBeLessThan(
      names.indexOf("public:readiness:1"),
    );
    expect(
      names.filter((operation) => operation.startsWith("public:readiness:")),
    ).toHaveLength(PUBLIC_MONITOR_WINDOW_MS / PUBLIC_MONITOR_INTERVAL_MS + 1);
    const publicStart = test.operations.find(
      ({ operation }) => operation === "public:readiness:1",
    )!;
    const oldPathThaw = test.operations.find(
      ({ operation }) => operation === "thaw:digitalocean-production",
    )!;
    expect(oldPathThaw.timestamp - publicStart.timestamp).toBe(
      PUBLIC_MONITOR_WINDOW_MS,
    );
    expect(names.at(-1)).toBe("thaw:digitalocean-production");
    expect(JSON.stringify(result)).not.toContain(signingKey);
  });

  it("rejects a DigitalOcean epoch action that was not signed after all read-only gates", async () => {
    const test = harness();
    const earlyAction = digitalOceanAction({
      issuedAt: initialReadOnlyGates[1]!.verifiedAt,
    });

    await expect(execute(test, earlyAction)).rejects.toThrow(
      "DigitalOcean write epoch requires a signed operator action after every read-only gate",
    );
    expect(test.operations).toEqual([]);
  });

  it("keeps maintenance and deployment freezes in place when sessions remain", async () => {
    const test = harness({ sessionSamples: [0, 1] });

    await expect(execute(test)).rejects.toThrow(
      "DigitalOcean still has application sessions",
    );
    const names = operationNames(test);
    expect(names).toContain("maintenance:on");
    expect(names).not.toContain("maintenance:off");
    expect(
      names.some((operation) => operation.startsWith("source:capture:")),
    ).toBe(false);
    expect(names.some((operation) => operation.startsWith("thaw:"))).toBe(
      false,
    );
  });

  it("never starts or promotes the stale pre-cutover RackNerd database", async () => {
    const test = harness({ staleRestore: true });

    await expect(execute(test)).rejects.toThrow(
      "fresh RackNerd reverse candidate restore is invalid",
    );
    const names = operationNames(test);
    expect(names).not.toContain("candidate:integrity:racknerd-production");
    expect(
      names.some((operation) => operation.startsWith("candidate:attach:")),
    ).toBe(false);
    expect(
      names.some((operation) => operation.startsWith("candidate:epoch:")),
    ).toBe(false);
  });

  it("requires the preserved RackNerd app to attach only to the fresh candidate", async () => {
    const test = harness({ wrongAttachment: true });

    await expect(execute(test)).rejects.toThrow(
      "preserved RackNerd app attachment was ambiguous",
    );
    expect(operationNames(test)).not.toContain(
      `candidate:epoch:${candidateDatabase}`,
    );
  });

  it("does not create a RackNerd write epoch when five-minute readiness is interrupted", async () => {
    const test = harness({ maintenanceReadinessFailureAt: 4 });

    await expect(execute(test)).rejects.toThrow(
      "maintenance readiness window was not continuous",
    );
    const names = operationNames(test);
    expect(names).not.toContain("operator:racknerd-epoch");
    expect(names).not.toContain("maintenance:off");
  });

  it("rejects a RackNerd epoch action issued before every reverse gate", async () => {
    const test = harness({ forgedRackNerdAction: true });

    await expect(execute(test)).rejects.toThrow(
      "RackNerd write epoch requires a signed operator action after every reverse read-only gate",
    );
    const names = operationNames(test);
    expect(names).not.toContain(`candidate:epoch:${candidateDatabase}`);
    expect(names).not.toContain(`candidate:private:${candidateDatabase}`);
  });

  it("does not thaw either deployment path when the public monitoring hour is not clean", async () => {
    const test = harness({ publicFailureAt: 8 });

    await expect(execute(test)).rejects.toThrow(
      "public monitoring hour was not clean",
    );
    const names = operationNames(test);
    expect(names).toContain("maintenance:off");
    expect(names.some((operation) => operation.startsWith("thaw:"))).toBe(
      false,
    );
  });

  it("stops for explicit human RPO acceptance when DigitalOcean is unreadable", async () => {
    const test = harness({ unreadable: true });
    const result = await execute(test);

    expect(result).toEqual(
      expect.objectContaining({
        status: "human-acceptance-required",
        authority: "digitalocean-final",
        explicitAcceptanceRequired: true,
        latestVerifiedBackup: {
          capturedAt: "2026-08-02T20:05:00.000Z",
          sha256: backupSha256,
          rpoSeconds: 600,
        },
      }),
    );
    expect(operationNames(test)).toEqual([
      `source:readable:${digitalOceanDatabase}`,
      "backup:latest-verified",
    ]);
  });

  it("binds signatures to the exact gate set and strictly later issue time", () => {
    const action = digitalOceanAction();
    const verification = {
      signingKey,
      runId,
      expectedAction: "declare-digitalocean-write-epoch" as const,
      expectedDatabase: digitalOceanDatabase,
      requiredGates: initialReadOnlyGates.map(({ gate }) => gate),
    };

    expect(verifyEpochAction(action, verification)).toBe(true);
    expect(
      verifyEpochAction(
        { ...action, database: "different-database" },
        verification,
      ),
    ).toBe(false);
    expect(
      verifyEpochAction(
        signEpochAction(
          {
            ...action,
            issuedAt: initialReadOnlyGates.at(-1)!.verifiedAt,
          },
          signingKey,
        ),
        verification,
      ),
    ).toBe(false);
  });

  it("fails closed on duplicate vantage points and weak signing keys", async () => {
    const test = harness();
    await expect(
      runPostWriteReverseMigration({
        runId,
        signingKey,
        digitalOceanDatabase,
        digitalOceanEpochAction: digitalOceanAction(),
        initialReadOnlyGates,
        maintenanceNetworks: ["same-vantage", "same-vantage"],
        adapters: test.adapters,
        now: test.now,
        sleep: test.sleep,
      }),
    ).rejects.toThrow("exactly two distinct verification networks");
    await expect(
      runPostWriteReverseMigration({
        runId,
        signingKey: "weak",
        digitalOceanDatabase,
        digitalOceanEpochAction: digitalOceanAction(),
        initialReadOnlyGates,
        maintenanceNetworks: ["one", "two"],
        adapters: test.adapters,
        now: test.now,
        sleep: test.sleep,
      }),
    ).rejects.toThrow("at least 32 bytes");
    expect(test.operations).toEqual([]);
  });

  it("uses only virtual time for every required observation window", async () => {
    const test = harness();
    await execute(test);

    const sleeps = operationNames(test).filter((operation) =>
      operation.startsWith("sleep:"),
    );
    expect(
      sleeps.filter(
        (operation) => operation === `sleep:${SESSION_SAMPLE_INTERVAL_MS}`,
      ),
    ).toHaveLength(2);
    expect(
      sleeps.filter(
        (operation) =>
          operation === `sleep:${MAINTENANCE_READINESS_INTERVAL_MS}`,
      ),
    ).toHaveLength(
      MAINTENANCE_READINESS_WINDOW_MS / MAINTENANCE_READINESS_INTERVAL_MS,
    );
    expect(
      sleeps.filter(
        (operation) => operation === `sleep:${PUBLIC_MONITOR_INTERVAL_MS}`,
      ),
    ).toHaveLength(PUBLIC_MONITOR_WINDOW_MS / PUBLIC_MONITOR_INTERVAL_MS);
  });

  it("rejects a sleep adapter that does not advance the observation clock", async () => {
    const test = harness();

    await expect(
      runPostWriteReverseMigration({
        runId,
        signingKey,
        digitalOceanDatabase,
        digitalOceanEpochAction: digitalOceanAction(),
        initialReadOnlyGates,
        maintenanceNetworks: ["one", "two"],
        adapters: test.adapters,
        now: test.now,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("the required observation window did not elapse");
    expect(operationNames(test)).not.toContain("operator:racknerd-epoch");
  });
});
