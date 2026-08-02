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

function manifest() {
  return {
    schemaVersion: 1,
    runId: "20260802T193000000Z",
    utilityImage,
    utilityVersionNum: "160014",
    database: {
      serverVersionNum: "160014",
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
    "version",
    (value) => {
      value.database.serverVersionNum = "160013";
    },
  ],
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
  it("accepts only an exact, valid candidate", () => {
    const source = manifest();
    const candidate = structuredClone(source);
    expect(compareIntegrity(source, candidate)).toEqual({
      status: "accepted",
      failedGates: [],
    });
  });

  it.each(integrityMismatchCases)("rejects the %s mismatch", (gate, mutate) => {
    const source = manifest();
    const candidate = structuredClone(source);
    mutate(candidate);
    expect(compareIntegrity(source, candidate)).toEqual(
      expect.objectContaining({
        status: "rejected",
        failedGates: expect.arrayContaining([gate]),
      }),
    );
  });

  it("rejects malformed evidence without echoing row material", () => {
    const result = compareIntegrity(manifest(), {
      row: "sentinel-private-row-value",
    });
    expect(result).toEqual({ status: "rejected", failedGates: ["manifest"] });
    expect(JSON.stringify(result)).not.toContain("sentinel-private-row-value");
  });
});
