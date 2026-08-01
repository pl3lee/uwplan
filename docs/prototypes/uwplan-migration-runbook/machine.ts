export type Phase =
  | "preflight"
  | "rehearsal_restore"
  | "rehearsal_soak"
  | "go_no_go"
  | "maintenance"
  | "write_fence"
  | "final_restore"
  | "candidate_read_only"
  | "origin_switch"
  | "write_epoch_ready"
  | "private_validation"
  | "public_open"
  | "post_open_monitor"
  | "retention"
  | "complete"
  | "rehearsal_remediation"
  | "prewrite_recovery"
  | "racknerd_restored"
  | "reverse_fence"
  | "reverse_restore"
  | "racknerd_epoch_ready"
  | "reverse_private_validation"
  | "racknerd_public_monitor"
  | "rolled_back";

export type PublicMode =
  | "racknerd-public"
  | "rehearsal-only"
  | "edge-maintenance"
  | "digitalocean-public";

export type Authority =
  | "racknerd-original"
  | "digitalocean-final"
  | "racknerd-rollback";

export type Action =
  | { type: "pass" }
  | { type: "fail" }
  | { type: "abort" }
  | { type: "tick" }
  | { type: "go" }
  | { type: "epoch" }
  | { type: "reset" };

export interface MigrationState {
  phase: Phase;
  publicMode: PublicMode;
  authority: Authority;
  digitalOceanWriteEpoch: boolean;
  maintenanceMinutes: number;
  soakHours: number;
  postOpenMinutes: number;
  stableDays: number;
  lastDecision: string;
  history: string[];
}

export interface PhaseInfo {
  title: string;
  owner: string;
  evidence: string[];
  stop: string;
}

export const phaseInfo: Record<Phase, PhaseInfo> = {
  preflight: {
    title: "Implementation and rehearsal preflight",
    owner: "pl3lee",
    evidence: [
      "All required app, Compose, Caddy, Alloy, deploy, migration, and Cloudflare scripts exist",
      "Secrets and least-privilege tokens are provisioned without appearing in output",
      "Pinned image and tooling digests are recorded",
    ],
    stop: "Any placeholder, missing command, missing secret, or untested rollback path blocks rehearsal.",
  },
  rehearsal_restore: {
    title: "Forward restore and reverse-restore rehearsal",
    owner: "pl3lee",
    evidence: [
      "RackNerd-to-DigitalOcean archive, hash, restore, and exact integrity gates pass",
      "DigitalOcean-to-isolated-RackNerd reverse drill passes",
      "Neither drill touches a live database",
    ],
    stop: "Any hash, restore, ownership, schema, content, sequence, constraint, or index mismatch.",
  },
  rehearsal_soak: {
    title: "Protected 24-hour rehearsal soak",
    owner: "pl3lee",
    evidence: [
      "Required Chrome and iPhone Safari workflows and both OAuth providers pass",
      "Availability, latency, resource, restart, HTTPS, telemetry, and alert gates pass",
      "No runtime-affecting change has reset the clock",
    ],
    stop: "A hard-gate failure, resize trigger, unexplained anomaly, or less than 24 valid hours.",
  },
  go_no_go: {
    title: "Sole operator go/no-go",
    owner: "pl3lee",
    evidence: [
      "Sanitized acceptance package is complete",
      "Every hard gate passes and every tolerance is met",
      "pl3lee records a timestamped GO",
    ],
    stop: "Missing evidence or anything other than an explicit GO.",
  },
  maintenance: {
    title: "Cloudflare maintenance and deployment freeze",
    owner: "pl3lee",
    evidence: [
      "Fail-closed maintenance returns no-store 503 from two networks",
      "Only /api/ready and operator bypass can pass",
      "Old and new production deployment paths are frozen",
    ],
    stop: "Any public/OAuth path reaches an origin or either deployment path remains live.",
  },
  write_fence: {
    title: "RackNerd write fence",
    owner: "pl3lee",
    evidence: [
      "Production app is stopped and cannot be recreated by Coolify",
      "Three pg_stat_activity samples across 60 seconds show zero application sessions",
      "Fence timestamp and source WAL position are recorded",
    ],
    stop: "Any new application session, app restart, or source write invalidates the fence.",
  },
  final_restore: {
    title: "Final archive, transfer, fresh restore, and integrity gates",
    owner: "pl3lee",
    evidence: [
      "Post-fence custom archive and manifest finish without unexplained warnings",
      "Source and destination SHA-256 match",
      "Atomic fresh-candidate restore and every exact-match gate pass",
    ],
    stop: "Any dump, transfer, restore, integrity, role, or permission failure.",
  },
  candidate_read_only: {
    title: "Production candidate read-only validation",
    owner: "pl3lee",
    evidence: [
      "v2 route and rehearsal app are detached before production secrets load",
      "Expected production release and final database are healthy",
      "Direct-origin health, logs, metrics, and traces are clean",
    ],
    stop: "Any production secret is exposed to rehearsal or any authenticated request is admitted.",
  },
  origin_switch: {
    title: "Proxied Cloudflare origins point to DigitalOcean",
    owner: "pl3lee",
    evidence: [
      "Apex and www preserve proxy status and point to the captured DigitalOcean IP",
      "Full (strict) origin TLS passes",
      "Expected readiness is observed from multiple networks for five minutes",
    ],
    stop: "Old-origin response, TLS failure, readiness mismatch, or unintended DNS field change.",
  },
  write_epoch_ready: {
    title: "Ready to declare DigitalOcean write epoch",
    owner: "pl3lee",
    evidence: [
      "Every read-only gate has passed",
      "Operator bypass is short-lived and strips itself upstream",
      "Operator understands that RackNerd becomes stale now",
    ],
    stop: "Do not use Pass. Explicitly declare the epoch with the dedicated action.",
  },
  private_validation: {
    title: "Private production session, OAuth, write, and telemetry smoke",
    owner: "pl3lee",
    evidence: [
      "Existing production session survives and fresh Google/GitHub sign-ins work",
      "Disposable schedule mutation persists and CSV export is valid",
      "Ten clean minutes show no 5xx, restart, resource breach, or alert",
    ],
    stop: "Any failure now requires reverse migration; never restart stale RackNerd data.",
  },
  public_open: {
    title: "Remove maintenance and verify public traffic",
    owner: "pl3lee",
    evidence: [
      "Operator bypass is rotated or deleted",
      "Public app and OAuth work from two networks",
      "No stale maintenance response remains after the propagation allowance",
    ],
    stop: "Any serious failure restores maintenance and enters the post-write policy.",
  },
  post_open_monitor: {
    title: "One-hour deployment-frozen elevated monitoring",
    owner: "pl3lee",
    evidence: [
      "One full hour passes cleanly",
      "Only the new DigitalOcean deployment path is re-enabled",
      "Re-enabling does not itself release an image",
    ],
    stop: "Five-minute readiness loss or any serious data/auth/security/runtime incident.",
  },
  retention: {
    title: "Seven-day stopped RackNerd retention",
    owner: "pl3lee",
    evidence: [
      "Seven stable days and seven verified daily backups",
      "At least one post-cutover backup test-restore passes",
      "One controlled DigitalOcean production deployment passes",
      "No unresolved migration incident remains",
    ],
    stop: "A material migration incident/runtime change resets the seven-day clock.",
  },
  complete: {
    title: "Migration runbook complete",
    owner: "pl3lee",
    evidence: [
      "Final evidence package complete",
      "Later decommissioning explicitly approved",
    ],
    stop: "Decommissioning remains a separate execution task.",
  },
  rehearsal_remediation: {
    title: "Rehearsal remediation required",
    owner: "pl3lee",
    evidence: [
      "Cause is corrected",
      "Every affected gate is repeated",
      "A fresh 24-hour soak passes",
    ],
    stop: "No cutover is authorized from this state.",
  },
  prewrite_recovery: {
    title: "Pre-write abort: restore unchanged RackNerd authority",
    owner: "pl3lee",
    evidence: [
      "Cloudflare origins are restored if changed",
      "Failed candidate remains offline",
      "Unchanged RackNerd database and app pass private validation",
      "Maintenance is removed only after validation",
    ],
    stop: "If DigitalOcean admitted an authenticated request, this path is illegal; reverse-migrate.",
  },
  racknerd_restored: {
    title: "Pre-write abort complete",
    owner: "pl3lee",
    evidence: [
      "RackNerd is public and authoritative",
      "Abort evidence is recorded",
    ],
    stop: "Rehearsal and authorization must be repeated before another attempt.",
  },
  reverse_fence: {
    title: "Post-write rollback: fence DigitalOcean",
    owner: "pl3lee",
    evidence: [
      "Edge maintenance is active",
      "DigitalOcean app and deployments are stopped",
      "Zero non-operator DigitalOcean database sessions",
    ],
    stop: "Do not read from or restart the stale RackNerd production database.",
  },
  reverse_restore: {
    title: "Reverse dump and fresh RackNerd candidate restore",
    owner: "pl3lee",
    evidence: [
      "DigitalOcean archive and manifest are complete and hashes match",
      "Fresh RackNerd candidate passes every integrity gate",
      "Preserved RackNerd app is attached only to the new candidate",
    ],
    stop: "If DigitalOcean is unreadable, stop: recovery inherits the latest verified backup RPO.",
  },
  racknerd_epoch_ready: {
    title: "Ready to declare new RackNerd write epoch",
    owner: "pl3lee",
    evidence: [
      "Cloudflare readiness reports the new RackNerd candidate for five minutes",
      "All read-only rollback gates pass",
      "Operator bypass is ready",
    ],
    stop: "Explicitly declare the new epoch before private write validation.",
  },
  reverse_private_validation: {
    title: "Private validation of reverse-migrated RackNerd",
    owner: "pl3lee",
    evidence: [
      "Existing/fresh auth and representative data pass",
      "Disposable write persists",
      "Health and telemetry remain clean",
    ],
    stop: "Do not remove maintenance on any failed gate.",
  },
  racknerd_public_monitor: {
    title: "RackNerd public rollback monitoring",
    owner: "pl3lee",
    evidence: [
      "One clean hour passes",
      "Old deployment path is restored only after that hour",
    ],
    stop: "Keep DigitalOcean stopped and retain both evidence sets.",
  },
  rolled_back: {
    title: "Reverse-migration rollback complete",
    owner: "pl3lee",
    evidence: [
      "RackNerd rollback candidate is authoritative",
      "DigitalOcean remains stopped for investigation",
    ],
    stop: "A new migration attempt requires a fresh rehearsal and GO.",
  },
};

export const initialState = (): MigrationState => ({
  phase: "preflight",
  publicMode: "racknerd-public",
  authority: "racknerd-original",
  digitalOceanWriteEpoch: false,
  maintenanceMinutes: 0,
  soakHours: 0,
  postOpenMinutes: 0,
  stableDays: 0,
  lastDecision: "Prototype initialized. No infrastructure has changed.",
  history: ["preflight"],
});

const beforeDigitalOceanEpoch = new Set<Phase>([
  "maintenance",
  "write_fence",
  "final_restore",
  "candidate_read_only",
  "origin_switch",
  "write_epoch_ready",
]);

const terminal = new Set<Phase>([
  "complete",
  "rehearsal_remediation",
  "racknerd_restored",
  "rolled_back",
]);

const nextPhase: Partial<Record<Phase, Phase>> = {
  preflight: "rehearsal_restore",
  rehearsal_restore: "rehearsal_soak",
  maintenance: "write_fence",
  write_fence: "final_restore",
  final_restore: "candidate_read_only",
  candidate_read_only: "origin_switch",
  origin_switch: "write_epoch_ready",
  private_validation: "public_open",
  public_open: "post_open_monitor",
  post_open_monitor: "retention",
  retention: "complete",
  prewrite_recovery: "racknerd_restored",
  reverse_fence: "reverse_restore",
  reverse_restore: "racknerd_epoch_ready",
  reverse_private_validation: "racknerd_public_monitor",
  racknerd_public_monitor: "rolled_back",
};

function move(
  state: MigrationState,
  phase: Phase,
  decision: string,
): MigrationState {
  return {
    ...state,
    phase,
    lastDecision: decision,
    history: [...state.history, phase],
  };
}

function routeFailure(state: MigrationState, reason: string): MigrationState {
  if (
    ["preflight", "rehearsal_restore", "rehearsal_soak", "go_no_go"].includes(
      state.phase,
    )
  ) {
    return move(
      state,
      "rehearsal_remediation",
      `${reason} Cutover remains unauthorized.`,
    );
  }
  if (
    !state.digitalOceanWriteEpoch &&
    beforeDigitalOceanEpoch.has(state.phase)
  ) {
    return move(
      state,
      "prewrite_recovery",
      `${reason} Recover the unchanged RackNerd source.`,
    );
  }
  return move(
    state,
    "reverse_fence",
    `${reason} DigitalOcean may contain writes; reverse migration is mandatory.`,
  );
}

export function reduceMigration(
  state: MigrationState,
  action: Action,
): MigrationState {
  if (action.type === "reset") return initialState();
  if (terminal.has(state.phase)) {
    return {
      ...state,
      lastDecision:
        "This is a terminal outcome. Reset to explore another path.",
    };
  }

  if (action.type === "fail")
    return routeFailure(state, "Current gate failed.");
  if (action.type === "abort")
    return routeFailure(state, "Operator requested abort.");

  if (action.type === "tick") {
    if (state.phase === "rehearsal_soak") {
      const soakHours = Math.min(24, state.soakHours + 6);
      return {
        ...state,
        soakHours,
        lastDecision: `Rehearsal clock advanced to ${soakHours} valid hours.`,
      };
    }
    if (
      state.phase === "post_open_monitor" ||
      state.phase === "racknerd_public_monitor"
    ) {
      const postOpenMinutes = Math.min(60, state.postOpenMinutes + 15);
      return {
        ...state,
        postOpenMinutes,
        lastDecision: `Public monitoring advanced to ${postOpenMinutes} minutes.`,
      };
    }
    if (state.phase === "retention") {
      const stableDays = Math.min(7, state.stableDays + 1);
      return {
        ...state,
        stableDays,
        lastDecision: `Stable retention advanced to ${stableDays} days.`,
      };
    }
    if (
      beforeDigitalOceanEpoch.has(state.phase) ||
      state.phase === "private_validation"
    ) {
      const maintenanceMinutes = state.maintenanceMinutes + 15;
      if (maintenanceMinutes >= 45) {
        return routeFailure(
          { ...state, maintenanceMinutes },
          "Minute-45 maintenance deadline reached before public reopening.",
        );
      }
      return {
        ...state,
        maintenanceMinutes,
        lastDecision: `Maintenance clock advanced to ${maintenanceMinutes} minutes.`,
      };
    }
    return {
      ...state,
      lastDecision: "The clock has no modeled effect in this phase.",
    };
  }

  if (action.type === "go") {
    if (state.phase !== "go_no_go") {
      return {
        ...state,
        lastDecision: "GO is legal only at the signed go/no-go gate.",
      };
    }
    return move(
      { ...state, publicMode: "rehearsal-only", maintenanceMinutes: 0 },
      "maintenance",
      "pl3lee recorded GO. Enter the controlled maintenance window.",
    );
  }

  if (action.type === "epoch") {
    if (state.phase === "write_epoch_ready") {
      return move(
        {
          ...state,
          digitalOceanWriteEpoch: true,
          authority: "digitalocean-final",
        },
        "private_validation",
        "DigitalOcean write epoch recorded. RackNerd is now stale.",
      );
    }
    if (state.phase === "racknerd_epoch_ready") {
      return move(
        { ...state, authority: "racknerd-rollback" },
        "reverse_private_validation",
        "New RackNerd write epoch recorded against the reverse-migrated candidate.",
      );
    }
    return {
      ...state,
      lastDecision: "No write epoch may be declared in this phase.",
    };
  }

  if (action.type === "pass") {
    if (state.phase === "rehearsal_soak") {
      if (state.soakHours < 24) {
        return {
          ...state,
          lastDecision:
            "The rehearsal needs 24 valid hours. Advance the clock first.",
        };
      }
      return move(
        state,
        "go_no_go",
        "Rehearsal gates passed. Await the sole operator's explicit GO.",
      );
    }
    if (state.phase === "go_no_go") {
      return {
        ...state,
        lastDecision:
          "Pass is insufficient here. Record an explicit GO or fail the gate.",
      };
    }
    if (
      state.phase === "write_epoch_ready" ||
      state.phase === "racknerd_epoch_ready"
    ) {
      return {
        ...state,
        lastDecision:
          "Pass is insufficient here. Explicitly declare the write epoch.",
      };
    }
    if (
      state.phase === "post_open_monitor" ||
      state.phase === "racknerd_public_monitor"
    ) {
      if (state.postOpenMinutes < 60) {
        return {
          ...state,
          lastDecision:
            "One full clean hour is required. Advance the monitoring clock.",
        };
      }
    }
    if (state.phase === "retention" && state.stableDays < 7) {
      return {
        ...state,
        lastDecision:
          "Seven stable days are required. Advance the retention clock.",
      };
    }
    const destination = nextPhase[state.phase];
    if (!destination)
      return {
        ...state,
        lastDecision: "There is no ordinary pass transition from this phase.",
      };

    let updated = move(
      state,
      destination,
      `Gate passed. Advanced to ${phaseInfo[destination].title}.`,
    );
    if (state.phase === "maintenance")
      updated = { ...updated, publicMode: "edge-maintenance" };
    if (state.phase === "public_open")
      updated = {
        ...updated,
        publicMode: "digitalocean-public",
        postOpenMinutes: 0,
      };
    if (state.phase === "prewrite_recovery")
      updated = { ...updated, publicMode: "racknerd-public" };
    if (state.phase === "reverse_private_validation") {
      updated = {
        ...updated,
        publicMode: "racknerd-public",
        postOpenMinutes: 0,
      };
    }
    return updated;
  }

  return state;
}
