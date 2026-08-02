#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baselineHashes = Object.freeze({
  "0000_yielding_anthem.sql":
    "24fd57726da256cfe1f23ae239e4311d2651e21a10f41f00cd2434a3bdc6371c",
  "0001_conscious_khan.sql":
    "67847589a6066eac8d552fc022f7c9b165b1ebcb7a4850e0b67e4944789df6f1",
  "0002_colorful_dorian_gray.sql":
    "cfb00cb588fcbd8bacb14a63c68a7df1944e97cda181aa00c1cd2db26d871eca",
  "0003_real_champions.sql":
    "5c4cf0a6943376a2e39e2ec912b0f78d81d8ed434cd6caabafc264013bdf6962",
  "0004_stiff_blue_blade.sql":
    "1d9d226d7169d84f7ae888b46730d654ca1d6ebdf3e5b0d8d6b3b1df083ac9da",
  "0005_bright_dreadnoughts.sql":
    "073c7799a985e51f0f4c2dbe6050207d97cf391a211a3935ed5d36c97af4cbe3",
  "0006_majestic_clea.sql":
    "3bf5600ef8564abaa1e9e6bb27dcf48872db4d7b523b53e5120aa3450b4c8d9b",
  "0007_redundant_mister_fear.sql":
    "9cd7e0a06280e632131f2daee3e385cb7f78c04d1f37fca718bbcf73d02c78b0",
  "0008_purple_gressill.sql":
    "be58c70720d98cedfe4bec9a6a2bd06e34b86a31935f3046a6acea677b5681e9",
  "0009_material_gambit.sql":
    "aa4307118fe0455baf5032df42cfbc1b2d2979a4e6875d2e2e689b6cf76f96f5",
});

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function splitTopLevelStatements(sql) {
  const statements = [];
  let current = "";
  let index = 0;
  let quote = null;
  let escapeString = false;

  const finishStatement = () => {
    if (current.trim()) statements.push(current.trim());
    current = "";
  };

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];

    if (quote === "single") {
      current += character;
      if (character === "'" && next === "'") {
        current += next;
        index += 2;
        continue;
      }
      if (escapeString && character === "\\" && next !== undefined) {
        current += next;
        index += 2;
        continue;
      }
      if (character === "'") quote = null;
      index += 1;
      continue;
    }

    if (quote === "identifier") {
      current += character;
      if (character === '"' && next === '"') {
        current += next;
        index += 2;
        continue;
      }
      if (character === '"') quote = null;
      index += 1;
      continue;
    }

    if (character === "-" && next === "-") {
      const newline = sql.indexOf("\n", index + 2);
      const end = newline === -1 ? sql.length : newline;
      const comment = sql.slice(index, end).trim();
      if (/^-->\s*statement-breakpoint\s*$/.test(comment)) finishStatement();
      else current += " ";
      index = end;
      continue;
    }

    if (character === "/" && next === "*") {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === "/" && sql[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (sql[index] === "*" && sql[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) throw new Error("unterminated SQL block comment");
      current += " ";
      continue;
    }

    if (character === "$") {
      const delimiter = sql
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (delimiter) {
        throw new Error("dollar-quoted and procedural SQL is unsupported");
      }
    }

    if (character === "'") {
      const prior = current.at(-1);
      const beforePrior = current.at(-2);
      escapeString =
        (prior === "E" || prior === "e") &&
        (beforePrior === undefined || !/[A-Za-z0-9_$]/.test(beforePrior));
      quote = "single";
      current += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      quote = "identifier";
      current += character;
      index += 1;
      continue;
    }

    if (character === ";") {
      finishStatement();
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  if (quote !== null) throw new Error("unterminated SQL quote");
  finishStatement();
  return statements;
}

function expandOnlyStatement(statement) {
  const normalized = statement.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (/^CREATE TABLE(?: IF NOT EXISTS)? \S+ \([\s\S]*\)$/i.test(normalized))
    return true;
  if (
    /^CREATE (?:UNIQUE )?INDEX(?: CONCURRENTLY)?(?: IF NOT EXISTS)? \S+ ON \S+ [\s\S]+$/i.test(
      normalized,
    )
  )
    return true;
  if (
    /^ALTER TABLE \S+ ADD COLUMN(?: IF NOT EXISTS)? \S+ (?:text|varchar(?:\(\d+\))?|integer|bigint|boolean|uuid|timestamp(?: with(?:out)? time zone)?)(?: DEFAULT (?:NULL|TRUE|FALSE|-?\d+(?:\.\d+)?|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_]*(?:\(\))?))?(?: NULL)?$/i.test(
      normalized,
    )
  ) {
    return !/\bNOT NULL\b/i.test(normalized);
  }
  return false;
}

export function checkMigrationCompatibility(migrationsDirectory, manifestPath) {
  const directory = resolve(migrationsDirectory);
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    !manifest.migrations ||
    typeof manifest.migrations !== "object"
  ) {
    throw new Error("invalid migration compatibility manifest");
  }
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error("no migration SQL files found");
  const manifestFiles = Object.keys(manifest.migrations).sort();
  if (JSON.stringify(files) !== JSON.stringify(manifestFiles)) {
    throw new Error("migration SQL and compatibility manifest differ");
  }

  for (const file of files) {
    if (basename(file) !== file || !/^\d{4}_[a-z0-9_]+\.sql$/.test(file)) {
      throw new Error("invalid migration filename");
    }
    const contents = readFileSync(resolve(directory, file));
    const entry = manifest.migrations[file];
    const digest = sha256(contents);
    if (entry?.sha256 !== digest) throw new Error("migration digest mismatch");
    if (entry.kind === "baseline") {
      if (baselineHashes[file] !== digest) {
        throw new Error("unrecognized baseline migration");
      }
      continue;
    }
    if (entry.kind !== "expand-only") {
      throw new Error("unsupported migration compatibility kind");
    }
    const statements = splitTopLevelStatements(contents.toString("utf8"));
    if (!statements.every(expandOnlyStatement)) {
      throw new Error(
        "migration is outside the supported expand-only contract",
      );
    }
  }
  return { migrationCount: files.length, contract: "expand-only" };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const migrationsDirectory = process.argv[2] ?? "/app/drizzle";
    const manifestPath =
      process.argv[3] ?? "/app/ops/deploy/migration-compatibility.json";
    const result = checkMigrationCompatibility(
      migrationsDirectory,
      manifestPath,
    );
    process.stdout.write(
      `${JSON.stringify({ status: "accepted", ...result })}\n`,
    );
  } catch {
    process.stderr.write(
      `${JSON.stringify({ status: "rejected", contract: "expand-only" })}\n`,
    );
    process.exitCode = 1;
  }
}
