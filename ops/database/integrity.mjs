import {
  POSTGRES_MAJOR_VERSION,
  POSTGRES_UTILITY_IMAGE,
  POSTGRES_UTILITY_VERSION_NUM,
} from "./protocol.mjs";

const sha256Pattern = /^[0-9a-f]{64}$/;
const versionPattern = /^[0-9]{6}$/;

const canonical = (value) => JSON.stringify(value);
const same = (left, right) => canonical(left) === canonical(right);

function isHash(value) {
  return typeof value === "string" && sha256Pattern.test(value);
}

function isArray(value) {
  return Array.isArray(value);
}

export function isIntegrityManifest(value) {
  return Boolean(
    value &&
      value.schemaVersion === 1 &&
      typeof value.runId === "string" &&
      value.utilityImage === POSTGRES_UTILITY_IMAGE &&
      value.utilityVersionNum === POSTGRES_UTILITY_VERSION_NUM &&
      typeof value.database?.serverVersionNum === "string" &&
      versionPattern.test(value.database.serverVersionNum) &&
      typeof value.database?.encoding === "string" &&
      typeof value.database?.collation === "string" &&
      typeof value.database?.ctype === "string" &&
      typeof value.database?.localeProvider === "string" &&
      typeof value.database?.defaultTablespace === "string" &&
      isHash(value.schemaSha256) &&
      isHash(value.ledger?.sha256) &&
      Number.isSafeInteger(value.ledger?.count) &&
      (value.ledger?.maxId === null ||
        Number.isSafeInteger(value.ledger?.maxId)) &&
      isArray(value.extensions) &&
      isArray(value.tablespaces) &&
      isArray(value.tables) &&
      value.tables.every(
        (table) =>
          typeof table.schemaIdentity === "string" &&
          typeof table.nameIdentity === "string" &&
          Number.isSafeInteger(table.count) &&
          isHash(table.sha256),
      ) &&
      isArray(value.sequences) &&
      value.sequences.every(
        (sequence) =>
          typeof sequence.schemaIdentity === "string" &&
          typeof sequence.nameIdentity === "string" &&
          isHash(sequence.definitionSha256) &&
          (sequence.lastValue === null ||
            typeof sequence.lastValue === "string") &&
          typeof sequence.isCalled === "boolean",
      ) &&
      isArray(value.unvalidatedConstraints) &&
      isArray(value.invalidIndexes) &&
      isArray(value.ownershipViolations) &&
      typeof value.appRole?.login === "boolean" &&
      typeof value.appRole?.superuser === "boolean" &&
      typeof value.appRole?.createdb === "boolean" &&
      typeof value.appRole?.createrole === "boolean" &&
      typeof value.appRole?.replication === "boolean" &&
      typeof value.appRole?.bypassRls === "boolean",
  );
}

export function compareIntegrity(source, candidate) {
  if (!isIntegrityManifest(source) || !isIntegrityManifest(candidate)) {
    return { status: "rejected", failedGates: ["manifest"] };
  }

  const failedGates = [];
  const gate = (name, accepted) => {
    if (!accepted) failedGates.push(name);
  };

  const sourceVersion = source.database.serverVersionNum;
  const candidateVersion = candidate.database.serverVersionNum;
  const sourceMajor = sourceVersion.slice(0, -4);
  const candidateMajor = candidateVersion.slice(0, -4);
  gate(
    "version",
    sourceMajor === POSTGRES_MAJOR_VERSION &&
      Number(sourceVersion) <= Number(POSTGRES_UTILITY_VERSION_NUM) &&
      candidateVersion === POSTGRES_UTILITY_VERSION_NUM &&
      sourceMajor === candidateMajor,
  );
  gate(
    "tool-image",
    source.utilityImage === candidate.utilityImage &&
      source.utilityVersionNum === candidate.utilityVersionNum,
  );
  gate(
    "locale",
    same(
      {
        encoding: source.database.encoding,
        collation: source.database.collation,
        ctype: source.database.ctype,
        localeProvider: source.database.localeProvider,
        icuLocale: source.database.icuLocale ?? null,
        localeVersion: source.database.localeVersion ?? null,
      },
      {
        encoding: candidate.database.encoding,
        collation: candidate.database.collation,
        ctype: candidate.database.ctype,
        localeProvider: candidate.database.localeProvider,
        icuLocale: candidate.database.icuLocale ?? null,
        localeVersion: candidate.database.localeVersion ?? null,
      },
    ),
  );
  gate("extensions", same(source.extensions, candidate.extensions));
  gate(
    "tablespaces",
    source.database.defaultTablespace ===
      candidate.database.defaultTablespace &&
      same(source.tablespaces, candidate.tablespaces),
  );
  gate("schema", source.schemaSha256 === candidate.schemaSha256);
  gate("ledger", same(source.ledger, candidate.ledger));
  gate("tables", same(source.tables, candidate.tables));
  gate("sequences", same(source.sequences, candidate.sequences));
  gate(
    "constraints",
    source.unvalidatedConstraints.length === 0 &&
      candidate.unvalidatedConstraints.length === 0,
  );
  gate(
    "indexes",
    source.invalidIndexes.length === 0 && candidate.invalidIndexes.length === 0,
  );
  gate("ownership", candidate.ownershipViolations.length === 0);
  gate(
    "application-role",
    same(candidate.appRole, {
      login: true,
      superuser: false,
      createdb: false,
      createrole: false,
      replication: false,
      bypassRls: false,
    }),
  );

  return {
    status: failedGates.length === 0 ? "accepted" : "rejected",
    failedGates,
  };
}
