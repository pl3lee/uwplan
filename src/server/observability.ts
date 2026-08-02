import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
} from "@opentelemetry/api";

import { getReleaseIdentity } from "@/lib/release";
import { safeErrorType, writeStructuredLog } from "@/lib/structured-log";
import { isValidationId } from "@/lib/validation-id";

const tracer = trace.getTracer("uwplan");
const meter = metrics.getMeter("uwplan");
const healthRequests = meter.createCounter("uwplan.health.requests", {
  description: "UWPlan health endpoint requests",
});
const healthLatency = meter.createHistogram("uwplan.health.duration", {
  description: "UWPlan health endpoint response latency",
  unit: "ms",
});
export function readValidationId(request: Request) {
  const candidate = request.headers.get("x-uwplan-validation-id") ?? "";
  return isValidationId(candidate) ? candidate : undefined;
}

export async function traceHealthRequest<T>(
  route: "/api/live" | "/api/ready",
  validationId: string | undefined,
  operation: () => Promise<T> | T,
) {
  const release = getReleaseIdentity();
  const attributes: Attributes = {
    "http.request.method": "GET",
    "http.route": route,
    "service.version": release.digest,
    "vcs.ref.head.revision": release.revision,
    ...(validationId ? { "uwplan.validation.id": validationId } : {}),
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
  validationId?: string,
  startedAt = performance.now(),
) {
  const release = getReleaseIdentity();
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  const metricAttributes = {
    "http.route": route,
    "http.response.status_code": statusCode,
    "service.version": release.digest,
  };
  healthRequests.add(1, metricAttributes);
  healthLatency.record(
    Math.max(0, performance.now() - startedAt),
    metricAttributes,
  );
  writeStructuredLog("info", "health.request", {
    route,
    status_code: statusCode,
    ...(database ? { database } : {}),
    ...(validationId ? { validation_id: validationId } : {}),
    ...(traceId ? { trace_id: traceId } : {}),
  });
}
