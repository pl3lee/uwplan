export interface RehearsalConfiguration {
  schemaVersion: 1;
  runId: string;
  publicUrl: string;
  databaseUrl: string;
  database: string;
  databaseRole: "uwplan_app";
  basicUser: string;
  basicPassword: string;
  identities: Record<
    string,
    { email: string; marker?: string; provider: string }
  >;
  authScrub: Record<string, unknown>;
}

export const AUTH_SCRUB_PROCEDURE_VERSION: "auth-artifact-scrub-v2";
export function sha256(value: string): string;
export function fileSha256(path: string): string;
export function readProtectedEnvironment(path: string): Record<string, string>;
export function readProtectedJson(
  path: string,
  description?: string,
): Record<string, unknown>;
export function validateAuthScrubMarker(input: {
  runId: string;
  candidateDatabase: string;
  markerPath: string;
  integrityPath: string;
}): Record<string, unknown>;
export function validatePreparedCandidateSnapshot(
  marker: Record<string, any>,
  snapshot: unknown,
): void;
export function validateRehearsalStartMarker(input: {
  configuration: RehearsalConfiguration;
  operatorEnvironment: Record<string, string>;
  runtimeEnvironmentPath: string;
  releaseEnvironmentPath: string;
  composeFilePath: string;
  containerId: string;
  imageId: string;
  startedAt: string;
  restartCount: number;
}): Record<string, unknown>;
export function validateRehearsalConfiguration(
  rehearsalEnvironment: Record<string, string>,
  operatorEnvironment: Record<string, string>,
): RehearsalConfiguration;
export function validateRehearsalEvidence(
  configuration: RehearsalConfiguration,
  snapshot: unknown,
  attestation: unknown,
): Record<string, unknown>;
