import { registerOTel } from "@vercel/otel";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import type { Instrumentation } from "next";

import { getReleaseIdentity } from "@/lib/release";
import { safeErrorType, writeStructuredLog } from "@/lib/structured-log";

export function register() {
  const release = getReleaseIdentity();
  const metricsEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  const metricExportInterval = Number(
    process.env.OTEL_METRIC_EXPORT_INTERVAL ?? "60000",
  );
  const metricReaders =
    metricsEndpoint &&
    Number.isSafeInteger(metricExportInterval) &&
    metricExportInterval > 0
      ? [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({ url: metricsEndpoint }),
            exportIntervalMillis: metricExportInterval,
          }),
        ]
      : [];
  registerOTel({
    serviceName: "uwplan",
    attributes: {
      "service.version": release.digest,
      "vcs.ref.head.revision": release.revision,
    },
    metricReaders,
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
