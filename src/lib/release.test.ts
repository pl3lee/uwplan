import { getReleaseIdentity } from "./release";
import { writeApplicationError } from "./structured-log";

describe("release identity", () => {
  it("accepts an immutable digest and safe source revision", () => {
    expect(
      getReleaseIdentity({
        RELEASE_DIGEST: `sha256:${"a".repeat(64)}`,
        RELEASE_REVISION: "0123456789abcdef",
      }),
    ).toEqual({
      digest: `sha256:${"a".repeat(64)}`,
      revision: "0123456789abcdef",
      valid: true,
    });
  });

  it("replaces malformed identity fields instead of emitting them", () => {
    const digestSentinel = "database-password-in-digest";
    const revisionSentinel = "token in revision";
    const identity = getReleaseIdentity({
      RELEASE_DIGEST: digestSentinel,
      RELEASE_REVISION: revisionSentinel,
    });

    expect(identity).toEqual({
      digest: "unavailable",
      revision: "unknown",
      valid: false,
    });
    expect(JSON.stringify(identity)).not.toContain(digestSentinel);
    expect(JSON.stringify(identity)).not.toContain(revisionSentinel);
  });
});

describe("structured application output", () => {
  it("records error category without serializing error contents", () => {
    const secret = "postgresql://user:sensitive-password@database/uwplan";
    const output = jest.spyOn(console, "error").mockImplementation();

    writeApplicationError("test.failure", new Error(secret));

    expect(output).toHaveBeenCalledTimes(1);
    const serialized = String(output.mock.calls[0]?.[0]);
    expect(JSON.parse(serialized)).toEqual(
      expect.objectContaining({
        severity: "error",
        event: "test.failure",
        error_type: "Error",
      }),
    );
    expect(serialized).not.toContain(secret);
    output.mockRestore();
  });
});
