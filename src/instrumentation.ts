import { registerOTel } from "@vercel/otel";
import type { Instrumentation } from "next";

import { getReleaseIdentity } from "@/lib/release";
import { safeErrorType, writeStructuredLog } from "@/lib/structured-log";

export function register() {
  const release = getReleaseIdentity();
  registerOTel({
    serviceName: "uwplan",
    attributes: {
      "service.version": release.digest,
      "vcs.ref.head.revision": release.revision,
    },
  });
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  writeStructuredLog("error", "http.request.error", {
    error_type: safeErrorType(error),
    method: request.method,
    route: context.routePath,
  });
};
