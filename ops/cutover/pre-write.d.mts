export const PRE_WRITE_DEADLINE_MS: number;
export const ACTIVITY_SAMPLE_INTERVAL_MS: number;
export const REQUIRED_ACTIVITY_SAMPLES: number;

export class PreWriteRecoveryRejected extends Error {}

export interface FenceEvidence {
  schemaVersion: 1;
  runId: string;
  fencedAt: string;
  sourceWalLsn: string;
  sourceWriteCounter: number;
  sourceAppRestartCounter: number;
  signature: string;
}

export interface PreWriteAdapters {
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
    captureDns(): Promise<unknown>;
    enableMaintenance(): Promise<{ accepted: boolean }>;
    verifyMaintenance(network: string): Promise<{
      accepted: boolean;
      network: string;
      status: number;
      originContacted: boolean;
    }>;
    dnsChanged(): Promise<boolean>;
    restoreDns(snapshot: unknown): Promise<{ accepted: boolean }>;
    disableMaintenance(): Promise<{ accepted: boolean }>;
  };
  source: {
    stopProductionAppAndDisableRecreate(input: {
      service: "racknerd-production-app";
    }): Promise<{
      stoppedService: "racknerd-production-app";
      recreateDisabled: boolean;
      databaseStopped: boolean;
      stagingTouched: boolean;
    }>;
    sampleApplicationSessions(): Promise<{ applicationSessions: number }>;
    captureFence(): Promise<{
      walLsn: string;
      writeCounter: number;
      appRestartCounter: number;
    }>;
    assertFenceUnchanged(fence: FenceEvidence): Promise<{
      applicationSessions: number;
      walLsn: string;
      writeCounter: number;
      appRestartCounter: number;
    }>;
    startProductionApp(input: {
      service: "racknerd-production-app";
    }): Promise<{ accepted: boolean }>;
    validatePrivate(): Promise<{
      accepted: boolean;
      database: "racknerd-production";
      application: "racknerd-production-app";
      ready: boolean;
    }>;
  };
  candidate: {
    restorePostFenceArchive(input: {
      runId: string;
      fence: FenceEvidence;
    }): Promise<{
      sha256: string;
      createdAt: string;
      candidateDatabase: string;
      restored: boolean;
      freshCandidate: boolean;
      sourceFenceSignature: string;
    }>;
    validateIntegrity(database: string): Promise<{
      accepted: boolean;
      failedGates: string[];
      archiveSha256: string;
    }>;
    validateReadOnly(database: string): Promise<{
      accepted: boolean;
      writeAttemptRejected: boolean;
      writeEpochDeclared: boolean;
      readiness: string;
      applicationRole: string;
    }>;
  };
  epoch: { hasDigitalOceanWriteEpoch(): Promise<boolean> };
}

export function verifyFenceEvidence(
  fence: FenceEvidence,
  signingKey: string | Buffer,
): boolean;

export function runPreWriteCutover(options: {
  runId: string;
  signingKey: string | Buffer;
  maintenanceNetworks: readonly [string, string];
  adapters: PreWriteAdapters;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  shouldStop?: () => boolean | string;
  deadlineMs?: number;
}): Promise<
  | {
      schemaVersion: 1;
      runId: string;
      status: "ready-for-origin-switch";
      authority: "racknerd-production";
      fence: FenceEvidence;
      archive: {
        sha256: string;
        createdAt: string;
        candidateDatabase: string;
      };
      evidence: readonly unknown[];
    }
  | {
      schemaVersion: 1;
      runId: string;
      status: "recovered";
      authority: "racknerd-production";
      reason: string;
      evidence: readonly unknown[];
    }
>;
