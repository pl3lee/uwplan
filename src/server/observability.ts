import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

import { getReleaseIdentity } from "@/lib/release";
import { safeErrorType, writeStructuredLog } from "@/lib/structured-log";

const tracer = trace.getTracer("uwplan");

export async function traceHealthRequest<T>(
  route: "/api/live" | "/api/ready",
  operation: () => Promise<T> | T,
) {
  const release = getReleaseIdentity();
  const attributes: Attributes = {
    "http.request.method": "GET",
    "http.route": route,
    "service.version": release.digest,
    "vcs.ref.head.revision": release.revision,
  };

  return await tracer.startActiveSpan(
    "health.request",
    { attributes },
    async (span) => {
      try {
        return await operation();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException({
          name: safeErrorType(error),
          message: "redacted",
        });
        writeStructuredLog("error", "health.request.error", { route });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function writeHealthResult(
  route: "/api/live" | "/api/ready",
  statusCode: number,
  database?: "available" | "unavailable",
) {
  writeStructuredLog("info", "health.request", {
    route,
    status_code: statusCode,
    ...(database ? { database } : {}),
  });
}
