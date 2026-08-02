#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTelemetryQueries } from "./contract.mjs";
import vocabulary from "./telemetry-vocabulary.json" with { type: "json" };

function source(path) {
  return readFileSync(path, "utf8");
}

function includesAll(path, expected) {
  const contents = source(path);
  for (const value of expected) {
    assert.ok(
      contents.includes(value),
      `${path} is missing telemetry term ${value}`,
    );
  }
}

assert.equal(vocabulary.schemaVersion, 1);
includesAll("src/server/observability.ts", [
  vocabulary.metrics.healthRequestsOtel,
  vocabulary.metrics.healthDurationOtel,
  vocabulary.service.releaseResourceAttribute,
  vocabulary.span.validationAttribute,
  vocabulary.log.validationAttribute,
  vocabulary.log.traceAttribute,
]);
includesAll("src/instrumentation.ts", [
  vocabulary.service.name,
  vocabulary.service.releaseResourceAttribute,
]);
includesAll("src/lib/structured-log.ts", [
  vocabulary.log.serviceAttribute,
  vocabulary.log.releaseAttribute,
]);
includesAll("ops/alloy/config.alloy", [
  `${vocabulary.log.serviceAttribute}        = "${vocabulary.log.serviceAttribute}"`,
  `${vocabulary.log.releaseAttribute} = "${vocabulary.log.releaseAttribute}"`,
]);

const digest = `sha256:${"a".repeat(64)}`;
const validationId = "validation-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const readinessUrl = "https://v2.uwplan.com/api/ready";
const queries = buildTelemetryQueries({
  lokiUid: "loki",
  prometheusUid: "prometheus",
  tempoUid: "tempo",
  digest,
  validationId,
  readinessUrl,
});
assert.match(queries.logs.expr, new RegExp(vocabulary.log.releaseAttribute));
assert.match(
  queries.applicationMetric.expr,
  new RegExp(vocabulary.metrics.healthRequestsPrometheus),
);
assert.match(
  queries.traces.query,
  new RegExp(vocabulary.span.validationAttribute),
);
assert.match(
  queries.probeSuccess.expr,
  new RegExp(vocabulary.metrics.probeSuccess),
);
assert.match(
  queries.probeStatus.expr,
  new RegExp(vocabulary.metrics.probeStatus),
);
assert.match(
  queries.probeDuration.expr,
  new RegExp(vocabulary.metrics.probeDuration),
);
for (const query of [
  queries.probeSuccess,
  queries.probeStatus,
  queries.probeDuration,
]) {
  assert.ok(
    query.expr.includes(`${vocabulary.labels.probeInstance}="${readinessUrl}"`),
  );
}

process.stdout.write("telemetry contract valid\n");
