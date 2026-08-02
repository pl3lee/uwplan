/** @jest-environment node */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const checker = join(
  process.cwd(),
  "ops/deploy/check-migration-compatibility.mjs",
);

function runChecker(directory: string, manifest: string) {
  return spawnSync(process.execPath, [checker, directory, manifest], {
    encoding: "utf8",
  });
}

function runSqlFixture(sql: string) {
  const root = mkdtempSync(join(tmpdir(), "uwplan-migration-gate-"));
  const migrations = join(root, "drizzle");
  const migrationName = "0010_review_fixture.sql";
  const manifestPath = join(root, "migration-compatibility.json");
  mkdirSync(migrations);
  writeFileSync(join(migrations, migrationName), sql);
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      migrations: {
        [migrationName]: {
          kind: "expand-only",
          sha256: createHash("sha256").update(sql).digest("hex"),
        },
      },
    }),
  );
  return {
    result: runChecker(migrations, manifestPath),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("release migration compatibility gate", () => {
  it("admits the schema-forward/image-backward expand fixture", () => {
    const fixture = join(process.cwd(), "tests/fixtures/deploy/expand");

    const result = runChecker(
      fixture,
      join(fixture, "migration-compatibility.json"),
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "accepted",
      migrationCount: 1,
      contract: "expand-only",
    });
  });

  it.each([
    [
      'ALTER TABLE "plan" ADD COLUMN "note" text; DROP TABLE "plan";\n',
      "a destructive second statement in one Drizzle chunk",
    ],
    [
      'ALTER TABLE "plan" ADD COLUMN "note" text; -- an ignored comment\nDROP TABLE "plan";\n',
      "a destructive statement after a line comment",
    ],
    ['DROP TABLE "plan";\n', "destructive SQL"],
    [
      'ALTER TABLE "plan" ADD COLUMN "required_value" text NOT NULL;\n',
      "non-expand required column",
    ],
    [
      "DO $migration$ BEGIN EXECUTE 'DROP TABLE \"plan\"'; END $migration$;\n",
      "a dollar-quoted procedural body",
    ],
    [
      'WITH removed AS (DELETE FROM "plan" RETURNING id) SELECT * FROM removed;\n',
      "a destructive CTE",
    ],
  ])("fails closed for %s outside the supported contract", (sql) => {
    const fixture = runSqlFixture(sql);

    try {
      const { result } = fixture;

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({
        status: "rejected",
        contract: "expand-only",
      });
    } finally {
      fixture.cleanup();
    }
  });

  it.each([
    [
      '/* semicolon ; and DROP are comments */\nALTER TABLE "plan" ADD COLUMN "comment_safe" text; -- DROP TABLE "plan";\n',
      "line and block comments",
    ],
    [
      'ALTER TABLE "plan" ADD COLUMN "quoted_semicolon" text DEFAULT \'still; one statement\';\n',
      "a semicolon inside a quoted literal",
    ],
    [
      'ALTER TABLE "plan" ADD COLUMN "odd;identifier" text;\n',
      "a semicolon inside a quoted identifier",
    ],
  ])("admits an expand-only statement containing %s", (sql) => {
    const fixture = runSqlFixture(sql);
    try {
      expect(fixture.result.status).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });
});
