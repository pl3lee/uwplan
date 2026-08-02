import { createHash, timingSafeEqual } from "node:crypto";

const candidatePattern = /^uwplan_candidate_[0-9]{8}T[0-9]{9}Z$/;

export function resolveCandidateRestoreProofConfiguration(
  environment: NodeJS.ProcessEnv,
) {
  if (
    environment.UWPLAN_RESTORE_PROOF_ENABLED !== "true" ||
    environment.UWPLAN_DEPLOYMENT_ENVIRONMENT !== "candidate"
  ) {
    return null;
  }
  const token = environment.UWPLAN_RESTORE_PROOF_TOKEN ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  try {
    const url = new URL(environment.DATABASE_URL ?? "");
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (
      url.protocol !== "postgresql:" ||
      decodeURIComponent(url.username) !== "uwplan_app" ||
      !candidatePattern.test(database)
    ) {
      return null;
    }
    return { token, database };
  } catch {
    return null;
  }
}

export function authorizeCandidateRestoreProof(
  request: Request,
  token: string,
) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function candidateRestoreProofIdentity(proofRunId: string) {
  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest("hex");
  const userId = `restore-proof-${proofRunId}`;
  const email = `${digest(`email:${proofRunId}`).slice(0, 24)}@example.invalid`;
  const scheduleName = `restore-proof-${proofRunId}`;
  return {
    userId,
    email,
    scheduleName,
    proofSha256: digest(
      ["uwplan-restore-proof-v1", proofRunId, userId, scheduleName].join(":"),
    ),
  };
}
