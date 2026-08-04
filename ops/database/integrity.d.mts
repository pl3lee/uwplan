export type IntegrityManifest = {
  schemaVersion: 1;
  runId: string;
  utilityImage: string;
  utilityVersionNum: string;
  rowDigest: {
    algorithm: "sha256";
    canonicalization: "postgres-row-json-utf8-base64-lines-v1";
  };
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
export function preservedStateFromIntegrity(manifest: unknown): {
  rowDigest: IntegrityManifest["rowDigest"];
  preservedCounts: Record<"user" | "plan" | "schedule", number>;
  preservedDigests: Record<"user" | "plan" | "schedule", string>;
};
