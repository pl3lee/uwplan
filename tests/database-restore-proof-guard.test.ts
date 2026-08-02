/** @jest-environment node */

import {
  authorizeCandidateRestoreProof,
  resolveCandidateRestoreProofConfiguration,
} from "../src/server/candidate-restore-proof";

const runId = "20260802T203000000Z";
const token = "a".repeat(64);
const candidateUrl = `postgresql://uwplan_app:secret@db:5432/uwplan_candidate_${runId}`;

function environment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    UWPLAN_RESTORE_PROOF_ENABLED: "true",
    UWPLAN_RESTORE_PROOF_TOKEN: token,
    UWPLAN_DEPLOYMENT_ENVIRONMENT: "candidate",
    DATABASE_URL: candidateUrl,
    ...overrides,
  };
}

describe("candidate restore proof boundary", () => {
  it("is absent by default", () => {
    expect(
      resolveCandidateRestoreProofConfiguration({ NODE_ENV: "test" }),
    ).toBeNull();
  });

  it("is absent for a serving database even when toggles are copied", () => {
    expect(
      resolveCandidateRestoreProofConfiguration(
        environment({
          DATABASE_URL: "postgresql://uwplan_app:secret@db:5432/uwplan",
        }),
      ),
    ).toBeNull();
  });

  it("is absent outside the candidate deployment environment", () => {
    expect(
      resolveCandidateRestoreProofConfiguration(
        environment({ UWPLAN_DEPLOYMENT_ENVIRONMENT: "production" }),
      ),
    ).toBeNull();
  });

  it("requires the application role and a strong host-generated token", () => {
    expect(
      resolveCandidateRestoreProofConfiguration(
        environment({
          DATABASE_URL: candidateUrl.replace("uwplan_app", "postgres"),
        }),
      ),
    ).toBeNull();
    expect(
      resolveCandidateRestoreProofConfiguration(
        environment({ UWPLAN_RESTORE_PROOF_TOKEN: "short" }),
      ),
    ).toBeNull();
  });

  it("authorizes only the exact bearer token", () => {
    const configured = resolveCandidateRestoreProofConfiguration(environment());
    expect(configured).toEqual({
      token,
      database: `uwplan_candidate_${runId}`,
    });
    expect(
      authorizeCandidateRestoreProof(
        new Request("http://candidate.invalid", {
          headers: { authorization: `Bearer ${token}` },
        }),
        token,
      ),
    ).toBe(true);
    expect(
      authorizeCandidateRestoreProof(
        new Request("http://candidate.invalid", {
          headers: { authorization: "Bearer wrong" },
        }),
        token,
      ),
    ).toBe(false);
  });
});
