/** @jest-environment node */

import { compareIntegrity } from "../ops/database/integrity.mjs";

const utilityImage =
  "docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55";

type MutableIntegrityFixture = {
  database: Record<string, string | null>;
  schemaSha256: string;
  extensions: Array<Record<string, string>>;
  tablespaces: string[];
  ledger: { count: number };
  tables: Array<{ count: number }>;
  sequences: Array<{ isCalled: boolean }>;
  unvalidatedConstraints: string[];
  invalidIndexes: string[];
  ownershipViolations: string[];
  appRole: Record<string, boolean>;
};

function manifest(serverVersionNum = "160014") {
  return {
    schemaVersion: 1,
    runId: "20260802T193000000Z",
    utilityImage,
    utilityVersionNum: "160014",
    rowDigest: {
      algorithm: "sha256",
      canonicalization: "postgres-row-json-utf8-base64-lines-v1",
    },
    database: {
      serverVersionNum,
      encoding: "UTF8",
      collation: "C",
      ctype: "C",
      localeProvider: "c",
      icuLocale: null,
      localeVersion: null,
      defaultTablespace: "pg_default",
    },
    schemaSha256: "a".repeat(64),
    extensions: [
      { name: "plpgsql", version: "1.0", schemaIdentity: "cGdfY2F0YWxvZw==" },
    ],
    tablespaces: [],
    ledger: { count: 10, maxId: 10, sha256: "b".repeat(64) },
    tables: [
      {
        schemaIdentity: "cHVibGlj",
        nameIdentity: "dXNlcg==",
        count: 1,
        sha256: "c".repeat(64),
      },
    ],
    sequences: [
      {
        schemaIdentity: "ZHJpenpsZQ==",
        nameIdentity: "X19kcml6emxlX21pZ3JhdGlvbnNfaWRfc2Vx",
        definitionSha256: "d".repeat(64),
        lastValue: "10",
        isCalled: true,
      },
    ],
    unvalidatedConstraints: [],
    invalidIndexes: [],
    ownershipViolations: [],
    appRole: {
      login: true,
      superuser: false,
      createdb: false,
      createrole: false,
      replication: false,
      bypassRls: false,
    },
  };
}

const integrityMismatchCases: Array<
  [string, (value: MutableIntegrityFixture) => void]
> = [
  [
    "locale",
    (value) => {
      value.database.collation = "en_US.UTF-8";
    },
  ],
  [
    "extensions",
    (value) => {
      value.extensions.push({
        name: "pgcrypto",
        version: "1.3",
        schemaIdentity: "cHVibGlj",
      });
    },
  ],
  [
    "tablespaces",
    (value) => {
      value.tablespaces.push("dGVzdA==");
    },
  ],
  [
    "schema",
    (value) => {
      value.schemaSha256 = "e".repeat(64);
    },
  ],
  [
    "ledger",
    (value) => {
      value.ledger.count++;
    },
  ],
  [
    "tables",
    (value) => {
      value.tables[0]!.count++;
    },
  ],
  [
    "sequences",
    (value) => {
      value.sequences[0]!.isCalled = false;
    },
  ],
  [
    "constraints",
    (value) => {
      value.unvalidatedConstraints.push("Y29uc3RyYWludA==");
    },
  ],
  [
    "indexes",
    (value) => {
      value.invalidIndexes.push("aW5kZXg=");
    },
  ],
  [
    "ownership",
    (value) => {
      value.ownershipViolations.push("b3duZXI=");
    },
  ],
  [
    "application-role",
    (value) => {
      value.appRole.superuser = true;
    },
  ],
];

describe("production database integrity gates", () => {
  it("accepts a PostgreSQL 16.6 source restored to the pinned 16.14 target", () => {
    const source = manifest("160006");
    const candidate = manifest("160014");
    expect(compareIntegrity(source, candidate)).toEqual({
      status: "accepted",
      failedGates: [],
    });
  });

  it.each([
    ["an older target patch", "160006", "160013"],
    ["a PostgreSQL 17 source", "170000", "160014"],
    ["a PostgreSQL 17 target", "160006", "170000"],
    ["a source newer than the utility", "160015", "160014"],
  ])("rejects %s", (_scenario, sourceVersion, targetVersion) => {
    const result = compareIntegrity(
      manifest(sourceVersion),
      manifest(targetVersion),
    );
    expect(result.status).toBe("rejected");
    expect(result.failedGates).toContain("version");
  });

  it.each(integrityMismatchCases)("rejects the %s mismatch", (gate, mutate) => {
    const source = manifest();
    const candidate = structuredClone(source);
    mutate(candidate);
    const result = compareIntegrity(source, candidate);
    expect(result.status).toBe("rejected");
    expect(result.failedGates).toContain(gate);
  });

  it("rejects malformed evidence without echoing row material", () => {
    const result = compareIntegrity(manifest(), {
      row: "sentinel-private-row-value",
    });
    expect(result).toEqual({ status: "rejected", failedGates: ["manifest"] });
    expect(JSON.stringify(result)).not.toContain("sentinel-private-row-value");
  });

  it("rejects pre-streaming manifests without the row digest contract", () => {
    const source = manifest("160006");
    const candidate = manifest("160014");
    delete (source as Partial<typeof source>).rowDigest;

    expect(compareIntegrity(source, candidate)).toEqual({
      status: "rejected",
      failedGates: ["manifest"],
    });
  });
});
