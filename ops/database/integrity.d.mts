export type IntegrityManifest = {
  schemaVersion: 1;
  runId: string;
  utilityImage: string;
  utilityVersionNum: string;
  database: Record<string, unknown>;
  schemaSha256: string;
  extensions: unknown[];
  tablespaces: unknown[];
  ledger: Record<string, unknown>;
  tables: unknown[];
  sequences: unknown[];
  unvalidatedConstraints: unknown[];
  invalidIndexes: unknown[];
  ownershipViolations: unknown[];
  appRole: Record<string, boolean>;
};

export function isIntegrityManifest(value: unknown): value is IntegrityManifest;
export function compareIntegrity(
  source: unknown,
  candidate: unknown,
): { status: "accepted" | "rejected"; failedGates: string[] };
