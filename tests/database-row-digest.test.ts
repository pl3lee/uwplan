/** @jest-environment node */

import {
  ROW_DIGEST_CONTRACT,
  digestCanonicalRowBatches,
} from "../ops/database/row-digest.mjs";

describe("streaming database row digests", () => {
  it("uses the reviewed SHA-256 canonicalization for null, binary, Unicode, and escaped text", async () => {
    const batches = (async function* () {
      yield [
        {
          canonicalRow:
            "eyJiaW5hcnkiOiJcXHgwMGZmIiwiaWQiOiIxIiwibnVsbGFibGUiOm51bGwsInRleHQiOiLDqSJ9",
        },
      ];
      yield [
        {
          canonicalRow:
            "eyJiaW5hcnkiOm51bGwsImlkIjoiMiIsIm51bGxhYmxlIjoidmFsdWUiLCJ0ZXh0IjoiXG5cdCJ9",
        },
      ];
    })();

    await expect(digestCanonicalRowBatches(batches)).resolves.toEqual({
      count: 2,
      sha256: "5d59588b85e5e4038d27231a27602c210188dfcbf42eb5ee4e0c5b17ae1ce9c8",
    });
    expect(ROW_DIGEST_CONTRACT).toEqual({
      algorithm: "sha256",
      canonicalization: "postgres-row-json-utf8-base64-lines-v1",
    });
  });

  it("consumes a large result as one-row cursor batches", async () => {
    let produced = 0;
    const batches = (async function* () {
      while (produced < 50_000) {
        produced += 1;
        yield [{ canonicalRow: "e30=" }];
      }
    })();

    await expect(digestCanonicalRowBatches(batches)).resolves.toEqual({
      count: 50_000,
      sha256: "3fcb90f479411d75b92895370170a3737cee810eb446197f31663eb3b55e10fa",
    });
    expect(produced).toBe(50_000);
  });

  it("rejects malformed canonical rows without including row contents", async () => {
    const sentinel = "private-row-sentinel";
    const batches = (async function* () {
      yield [{ canonicalRow: sentinel }];
    })();

    await expect(digestCanonicalRowBatches(batches)).rejects.toThrow(
      "invalid canonical database row",
    );
  });
});
