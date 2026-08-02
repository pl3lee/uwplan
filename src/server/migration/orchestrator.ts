export type MigrationPhase =
  | "preflight"
  | "rehearsal-restore"
  | "rehearsal-soak"
  | "go-no-go"
  | "maintenance"
  | "write-fence"
  | "final-restore"
  | "candidate-read-only"
  | "origin-switch"
  | "write-epoch-ready"
  | "private-validation"
  | "public-monitoring"
  | "retention"
  | "complete"
  | "rehearsal-remediation"
  | "pre-write-recovery"
  | "racknerd-restored"
  | "reverse-fence"
  | "reverse-restore"
  | "racknerd-epoch-ready"
  | "reverse-private-validation"
  | "racknerd-public-monitoring"
  | "rolled-back";

export type DatabaseAuthority =
  | "racknerd-original"
  | "digitalocean-final"
  | "racknerd-reverse-candidate";

export interface MigrationState {
  readonly runId: string;
  readonly phase: MigrationPhase;
  readonly authority: DatabaseAuthority;
  readonly authoritativeDatabase: string;
  readonly digitalOceanWriteEpoch: boolean;
  readonly staleDatabases: readonly string[];
  readonly terminalOutcome:
    | "complete"
    | "rehearsal-remediation"
    | "pre-write-abort"
    | "rolled-back"
    | null;
}

export interface InfrastructureOperation {
  readonly type: MigrationCommand["type"];
  readonly target: "racknerd" | "digitalocean" | "edge" | "operator";
}

export interface RuntimeDecisionReport {
  readonly schemaVersion: 1;
  readonly outcome:
    | "accept"
    | "investigate"
    | "block-cutover"
    | "resize-repeat-soak";
  readonly accepted: boolean;
  readonly repeatSoak: boolean;
  readonly minimumHostMemoryBytes: number | null;
  readonly observationCount: number;
  readonly reasons: readonly { readonly code: string }[];
}

export type MigrationCommand =
  | { type: "pass-gate"; evidence: Record<string, unknown> }
  | {
      type: "fail-gate";
      reason: string;
      evidence: Record<string, unknown>;
    }
  | {
      type: "record-runtime-decision";
      decision: RuntimeDecisionReport;
      evidence: Record<string, unknown>;
    }
  | {
      type: "recover-unchanged-racknerd";
      evidence: Record<string, unknown>;
    }
  | {
      type: "restart-database";
      database: string;
      evidence: Record<string, unknown>;
    }
  | {
      type: "record-go";
      operator: "pl3lee";
      evidence: { acceptancePackage?: string };
    }
  | {
      type: "declare-digitalocean-write-epoch";
      database: string;
      evidence: Record<string, unknown>;
    }
  | {
      type: "declare-racknerd-write-epoch";
      database: string;
      evidence: Record<string, unknown>;
    }
  | {
      type: "validate-authenticated-digitalocean";
      evidence: Record<string, unknown>;
    };

export interface CommandResult {
  ok: boolean;
  exitCode: 0 | 1;
  state: MigrationState;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface EvidenceRecord {
  runId: string;
  timestamp: string;
  event: string;
  status: "accepted" | "rejected";
  phaseBefore: MigrationPhase;
  phaseAfter: MigrationPhase;
  authority: DatabaseAuthority;
  details: Record<string, unknown>;
  message?: string;
}

export interface EvidenceBundle {
  records: EvidenceRecord[];
  json: string;
  markdown: string;
}

class DryRunInfrastructureRecorder {
  readonly mode = "dry-run" as const;
  readonly requests: InfrastructureOperation[] = [];

  request(operation: InfrastructureOperation) {
    this.requests.push(operation);
  }
}

export interface DryRunInfrastructureView {
  readonly mode: "dry-run";
  readonly requests: readonly InfrastructureOperation[];
}

export interface MigrationOrchestrator {
  readonly state: MigrationState;
  readonly infrastructure: DryRunInfrastructureView;
  execute(command: MigrationCommand): CommandResult;
  getEvidence(): EvidenceBundle;
}

export interface CreateMigrationOptions {
  clock?: () => Date;
}

function utcRunId(date: Date) {
  return date.toISOString().replaceAll(/[-:.]/g, "");
}

function snapshotState(state: MigrationState): MigrationState {
  return Object.freeze({
    ...state,
    staleDatabases: Object.freeze([...state.staleDatabases]),
  });
}

const passTransitions: Partial<Record<MigrationPhase, MigrationPhase>> = {
  preflight: "rehearsal-restore",
  "rehearsal-restore": "rehearsal-soak",
  "rehearsal-soak": "go-no-go",
  maintenance: "write-fence",
  "write-fence": "final-restore",
  "final-restore": "candidate-read-only",
  "candidate-read-only": "origin-switch",
  "origin-switch": "write-epoch-ready",
  "public-monitoring": "retention",
  retention: "complete",
  "reverse-fence": "reverse-restore",
  "reverse-restore": "racknerd-epoch-ready",
  "reverse-private-validation": "racknerd-public-monitoring",
  "racknerd-public-monitoring": "rolled-back",
};

const preWriteCutoverPhases = new Set<MigrationPhase>([
  "maintenance",
  "write-fence",
  "final-restore",
  "candidate-read-only",
  "origin-switch",
  "write-epoch-ready",
]);

const rehearsalPhases = new Set<MigrationPhase>([
  "preflight",
  "rehearsal-restore",
  "rehearsal-soak",
  "go-no-go",
]);

const postWriteFailurePhases = new Set<MigrationPhase>([
  "private-validation",
  "public-monitoring",
  "retention",
]);

function hasEvidence(evidence: Record<string, unknown>) {
  return Object.keys(evidence).length > 0;
}

function targetFor(phase: MigrationPhase): InfrastructureOperation["target"] {
  if (
    [
      "maintenance",
      "origin-switch",
      "public-monitoring",
      "racknerd-public-monitoring",
    ].includes(phase)
  ) {
    return "edge";
  }
  if (
    [
      "candidate-read-only",
      "final-restore",
      "write-epoch-ready",
      "private-validation",
      "reverse-fence",
    ].includes(phase)
  ) {
    return "digitalocean";
  }
  if (
    [
      "write-fence",
      "pre-write-recovery",
      "reverse-restore",
      "racknerd-epoch-ready",
      "reverse-private-validation",
    ].includes(phase)
  ) {
    return "racknerd";
  }
  return "operator";
}

const databaseIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function evidenceSafeDetails(
  command: MigrationCommand,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    evidence: hasEvidence(command.evidence) ? "provided" : "missing",
  };
  if (command.type === "record-go") details.operator = command.operator;
  if (command.type === "record-runtime-decision") {
    details.outcome = command.decision.outcome;
    details.accepted = command.decision.accepted;
    details.repeatSoak = command.decision.repeatSoak;
    details.minimumHostMemoryBytes = command.decision.minimumHostMemoryBytes;
    details.observationCount = command.decision.observationCount;
    details.reasonCount = command.decision.reasons.length;
  }
  if (
    command.type === "declare-digitalocean-write-epoch" ||
    command.type === "declare-racknerd-write-epoch" ||
    command.type === "restart-database"
  ) {
    details.database = databaseIdentityPattern.test(command.database)
      ? command.database
      : "[INVALID_IDENTIFIER]";
  }
  return details;
}

export function createMigrationOrchestrator(
  options: CreateMigrationOptions = {},
): MigrationOrchestrator {
  const clock = options.clock ?? (() => new Date());
  const infrastructure = new DryRunInfrastructureRecorder();
  const infrastructureView: DryRunInfrastructureView = Object.freeze({
    mode: infrastructure.mode,
    get requests() {
      return Object.freeze(
        infrastructure.requests.map((operation) =>
          Object.freeze({ ...operation }),
        ),
      );
    },
  });

  let state: MigrationState = {
    runId: utcRunId(clock()),
    phase: "preflight",
    authority: "racknerd-original",
    authoritativeDatabase: "racknerd-production",
    digitalOceanWriteEpoch: false,
    staleDatabases: [],
    terminalOutcome: null,
  };

  const evidenceRecords: EvidenceRecord[] = [
    {
      runId: state.runId,
      timestamp: clock().toISOString(),
      event: "run-created",
      status: "accepted",
      phaseBefore: "preflight",
      phaseAfter: "preflight",
      authority: "racknerd-original",
      details: { adapterMode: infrastructure.mode },
    },
  ];
  let activeCommand: MigrationCommand | undefined;
  let phaseBeforeCommand: MigrationPhase = state.phase;
  let runtimeDecisionAccepted = false;

  const appendEvidence = (
    status: EvidenceRecord["status"],
    message?: string,
  ) => {
    if (!activeCommand) return;
    evidenceRecords.push({
      runId: state.runId,
      timestamp: clock().toISOString(),
      event: activeCommand.type,
      status,
      phaseBefore: phaseBeforeCommand,
      phaseAfter: state.phase,
      authority: state.authority,
      details: evidenceSafeDetails(activeCommand),
      ...(message ? { message } : {}),
    });
  };

  const fail = (error: string): CommandResult => {
    appendEvidence("rejected", error);
    return {
      ok: false,
      exitCode: 1,
      state: snapshotState(state),
      stdout: "",
      stderr: error,
      error,
    };
  };
  const succeed = (): CommandResult => {
    appendEvidence("accepted");
    return {
      ok: true,
      exitCode: 0,
      state: snapshotState(state),
      stdout: `Run ${state.runId}: ${activeCommand?.type ?? "command"} accepted; phase ${state.phase}`,
      stderr: "",
    };
  };
  const request = (command: MigrationCommand) =>
    infrastructure.request({
      type: command.type,
      target: targetFor(state.phase),
    });

  return {
    infrastructure: infrastructureView,
    get state() {
      return snapshotState(state);
    },
    getEvidence() {
      const records = evidenceRecords.map((record) => ({ ...record }));
      return {
        records,
        json: JSON.stringify(records, null, 2),
        markdown: [
          "# UWPlan migration evidence",
          "",
          `Run: ${state.runId}`,
          "",
          ...records.flatMap((record) => [
            `## ${record.timestamp} — ${record.event}`,
            "",
            `- Status: ${record.status}`,
            `- Phase: ${record.phaseBefore} → ${record.phaseAfter}`,
            `- Authority: ${record.authority}`,
            `- Details: \`${JSON.stringify(record.details)}\``,
            ...(record.message ? [`- Message: ${record.message}`] : []),
            "",
          ]),
        ].join("\n"),
      };
    },
    execute(command) {
      activeCommand = command;
      phaseBeforeCommand = state.phase;
      if (state.terminalOutcome)
        return fail("The migration has reached a terminal outcome");

      if (command.type === "pass-gate") {
        if (!hasEvidence(command.evidence))
          return fail("Gate evidence is required");
        const destination = passTransitions[state.phase];
        if (!destination)
          return fail(`A pass transition is not legal from ${state.phase}`);
        request(command);
        state = {
          ...state,
          phase: destination,
          terminalOutcome:
            destination === "complete"
              ? "complete"
              : destination === "rolled-back"
                ? "rolled-back"
                : state.terminalOutcome,
        };
        return succeed();
      }

      if (command.type === "fail-gate") {
        if (!hasEvidence(command.evidence))
          return fail("Failure evidence is required");
        if (rehearsalPhases.has(state.phase)) {
          request(command);
          state = {
            ...state,
            phase: "rehearsal-remediation",
            terminalOutcome: "rehearsal-remediation",
          };
        } else if (
          !state.digitalOceanWriteEpoch &&
          preWriteCutoverPhases.has(state.phase)
        ) {
          request(command);
          state = { ...state, phase: "pre-write-recovery" };
        } else if (
          state.digitalOceanWriteEpoch &&
          postWriteFailurePhases.has(state.phase)
        ) {
          request(command);
          state = { ...state, phase: "reverse-fence" };
        } else {
          return fail(`A failure transition is not legal from ${state.phase}`);
        }
        return succeed();
      }

      if (command.type === "record-runtime-decision") {
        const { decision } = command;
        const outcomes = new Set<RuntimeDecisionReport["outcome"]>([
          "accept",
          "investigate",
          "block-cutover",
          "resize-repeat-soak",
        ]);
        if (state.phase !== "go-no-go") {
          return fail("Runtime acceptance belongs at the go/no-go gate");
        }
        if (!hasEvidence(command.evidence)) {
          return fail("Runtime decision evidence is required");
        }
        if (
          decision.schemaVersion !== 1 ||
          !outcomes.has(decision.outcome) ||
          !Number.isSafeInteger(decision.observationCount) ||
          decision.observationCount < 1 ||
          !Array.isArray(decision.reasons) ||
          decision.accepted !== (decision.outcome === "accept") ||
          decision.repeatSoak !== (decision.outcome === "resize-repeat-soak") ||
          (decision.outcome === "resize-repeat-soak" &&
            (typeof decision.minimumHostMemoryBytes !== "number" ||
              !Number.isSafeInteger(decision.minimumHostMemoryBytes) ||
              decision.minimumHostMemoryBytes < 2 * 1024 ** 3)) ||
          (decision.outcome !== "resize-repeat-soak" &&
            decision.minimumHostMemoryBytes !== null)
        ) {
          return fail("Runtime decision report is invalid");
        }
        request(command);
        if (!decision.accepted) {
          state = {
            ...state,
            phase: "rehearsal-remediation",
            terminalOutcome: "rehearsal-remediation",
          };
        } else {
          runtimeDecisionAccepted = true;
        }
        return succeed();
      }

      if (command.type === "recover-unchanged-racknerd") {
        if (state.digitalOceanWriteEpoch) {
          return fail(
            "Unchanged-source recovery is illegal after the DigitalOcean write epoch",
          );
        }
        if (state.phase !== "pre-write-recovery") {
          return fail(
            "Unchanged-source recovery is not required in the current phase",
          );
        }
        if (!hasEvidence(command.evidence))
          return fail("Recovery evidence is required");
        request(command);
        state = {
          ...state,
          phase: "racknerd-restored",
          terminalOutcome: "pre-write-abort",
        };
        return succeed();
      }

      if (command.type === "record-go") {
        if (state.phase !== "go-no-go")
          return fail("GO is legal only at the go/no-go gate");
        if (command.operator !== "pl3lee")
          return fail("GO requires the pl3lee operator");
        if (!command.evidence.acceptancePackage) {
          return fail("GO requires a complete acceptance package");
        }
        if (!runtimeDecisionAccepted) {
          return fail("GO requires an accepted runtime decision");
        }
        request(command);
        state = { ...state, phase: "maintenance" };
        return succeed();
      }

      if (command.type === "declare-digitalocean-write-epoch") {
        if (state.phase !== "write-epoch-ready") {
          return fail("The DigitalOcean write epoch is not ready");
        }
        if (!hasEvidence(command.evidence))
          return fail("Write-epoch evidence is required");
        if (!databaseIdentityPattern.test(command.database))
          return fail("A safe database identity is required");
        request(command);
        state = {
          ...state,
          phase: "private-validation",
          authority: "digitalocean-final",
          authoritativeDatabase: command.database,
          digitalOceanWriteEpoch: true,
          staleDatabases: [...state.staleDatabases, "racknerd-production"],
        };
        return succeed();
      }

      if (command.type === "declare-racknerd-write-epoch") {
        if (state.phase !== "racknerd-epoch-ready") {
          return fail("The reverse-migrated RackNerd write epoch is not ready");
        }
        if (!hasEvidence(command.evidence))
          return fail("Write-epoch evidence is required");
        if (!databaseIdentityPattern.test(command.database))
          return fail("A safe database identity is required");
        request(command);
        state = {
          ...state,
          phase: "reverse-private-validation",
          authority: "racknerd-reverse-candidate",
          authoritativeDatabase: command.database,
          staleDatabases: [
            ...state.staleDatabases,
            state.authoritativeDatabase,
          ],
        };
        return succeed();
      }

      if (command.type === "restart-database") {
        if (!databaseIdentityPattern.test(command.database))
          return fail("A safe database identity is required");
        if (state.staleDatabases.includes(command.database)) {
          return fail("The stale database must never be restarted");
        }
        if (!hasEvidence(command.evidence))
          return fail("Restart evidence is required");
        request(command);
        return succeed();
      }

      if (command.type === "validate-authenticated-digitalocean") {
        if (state.phase !== "private-validation") {
          return fail(
            "Authenticated DigitalOcean validation requires its write epoch",
          );
        }
        if (!hasEvidence(command.evidence))
          return fail("Validation evidence is required");
        request(command);
        state = { ...state, phase: "public-monitoring" };
        return succeed();
      }

      return fail("The migration command is not recognized");
    },
  };
}
