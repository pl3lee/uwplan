/** @jest-environment node */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("production-copy streaming digest contract", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");

  it("hashes full-integrity rows as canonical base64 lines through COPY", () => {
    const source = read("ops/database/integrity.sh");

    expect(source).toContain("postgres-row-json-utf8-base64-lines-v1");
    expect(source).toMatch(/COPY \([\s\S]*encode\(convert_to\([\s\S]*'base64'\)[\s\S]*TO STDOUT/);
    expect(source).toContain("| sha256sum");
    expect(source).not.toMatch(/\bmd5\s*\(/i);
    expect(source).not.toMatch(/\bstring_agg\s*\(/i);
  });

  it("uses one-row cursors for the prepared-candidate parity check", () => {
    const source = read("ops/auth-rehearsal/snapshot.mjs");

    expect(source).toContain("digestCanonicalRowBatches");
    expect(source).toContain(".cursor(1)");
    expect(source).toContain("ROW_DIGEST_CONTRACT");
    expect(source).not.toMatch(/\bmd5\s*\(/i);
    expect(source).not.toMatch(/\bstring_agg\s*\(/i);
  });

  it("does not aggregate preserved tables inside the host command", () => {
    const source = read("ops/database/host-command.mjs");

    expect(source).not.toMatch(/\bmd5\s*\(/i);
    expect(source).not.toMatch(/\bstring_agg\s*\(/i);
    expect(source).toContain("preservedStateFromIntegrity");
  });
});
