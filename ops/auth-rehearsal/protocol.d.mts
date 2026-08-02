export interface RehearsalConfiguration {
  schemaVersion: 1;
  runId: string;
  publicUrl: string;
  databaseUrl: string;
  database: string;
  databaseRole: "uwplan_app";
  basicUser: string;
  basicPassword: string;
  identities: Record<string, { email: string; marker?: string; provider: string }>;
}

export function sha256(value: string): string;
export function readProtectedEnvironment(path: string): Record<string, string>;
export function validateRehearsalConfiguration(
  rehearsalEnvironment: Record<string, string>,
  operatorEnvironment: Record<string, string>,
): RehearsalConfiguration;
export function validateRehearsalEvidence(
  configuration: RehearsalConfiguration,
  snapshot: unknown,
  attestation: unknown,
): Record<string, unknown>;
