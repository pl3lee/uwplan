export const SESSION_SAMPLE_INTERVAL_MS: number;
export const REQUIRED_ZERO_SESSION_SAMPLES: number;
export const MAINTENANCE_READINESS_INTERVAL_MS: number;
export const MAINTENANCE_READINESS_WINDOW_MS: number;
export const PUBLIC_MONITOR_INTERVAL_MS: number;
export const PUBLIC_MONITOR_WINDOW_MS: number;
export const DIGITALOCEAN_READ_ONLY_GATES: readonly string[];
export const RACKNERD_REVERSE_READ_ONLY_GATES: readonly string[];

export interface GateReceipt {
  gate: string;
  verifiedAt: string;
  digest: string;
}

export interface SignedEpochAction {
  schemaVersion: 1;
  runId: string;
  operator: "pl3lee";
  action: "declare-digitalocean-write-epoch" | "declare-racknerd-write-epoch";
  database: string;
  issuedAt: string;
  gateReceipts: GateReceipt[];
  signature: string;
}

export interface PostWriteAdapters {
  deploy: {
    freeze(environment: string): Promise<{
      accepted: boolean;
      environment: string;
      frozen: boolean;
    }>;
    thaw(environment: string): Promise<{
      accepted: boolean;
      environment: string;
      frozen: boolean;
    }>;
  };
  edge: {
    enableMaintenance(): Promise<{ accepted: boolean }>;
    verifyMaintenance(network: string): Promise<{
      accepted: boolean;
      network: string;
      status: number;
      originContacted: boolean;
    }>;
    switchToRackNerd(input: { database: string; maintenance: true }): Promise<{
      accepted: boolean;
      database: string;
      maintenance: boolean;
      origin: string;
    }>;
    sampleMaintenanceReadiness(input: {
      networks: string[];
      database: string;
    }): Promise<{
      maintenance: boolean;
      publicStatus: number;
      readiness: string;
      origin: string;
      database: string;
      networkCount: number;
    }>;
    readinessGateReceipt(input: {
      database: string;
      sampleCount: number;
    }): Promise<GateReceipt>;
    disableMaintenance(): Promise<{ accepted: boolean }>;
    samplePublicReadiness(input: { database: string }): Promise<{
      status: number;
      readiness: string;
      origin: string;
      database: string;
      clean: boolean;
    }>;
  };
  source: {
    verifyReadable(input: { database: string }): Promise<{ readable: boolean }>;
    stopWritersAndDisableRecreate(input: {
      service: "digitalocean-production-app";
    }): Promise<{
      stoppedService: string;
      recreateDisabled: boolean;
      databaseStopped: boolean;
      rackNerdTouched: boolean;
    }>;
    sampleApplicationSessions(): Promise<{ applicationSessions: number }>;
    captureCurrentData(input: { runId: string; database: string }): Promise<{
      database: string;
      current: boolean;
      protected: boolean;
      sha256: string;
      capturedAt: string;
    }>;
  };
  backup: {
    latestVerified(): Promise<{
      verified: boolean;
      capturedAt: string;
      sha256: string;
    }>;
  };
  candidate: {
    restoreFresh(input: {
      runId: string;
      capture: unknown;
      target: "racknerd";
      forbiddenDatabase: "racknerd-production";
    }): Promise<{
      candidateDatabase: string;
      freshCandidate: boolean;
      restored: boolean;
      archiveSha256: string;
      staleDatabaseStarted: boolean;
    }>;
    validateIntegrity(database: string): Promise<{
      accepted: boolean;
      database: string;
      failedGates: string[];
      archiveSha256: string;
      gateReceipt: GateReceipt;
    }>;
    validateReadOnly(database: string): Promise<{
      accepted: boolean;
      database: string;
      writeAttemptRejected: boolean;
      writeEpochDeclared: boolean;
      readiness: string;
      gateReceipt: GateReceipt;
    }>;
    attachPreservedApp(input: {
      application: "racknerd-production-app";
      database: string;
    }): Promise<{
      accepted: boolean;
      application: string;
      database: string;
      otherDatabasesAttached: number;
    }>;
    declareWriteEpoch(input: {
      database: string;
      action: SignedEpochAction;
    }): Promise<{
      accepted: boolean;
      database: string;
      writeEpoch: boolean;
    }>;
    validatePrivateAuthAndWrite(database: string): Promise<{
      accepted: boolean;
      database: string;
      authenticated: boolean;
      writePreserved: boolean;
    }>;
  };
  operator: {
    authorizeRackNerdWriteEpoch(input: {
      runId: string;
      database: string;
      gateReceipts: GateReceipt[];
    }): Promise<SignedEpochAction>;
  };
}

export function signEpochAction(
  action: Omit<SignedEpochAction, "signature">,
  signingKey: string | Buffer,
): SignedEpochAction;

export function verifyEpochAction(
  action: SignedEpochAction,
  options: {
    signingKey: string | Buffer;
    runId: string;
    expectedAction: SignedEpochAction["action"];
    expectedDatabase: string;
    requiredGates: string[];
  },
): boolean;

export function runPostWriteReverseMigration(options: {
  runId: string;
  signingKey: string | Buffer;
  digitalOceanDatabase: string;
  digitalOceanEpochAction: SignedEpochAction;
  initialReadOnlyGates: GateReceipt[];
  maintenanceNetworks: readonly [string, string];
  adapters: PostWriteAdapters;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<
  | {
      schemaVersion: 1;
      runId: string;
      status: "rolled-back";
      authority: "racknerd-reverse-candidate";
      authoritativeDatabase: string;
      staleDatabases: string[];
      evidence: readonly unknown[];
    }
  | {
      schemaVersion: 1;
      runId: string;
      status: "human-acceptance-required";
      authority: "digitalocean-final";
      explicitAcceptanceRequired: true;
      latestVerifiedBackup: {
        capturedAt: string;
        sha256: string;
        rpoSeconds: number;
      };
      evidence: readonly unknown[];
    }
>;
