export interface ReleaseEnvironment {
  readonly RELEASE_DIGEST?: string;
  readonly RELEASE_REVISION?: string;
}

export interface ReleaseIdentity {
  readonly digest: string;
  readonly revision: string;
  readonly valid: boolean;
}

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[a-zA-Z0-9._-]{1,128}$/;

export function getReleaseIdentity(
  environment: ReleaseEnvironment = {
    RELEASE_DIGEST: process.env.RELEASE_DIGEST,
    RELEASE_REVISION: process.env.RELEASE_REVISION,
  },
): ReleaseIdentity {
  const digest = environment.RELEASE_DIGEST ?? "";
  const revision = environment.RELEASE_REVISION ?? "";
  const digestValid = digestPattern.test(digest);
  const revisionValid = revisionPattern.test(revision);

  return {
    digest: digestValid ? digest : "unavailable",
    revision: revisionValid ? revision : "unknown",
    valid: digestValid && revisionValid,
  };
}
