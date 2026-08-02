import {
  createMigrationOrchestrator,
  type MigrationOrchestrator,
} from "./orchestrator";

const verifiedEvidence = { artifact: "verified" };

function passGate(migration: MigrationOrchestrator) {
  expect(
    migration.execute({ type: "pass-gate", evidence: verifiedEvidence }).ok,
  ).toBe(true);
}

function reachGoNoGo(migration: MigrationOrchestrator) {
  passGate(migration);
  passGate(migration);
  passGate(migration);
}

function acceptRuntimeDecision(migration: MigrationOrchestrator) {
  expect(
    migration.execute({
      type: "record-runtime-decision",
      decision: {
        schemaVersion: 1,
        outcome: "accept",
        accepted: true,
        repeatSoak: false,
        minimumHostMemoryBytes: null,
        observationCount: 1_440,
        reasons: [],
      },
      evidence: { resourceDecision: "sha256:sanitized" },
    }).ok,
  ).toBe(true);
}

function recordGo(migration: MigrationOrchestrator) {
  acceptRuntimeDecision(migration);
  expect(
    migration.execute({
      type: "record-go",
      operator: "pl3lee",
      evidence: { acceptancePackage: "sha256:accepted" },
    }).ok,
  ).toBe(true);
}

function reachFinalRestore(migration: MigrationOrchestrator) {
  reachGoNoGo(migration);
  recordGo(migration);
  passGate(migration);
  passGate(migration);
}

function reachWriteEpochReady(migration: MigrationOrchestrator) {
  reachFinalRestore(migration);
  passGate(migration);
  passGate(migration);
  passGate(migration);
}

function declareDigitalOceanEpoch(migration: MigrationOrchestrator) {
  expect(
    migration.execute({
      type: "declare-digitalocean-write-epoch",
      database: "uwplan-cutover-20260801",
      evidence: { boundary: "signed" },
    }).ok,
  ).toBe(true);
}

describe("migration orchestration", () => {
  it("creates a UTC run with RackNerd authoritative and dry-run infrastructure", () => {
    const now = new Date("2026-08-01T14:30:45.123Z");

    const migration = createMigrationOrchestrator({ clock: () => now });

    expect(migration.state).toEqual(
      expect.objectContaining({
        runId: "20260801T143045123Z",
        phase: "preflight",
        authority: "racknerd-original",
        authoritativeDatabase: "racknerd-production",
        digitalOceanWriteEpoch: false,
      }),
    );
    expect(migration.infrastructure).toEqual({ mode: "dry-run", requests: [] });
    expect(Object.isFrozen(migration.infrastructure)).toBe(true);
    expect(Object.isFrozen(migration.infrastructure.requests)).toBe(true);
    expect("request" in migration.infrastructure).toBe(false);
  });

  it("returns detached frozen state snapshots that cannot bypass guards", () => {
    const migration = createMigrationOrchestrator();
    const exposed = migration.state;

    expect(exposed).not.toBe(migration.state);
    expect(Object.isFrozen(exposed)).toBe(true);
    expect(Object.isFrozen(exposed.staleDatabases)).toBe(true);
    expect(() => {
      (exposed as { phase: string }).phase = "complete";
    }).toThrow(TypeError);
    expect(() => {
      (exposed.staleDatabases as string[]).push("racknerd-production");
    }).toThrow(TypeError);

    const result = migration.execute({
      type: "pass-gate",
      evidence: verifiedEvidence,
    });
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(result.state).not.toBe(migration.state);
    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "rehearsal-restore",
        staleDatabases: [],
      }),
    );

    if (false) {
      // @ts-expect-error Public migration state is readonly.
      migration.state.phase = "complete";
    }
  });

  it("ignores a mode-claiming custom adapter and uses the inert recorder", () => {
    const customRequest = jest.fn();
    const spoofedOptions = {
      clock: () => new Date("2026-08-01T14:30:45.123Z"),
      infrastructure: {
        mode: "dry-run" as const,
        request: customRequest,
      },
    };

    const migration = createMigrationOrchestrator(spoofedOptions);
    passGate(migration);

    expect(customRequest).not.toHaveBeenCalled();
    expect(migration.infrastructure.requests).toEqual([
      { type: "pass-gate", target: "operator" },
    ]);
  });

  it("completes the successful path with DigitalOcean authoritative", () => {
    const migration = createMigrationOrchestrator();
    const infrastructure = migration.infrastructure;
    const evidence = { artifact: "verified" };

    for (const phase of [
      "preflight",
      "rehearsal-restore",
      "rehearsal-soak",
    ] as const) {
      expect(migration.state.phase).toBe(phase);
      expect(migration.execute({ type: "pass-gate", evidence }).ok).toBe(true);
    }
    acceptRuntimeDecision(migration);
    expect(
      migration.execute({
        type: "record-go",
        operator: "pl3lee",
        evidence: { acceptancePackage: "sha256:accepted" },
      }).ok,
    ).toBe(true);
    for (const phase of [
      "maintenance",
      "write-fence",
      "final-restore",
      "candidate-read-only",
      "origin-switch",
    ] as const) {
      expect(migration.state.phase).toBe(phase);
      expect(migration.execute({ type: "pass-gate", evidence }).ok).toBe(true);
    }
    expect(
      migration.execute({
        type: "declare-digitalocean-write-epoch",
        database: "uwplan-cutover-20260801",
        evidence: { boundary: "signed" },
      }).ok,
    ).toBe(true);
    expect(
      migration.execute({
        type: "validate-authenticated-digitalocean",
        evidence,
      }).ok,
    ).toBe(true);
    expect(migration.execute({ type: "pass-gate", evidence }).ok).toBe(true);
    expect(migration.execute({ type: "pass-gate", evidence }).ok).toBe(true);

    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "complete",
        authority: "digitalocean-final",
        authoritativeDatabase: "uwplan-cutover-20260801",
        digitalOceanWriteEpoch: true,
        staleDatabases: ["racknerd-production"],
        terminalOutcome: "complete",
      }),
    );
    expect(infrastructure.requests).toEqual([
      { type: "pass-gate", target: "operator" },
      { type: "pass-gate", target: "operator" },
      { type: "pass-gate", target: "operator" },
      { type: "record-runtime-decision", target: "operator" },
      { type: "record-go", target: "operator" },
      { type: "pass-gate", target: "edge" },
      { type: "pass-gate", target: "racknerd" },
      { type: "pass-gate", target: "digitalocean" },
      { type: "pass-gate", target: "digitalocean" },
      { type: "pass-gate", target: "edge" },
      {
        type: "declare-digitalocean-write-epoch",
        target: "digitalocean",
      },
      {
        type: "validate-authenticated-digitalocean",
        target: "digitalocean",
      },
      { type: "pass-gate", target: "edge" },
      { type: "pass-gate", target: "operator" },
    ]);
  });

  it("aborts before the write epoch to the unchanged RackNerd database", () => {
    const migration = createMigrationOrchestrator();
    reachFinalRestore(migration);

    expect(migration.state.phase).toBe("final-restore");
    expect(
      migration.execute({
        type: "fail-gate",
        reason: "candidate integrity mismatch",
        evidence: { report: "integrity-check" },
      }).ok,
    ).toBe(true);
    expect(migration.state.phase).toBe("pre-write-recovery");
    expect(
      migration.execute({
        type: "recover-unchanged-racknerd",
        evidence: { validation: "passed" },
      }).ok,
    ).toBe(true);

    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "racknerd-restored",
        authority: "racknerd-original",
        authoritativeDatabase: "racknerd-production",
        digitalOceanWriteEpoch: false,
        staleDatabases: [],
        terminalOutcome: "pre-write-abort",
      }),
    );
    expect(migration.infrastructure.requests).toEqual([
      { type: "pass-gate", target: "operator" },
      { type: "pass-gate", target: "operator" },
      { type: "pass-gate", target: "operator" },
      { type: "record-runtime-decision", target: "operator" },
      { type: "record-go", target: "operator" },
      { type: "pass-gate", target: "edge" },
      { type: "pass-gate", target: "racknerd" },
      { type: "fail-gate", target: "digitalocean" },
      { type: "recover-unchanged-racknerd", target: "racknerd" },
    ]);
  });

  it("rejects a failure command from pre-write recovery and retains state", () => {
    const migration = createMigrationOrchestrator();
    reachFinalRestore(migration);
    migration.execute({
      type: "fail-gate",
      reason: "candidate integrity mismatch",
      evidence: { report: "integrity-check" },
    });
    expect(migration.state.phase).toBe("pre-write-recovery");

    const result = migration.execute({
      type: "fail-gate",
      reason: "recovery validation failed",
      evidence: { report: "recovery-check" },
    });

    expect(result.exitCode).toBe(1);
    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "pre-write-recovery",
        authority: "racknerd-original",
        digitalOceanWriteEpoch: false,
      }),
    );
  });

  it("requires the explicit unchanged-source recovery command", () => {
    const migration = createMigrationOrchestrator();
    reachFinalRestore(migration);
    migration.execute({
      type: "fail-gate",
      reason: "candidate integrity mismatch",
      evidence: { report: "integrity-check" },
    });

    const result = migration.execute({
      type: "pass-gate",
      evidence: verifiedEvidence,
    });

    expect(result.exitCode).toBe(1);
    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "pre-write-recovery",
        authority: "racknerd-original",
        terminalOutcome: null,
      }),
    );
  });

  it("reverse-migrates post-write data into a fresh RackNerd candidate", () => {
    const migration = createMigrationOrchestrator();
    reachWriteEpochReady(migration);
    declareDigitalOceanEpoch(migration);

    expect(
      migration.execute({
        type: "fail-gate",
        reason: "private write validation failed",
        evidence: { report: "private-validation" },
      }).ok,
    ).toBe(true);
    expect(migration.state.phase).toBe("reverse-fence");
    passGate(migration);
    passGate(migration);
    expect(
      migration.execute({
        type: "declare-racknerd-write-epoch",
        database: "uwplan-rollback-20260801",
        evidence: { boundary: "signed" },
      }).ok,
    ).toBe(true);
    passGate(migration);
    passGate(migration);

    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "rolled-back",
        authority: "racknerd-reverse-candidate",
        authoritativeDatabase: "uwplan-rollback-20260801",
        digitalOceanWriteEpoch: true,
        staleDatabases: ["racknerd-production", "uwplan-cutover-20260801"],
        terminalOutcome: "rolled-back",
      }),
    );
    expect(migration.infrastructure.requests).toEqual([
      { type: "pass-gate", target: "operator" },
      { type: "pass-gate", target: "operator" },
      { type: "pass-gate", target: "operator" },
      { type: "record-runtime-decision", target: "operator" },
      { type: "record-go", target: "operator" },
      { type: "pass-gate", target: "edge" },
      { type: "pass-gate", target: "racknerd" },
      { type: "pass-gate", target: "digitalocean" },
      { type: "pass-gate", target: "digitalocean" },
      { type: "pass-gate", target: "edge" },
      {
        type: "declare-digitalocean-write-epoch",
        target: "digitalocean",
      },
      { type: "fail-gate", target: "digitalocean" },
      { type: "pass-gate", target: "digitalocean" },
      { type: "pass-gate", target: "racknerd" },
      { type: "declare-racknerd-write-epoch", target: "racknerd" },
      { type: "pass-gate", target: "racknerd" },
      { type: "pass-gate", target: "edge" },
    ]);
  });

  it("rejects GO without a complete acceptance package", () => {
    const migration = createMigrationOrchestrator();
    reachGoNoGo(migration);

    const result = migration.execute({
      type: "record-go",
      operator: "pl3lee",
      evidence: {},
    });

    expect(result.exitCode).toBe(1);
    expect(migration.state.phase).toBe("go-no-go");
  });

  it("rejects GO until the resource decision has been accepted", () => {
    const migration = createMigrationOrchestrator();
    reachGoNoGo(migration);

    const result = migration.execute({
      type: "record-go",
      operator: "pl3lee",
      evidence: { acceptancePackage: "sha256:accepted" },
    });

    expect(result).toEqual(
      expect.objectContaining({
        exitCode: 1,
        error: "GO requires an accepted runtime decision",
      }),
    );
    expect(migration.state.phase).toBe("go-no-go");
  });

  it("rejects GO from any operator other than pl3lee at runtime", () => {
    const migration = createMigrationOrchestrator();
    reachGoNoGo(migration);

    const result = migration.execute({
      type: "record-go",
      operator: "someone-else",
      evidence: { acceptancePackage: "sha256:accepted" },
    } as unknown as Parameters<MigrationOrchestrator["execute"]>[0]);

    expect(result.exitCode).toBe(1);
    expect(migration.state.phase).toBe("go-no-go");
  });

  it("records NO-GO as a rehearsal-remediation terminal outcome", () => {
    const migration = createMigrationOrchestrator();
    reachGoNoGo(migration);

    const result = migration.execute({
      type: "fail-gate",
      reason: "operator recorded NO-GO",
      evidence: { decision: "signed" },
    });

    expect(result.ok).toBe(true);
    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "rehearsal-remediation",
        authority: "racknerd-original",
        terminalOutcome: "rehearsal-remediation",
      }),
    );
  });

  it("consumes an accepted runtime decision into sanitized migration evidence", () => {
    const migration = createMigrationOrchestrator();
    reachGoNoGo(migration);

    const result = migration.execute({
      type: "record-runtime-decision",
      decision: {
        schemaVersion: 1,
        outcome: "accept",
        accepted: true,
        repeatSoak: false,
        minimumHostMemoryBytes: null,
        observationCount: 1_440,
        reasons: [],
      },
      evidence: { resourceDecision: "sha256:sanitized" },
    });

    expect(result.ok).toBe(true);
    expect(migration.state.phase).toBe("go-no-go");
    expect(migration.getEvidence().records.at(-1)).toEqual(
      expect.objectContaining({
        event: "record-runtime-decision",
        status: "accepted",
        details: {
          evidence: "provided",
          outcome: "accept",
          accepted: true,
          repeatSoak: false,
          minimumHostMemoryBytes: null,
          observationCount: 1_440,
          reasonCount: 0,
        },
      }),
    );
  });

  it("enforces a resize-and-repeat-soak runtime decision", () => {
    const migration = createMigrationOrchestrator();
    reachGoNoGo(migration);

    const result = migration.execute({
      type: "record-runtime-decision",
      decision: {
        schemaVersion: 1,
        outcome: "resize-repeat-soak",
        accepted: false,
        repeatSoak: true,
        minimumHostMemoryBytes: 2 * 1024 ** 3,
        observationCount: 12,
        reasons: [{ code: "resource-restart" }],
      },
      evidence: { resourceDecision: "sha256:sanitized" },
    });

    expect(result.ok).toBe(true);
    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "rehearsal-remediation",
        terminalOutcome: "rehearsal-remediation",
      }),
    );
    expect(migration.infrastructure.requests.at(-1)).toEqual({
      type: "record-runtime-decision",
      target: "operator",
    });
  });

  it("rejects a forged resize decision that requires less than 2 GiB", () => {
    const migration = createMigrationOrchestrator();
    reachGoNoGo(migration);

    const result = migration.execute({
      type: "record-runtime-decision",
      decision: {
        schemaVersion: 1,
        outcome: "resize-repeat-soak",
        accepted: false,
        repeatSoak: true,
        minimumHostMemoryBytes: 1024 ** 3,
        observationCount: 1,
        reasons: [{ code: "oom" }],
      },
      evidence: { resourceDecision: "sha256:sanitized" },
    });

    expect(result.exitCode).toBe(1);
    expect(migration.state.phase).toBe("go-no-go");
  });

  it("rejects authenticated DigitalOcean validation before its write epoch", () => {
    const migration = createMigrationOrchestrator();

    const result = migration.execute({
      type: "validate-authenticated-digitalocean",
      evidence: { browser: "passed" },
    });

    expect(result.exitCode).toBe(1);
    expect(migration.state.authority).toBe("racknerd-original");
  });

  it("rejects unrecognized commands instead of treating them as validation", () => {
    const migration = createMigrationOrchestrator();
    reachWriteEpochReady(migration);
    declareDigitalOceanEpoch(migration);

    const result = migration.execute({
      type: "unrecognized-command",
      evidence: verifiedEvidence,
    } as unknown as Parameters<MigrationOrchestrator["execute"]>[0]);

    expect(result.exitCode).toBe(1);
    expect(migration.state.phase).toBe("private-validation");
  });

  it("rejects unchanged-source recovery and stale RackNerd restart after the write epoch", () => {
    const migration = createMigrationOrchestrator();
    reachWriteEpochReady(migration);
    declareDigitalOceanEpoch(migration);

    expect(
      migration.execute({
        type: "recover-unchanged-racknerd",
        evidence: verifiedEvidence,
      }).exitCode,
    ).toBe(1);
    expect(
      migration.execute({
        type: "restart-database",
        database: "racknerd-production",
        evidence: verifiedEvidence,
      }).exitCode,
    ).toBe(1);
    expect(migration.state).toEqual(
      expect.objectContaining({
        phase: "private-validation",
        authority: "digitalocean-final",
      }),
    );
  });

  it("emits UTC machine and human evidence without retaining caller values", () => {
    const now = new Date("2026-08-01T14:30:45.123Z");
    const privateValues = [
      "credential-sentinel",
      "postgresql://uwplan:db-secret@example.invalid/uwplan",
      "session=cookie-sentinel",
      "token-sentinel",
      "student@example.invalid",
      "private plan title",
    ];
    const migration = createMigrationOrchestrator({
      clock: () => now,
    });

    const accepted = migration.execute({
      type: "pass-gate",
      evidence: {
        credential: privateValues[0],
        databaseUrl: privateValues[1],
        cookie: privateValues[2],
        token: privateValues[3],
        rows: [{ email: privateValues[4] }],
        data: { planTitle: privateValues[5] },
      },
    });
    const rejected = migration.execute({
      type: "record-go",
      operator: "pl3lee",
      evidence: { acceptancePackage: privateValues.join(" ") },
    });
    const evidence = migration.getEvidence();
    const everyOutput = JSON.stringify({ accepted, rejected, evidence });

    expect(evidence.records[0]).toEqual(
      expect.objectContaining({
        runId: "20260801T143045123Z",
        timestamp: "2026-08-01T14:30:45.123Z",
      }),
    );
    expect(JSON.parse(evidence.json)).toEqual(evidence.records);
    expect(evidence.markdown).toContain("# UWPlan migration evidence");
    expect(evidence.markdown).toContain("2026-08-01T14:30:45.123Z");
    expect(evidence.records[1]).toEqual(
      expect.objectContaining({
        event: "pass-gate",
        phaseBefore: "preflight",
        phaseAfter: "rehearsal-restore",
        authority: "racknerd-original",
        details: { evidence: "provided" },
      }),
    );
    for (const privateValue of privateValues) {
      expect(everyOutput).not.toContain(privateValue);
    }
  });
});
