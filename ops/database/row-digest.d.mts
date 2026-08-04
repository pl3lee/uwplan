export const ROW_DIGEST_CONTRACT: Readonly<{
  algorithm: "sha256";
  canonicalization: "postgres-row-json-utf8-base64-lines-v1";
}>;

export function digestCanonicalRowBatches(
  batches: AsyncIterable<Array<{ canonicalRow: string }>>,
): Promise<{ count: number; sha256: string }>;
