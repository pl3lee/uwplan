import { createHash } from "node:crypto";

export const ROW_DIGEST_CONTRACT = Object.freeze({
  algorithm: "sha256",
  canonicalization: "postgres-row-json-utf8-base64-lines-v1",
});

const canonicalRowPattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export async function digestCanonicalRowBatches(batches) {
  const hash = createHash("sha256");
  let count = 0;
  for await (const batch of batches) {
    if (!Array.isArray(batch)) {
      throw new Error("invalid canonical database row batch");
    }
    for (const row of batch) {
      const canonicalRow = row?.canonicalRow;
      if (
        typeof canonicalRow !== "string" ||
        canonicalRow.length === 0 ||
        canonicalRow.length % 4 !== 0 ||
        !canonicalRowPattern.test(canonicalRow)
      ) {
        throw new Error("invalid canonical database row");
      }
      hash.update(canonicalRow, "ascii");
      hash.update("\n", "ascii");
      count += 1;
    }
  }
  return { count, sha256: hash.digest("hex") };
}
