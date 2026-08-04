#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import postgres from "postgres";
import {
  ROW_DIGEST_CONTRACT,
  digestCanonicalRowBatches,
} from "../ops/database/row-digest.mjs";

const image =
  "docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55";
const container = `uwplan-row-digest-${process.pid}-${Date.now()}`;
const password = "row-digest-fixture-only";

function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `docker ${args[0]} failed`);
  }
  return result.stdout;
}

function canonicalQuery(table) {
  return `
    SELECT replace(
      encode(convert_to(row_to_json(row_data)::text, 'UTF8'), 'base64'),
      E'\\n',
      ''
    ) AS "canonicalRow"
    FROM ${table} AS row_data
    ORDER BY row_to_json(row_data)::text COLLATE "C"
  `;
}

async function waitForPostgres(connectionUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = postgres(connectionUrl, { max: 1, prepare: false });
    try {
      await probe.unsafe("SELECT 1");
      return probe;
    } catch {
      await probe.end({ timeout: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("row digest PostgreSQL TCP fixture did not become ready");
}

function copyDigest(table) {
  const sql = `
    SET TIME ZONE 'UTC';
    SET DateStyle = 'ISO, YMD';
    SET bytea_output = 'hex';
    SET extra_float_digits = 3;
    COPY (${canonicalQuery(table)}) TO STDOUT;
  `;
  const output = docker(
    "exec",
    "--env",
    `PGPASSWORD=${password}`,
    container,
    "psql",
    "--host",
    "127.0.0.1",
    "--username",
    "postgres",
    "--dbname",
    "fixture",
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    sql,
  );
  return createHash("sha256").update(output, "ascii").digest("hex");
}

let sql;
try {
  docker(
    "run",
    "--detach",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_DB=fixture",
    "--env",
    "POSTGRES_USER=postgres",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    image,
  );
  const portOutput = docker("port", container, "5432/tcp").trim();
  const port = Number(portOutput.match(/:([0-9]+)$/)?.[1]);
  assert.ok(Number.isSafeInteger(port) && port > 0);
  const connectionUrl =
    `postgresql://postgres:${password}@127.0.0.1:${port}/fixture`;
  sql = await waitForPostgres(connectionUrl);
  await sql.unsafe(`
    CREATE TABLE digest_fixture (
      ordinal integer,
      text_value text,
      binary_value bytea,
      numeric_value numeric,
      happened_at timestamptz
    );
    CREATE TABLE digest_empty (value text);
    INSERT INTO digest_fixture VALUES
      (7, NULL, decode('00ff5c', 'hex'), 1.2300, '2024-03-10 01:59:59.123456-05'),
      (2, E'quote" slash\\\\ newline\\n snowman ☃ emoji 😀', NULL, -0.000, NULL),
      (2, E'quote" slash\\\\ newline\\n snowman ☃ emoji 😀', NULL, -0.000, NULL),
      (10, 'é', decode('', 'hex'), 12345678901234567890.0001, '2024-11-03 01:30:00-04');
  `);

  for (const [table, expectedCount] of [
    ["digest_fixture", 4],
    ["digest_empty", 0],
  ]) {
    const cursorDigest = await sql.begin(
      "isolation level repeatable read read only",
      async (transaction) => {
        await transaction.unsafe(`
          SET LOCAL TIME ZONE 'UTC';
          SET LOCAL DateStyle = 'ISO, YMD';
          SET LOCAL bytea_output = 'hex';
          SET LOCAL extra_float_digits = 3;
        `);
        return digestCanonicalRowBatches(
          transaction.unsafe(canonicalQuery(table)).cursor(1),
        );
      },
    );
    assert.equal(cursorDigest.count, expectedCount);
    assert.equal(cursorDigest.sha256, copyDigest(table));
  }
  assert.deepEqual(ROW_DIGEST_CONTRACT, {
    algorithm: "sha256",
    canonicalization: "postgres-row-json-utf8-base64-lines-v1",
  });
  process.stdout.write("PostgreSQL COPY and Node cursor row digest parity passed\n");
} finally {
  if (sql) await sql.end({ timeout: 2 });
  spawnSync("docker", ["rm", "--force", container], { encoding: "utf8" });
}
