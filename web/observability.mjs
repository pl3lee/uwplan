import { randomUUID } from "node:crypto";
import {
  context,
  DiagLogLevel,
  diag,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const service = "uwplan-web";
const validationPattern = /^validation-[a-f0-9-]{36}$/;
const routes = new Set([
  "/",
  "/privacy",
  "/signin",
  "/select",
  "/schedule",
  "/create/template",
  "/manage/template",
  "/admin",
]);
const severities = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function release() {
  return {
    release_digest: /^sha256:[a-f0-9]{64}$/.test(
      process.env.RELEASE_DIGEST ?? "",
    )
      ? process.env.RELEASE_DIGEST
      : "unavailable",
    release_revision: /^[a-zA-Z0-9._-]{1,128}$/.test(
      process.env.RELEASE_REVISION ?? "",
    )
      ? process.env.RELEASE_REVISION
      : "unknown",
  };
}

function localLog(level, event, attributes = {}) {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    service,
    ...release(),
    level,
    event,
    ...attributes,
  });
  if (level === "error") console.error(output);
  else console.log(output);
}

export function logEvent(level, event, attributes = {}) {
  localLog(level, event, attributes);
  if (process.env.OTEL_ENABLED === "true") {
    logs.getLogger(service).emit({
      body: event,
      severityNumber: severities[level],
      severityText: level.toUpperCase(),
      context: context.active(),
      attributes: { service, ...release(), event, ...attributes },
    });
  }
}

export function setupObservability() {
  if (process.env.OTEL_ENABLED !== "true") return async () => {};
  // Exporter diagnostics may contain endpoint credentials. Keep only a fixed
  // local event, and never route exporter errors back through the exporter.
  const ignore = () => {};
  const diagnosticLogger = {
    error: () => localLog("error", "telemetry.export.failed"),
    warn: ignore,
    info: ignore,
    debug: ignore,
    verbose: ignore,
  };
  const diagnosticOptions = {
    logLevel: DiagLogLevel.ERROR,
    suppressOverrideMessage: true,
  };
  diag.setLogger(diagnosticLogger, diagnosticOptions);
  const identity = release();
  const batch = {
    maxQueueSize: 512,
    maxExportBatchSize: 128,
    scheduledDelayMillis: 1000,
    exportTimeoutMillis: 2000,
  };
  const sdk = new NodeSDK({
    autoDetectResources: false,
    metricReaders: [],
    resource: resourceFromAttributes({
      "service.name": service,
      "service.version": identity.release_digest,
      "vcs.ref.head.revision": identity.release_revision,
    }),
    textMapPropagator: new W3CTraceContextPropagator(),
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({ timeoutMillis: 2000 }),
        batch,
      ),
    ],
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ timeoutMillis: 2000 }),
        batch,
      ),
    ],
  });
  // NodeSDK honors OTEL_LOG_LEVEL by replacing the global diagnostic logger.
  // Restore redaction before starting any background exports.
  diag.setLogger(diagnosticLogger, diagnosticOptions);
  sdk.start();
  let stopping;
  return () => {
    stopping ??= sdk
      .shutdown()
      .catch(() => localLog("error", "telemetry.shutdown.failed"));
    return stopping;
  };
}

export function injectTraceHeaders(headers, request) {
  propagation.inject(context.active(), headers);
  const validation = request.headers.get("X-UWPlan-Validation-ID") ?? "";
  if (validationPattern.test(validation))
    headers["X-UWPlan-Validation-ID"] = validation;
}

export function requestTelemetry(req, res, next) {
  if (req.path === "/api/ready") {
    const identity = release();
    res.setHeader("X-UWPlan-Web-Release-Digest", identity.release_digest);
    res.setHeader("X-UWPlan-Web-Release-Revision", identity.release_revision);
  }
  const parent = propagation.extract(context.active(), req.headers);
  const path = req.path;
  const route = routes.has(path)
    ? path
    : path.startsWith("/api/")
      ? "/api/*"
      : path.startsWith("/assets/")
        ? "/assets/*"
        : "unmatched";
  const method = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ].includes(req.method)
    ? req.method
    : "OTHER";
  const span = trace
    .getTracer(service)
    .startSpan(`${method} ${route}`, { kind: SpanKind.SERVER }, parent);
  const requestContext = trace.setSpan(parent, span);
  context.with(requestContext, () => {
    const requestId = randomUUID();
    const started = performance.now();
    res.setHeader("X-Request-ID", requestId);
    let finished = false;
    const finish = (status) => {
      if (finished) return;
      finished = true;
      context.with(requestContext, () => {
        const attributes = {
          "http.route": route,
          "http.request.method": method,
          "http.response.status_code": status,
        };
        span.setAttributes(attributes);
        if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        const fields = {
          request_id: requestId,
          method,
          route,
          status,
          duration_ms: Math.round(performance.now() - started),
        };
        const traceId = span.spanContext().traceId;
        if (traceId !== "0".repeat(32)) fields.trace_id = traceId;
        const validation = req.headers["x-uwplan-validation-id"] ?? "";
        if (
          typeof validation === "string" &&
          validationPattern.test(validation)
        ) {
          fields.validation_id = validation;
          span.setAttribute("uwplan.validation.id", validation);
        }
        logEvent(
          status >= 500 ? "error" : status >= 400 ? "warn" : "info",
          "http.request",
          fields,
        );
        span.end();
      });
    };
    res.once("finish", () => finish(res.statusCode));
    res.once("close", () => {
      if (!res.writableFinished) finish(499);
    });
    next();
  });
}
