#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  buildTelemetryQueries,
  containsAlertState,
  discordMessagesUrl,
  hasCorrelatedLog,
  hasTraceId,
  metricSample,
  validateNewDiscordMessages,
} from "./contract.mjs";

const requiredKeys = [
  "UWPLAN_VALIDATION_ENVIRONMENT",
  "UWPLAN_READINESS_URL",
  "UWPLAN_GRAFANA_URL",
  "UWPLAN_GRAFANA_TOKEN",
  "UWPLAN_GRAFANA_ALERT_RULE_UID",
  "UWPLAN_GRAFANA_CONTACT_POINT_UID",
  "UWPLAN_PROMETHEUS_DATASOURCE_UID",
  "UWPLAN_LOKI_DATASOURCE_UID",
  "UWPLAN_TEMPO_DATASOURCE_UID",
  "UWPLAN_DISCORD_API_URL",
  "UWPLAN_DISCORD_CHANNEL_ID",
  "UWPLAN_DISCORD_BOT_TOKEN",
  "UWPLAN_FAILURE_CONTROL_URL",
  "UWPLAN_FAILURE_CONTROL_TOKEN",
  "RELEASE_DIGEST",
  "RELEASE_REVISION",
];

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[a-zA-Z0-9._-]{1,128}$/;
const validationPattern = /^validation-[a-f0-9-]{36}$/;
const datasourcePattern = /^[a-zA-Z0-9_-]{1,128}$/;
const discordChannelPattern = /^[0-9]{17,20}$/;
const minimumOperationalTimeoutMs = 240_000;

function fail() {
  process.stderr.write("observability configuration is invalid\n");
  process.exit(1);
}

function readProtectedEnvironment(path) {
  if (!path) fail();
  let contents;
  let metadata;
  try {
    metadata = statSync(path);
    contents = readFileSync(path, "utf8");
  } catch {
    fail();
  }
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) fail();

  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail();
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || key in values || !value) fail();
    values[key] = value;
  }
  return values;
}

function validateUrl(raw, allowLoopbackHttp) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail();
  }
  const testHttp =
    allowLoopbackHttp &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !testHttp) fail();
  if (url.username || url.password || url.hash) fail();
  return url;
}

function loadConfiguration() {
  const values = readProtectedEnvironment(
    process.env.UWPLAN_OBSERVABILITY_ENV_FILE,
  );
  if (requiredKeys.some((key) => !values[key])) fail();
  if (values.UWPLAN_VALIDATION_ENVIRONMENT !== "rehearsal") fail();
  if (!digestPattern.test(values.RELEASE_DIGEST)) fail();
  if (!revisionPattern.test(values.RELEASE_REVISION)) fail();
  if (!discordChannelPattern.test(values.UWPLAN_DISCORD_CHANNEL_ID)) fail();
  for (const key of [
    "UWPLAN_PROMETHEUS_DATASOURCE_UID",
    "UWPLAN_LOKI_DATASOURCE_UID",
    "UWPLAN_TEMPO_DATASOURCE_UID",
  ]) {
    if (!datasourcePattern.test(values[key])) fail();
  }
  const allowLoopbackHttp =
    process.env.NODE_ENV === "test" &&
    process.env.UWPLAN_VALIDATION_ALLOW_LOOPBACK_HTTP === "true";
  const readinessUrl = validateUrl(
    values.UWPLAN_READINESS_URL,
    allowLoopbackHttp,
  );
  if (
    readinessUrl.hostname === "uwplan.com" ||
    readinessUrl.hostname === "www.uwplan.com"
  ) {
    fail();
  }
  return {
    release: {
      digest: values.RELEASE_DIGEST,
      revision: values.RELEASE_REVISION,
    },
    readiness: { url: readinessUrl },
    grafana: {
      url: validateUrl(values.UWPLAN_GRAFANA_URL, allowLoopbackHttp),
      token: values.UWPLAN_GRAFANA_TOKEN,
      alertRuleUid: values.UWPLAN_GRAFANA_ALERT_RULE_UID,
      contactPointUid: values.UWPLAN_GRAFANA_CONTACT_POINT_UID,
      prometheusUid: values.UWPLAN_PROMETHEUS_DATASOURCE_UID,
      lokiUid: values.UWPLAN_LOKI_DATASOURCE_UID,
      tempoUid: values.UWPLAN_TEMPO_DATASOURCE_UID,
    },
    discord: {
      url: validateUrl(values.UWPLAN_DISCORD_API_URL, allowLoopbackHttp),
      channelId: values.UWPLAN_DISCORD_CHANNEL_ID,
      token: values.UWPLAN_DISCORD_BOT_TOKEN,
    },
    failure: {
      url: validateUrl(values.UWPLAN_FAILURE_CONTROL_URL, allowLoopbackHttp),
      token: values.UWPLAN_FAILURE_CONTROL_TOKEN,
    },
    sensitiveValues: Object.entries(values).flatMap(([key, value]) =>
      /(?:TOKEN|SECRET|PRIVATE_SENTINEL)/.test(key) ? [value] : [],
    ),
  };
}

const pollIntervalMs = Number(
  process.env.UWPLAN_VALIDATION_POLL_INTERVAL_MS ?? "5000",
);
const timeoutMs = Number(process.env.UWPLAN_VALIDATION_TIMEOUT_MS ?? "600000");
if (
  !Number.isSafeInteger(pollIntervalMs) ||
  pollIntervalMs < 1 ||
  !Number.isSafeInteger(timeoutMs) ||
  timeoutMs < pollIntervalMs ||
  (process.env.NODE_ENV !== "test" && timeoutMs < minimumOperationalTimeoutMs)
) {
  fail();
}

async function request(url, options = {}) {
  return await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
  });
}

async function jsonRequest(url, options = {}) {
  const response = await request(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("remote boundary rejected validation");
  return body;
}

async function poll(operation, predicate) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const result = await operation();
      if (predicate(result)) return result;
    } catch {
      // The bounded poll reports only a sanitized failure if the boundary stays down.
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (Date.now() < deadline);
  throw new Error("validation boundary timed out");
}

function grafanaHeaders(grafana) {
  return {
    authorization: `Bearer ${grafana.token}`,
    "content-type": "application/json",
  };
}

async function queryGrafana(grafana, query) {
  const now = Date.now();
  return await jsonRequest(new URL("/api/ds/query", grafana.url), {
    method: "POST",
    headers: grafanaHeaders(grafana),
    body: JSON.stringify({
      from: String(now - 5 * 60_000),
      to: String(now + 60_000),
      queries: [query],
    }),
  });
}

async function setFailureState(failure, state, validationId) {
  const response = await request(failure.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${failure.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ state, validationId }),
  });
  if (!response.ok) throw new Error("failure control rejected validation");
}

async function readiness(readinessConfiguration, validationId) {
  const response = await request(readinessConfiguration.url, {
    headers: { "x-uwplan-validation-id": validationId },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function discordMessages(discord) {
  const url = discordMessagesUrl(discord.url, discord.channelId);
  return await jsonRequest(url, {
    headers: { authorization: `Bot ${discord.token}` },
  });
}

async function verifyAlertConfiguration(grafana, probeExpression) {
  const rule = await jsonRequest(
    new URL(
      `/api/v1/provisioning/alert-rules/${grafana.alertRuleUid}`,
      grafana.url,
    ),
    { headers: grafanaHeaders(grafana) },
  );
  const contactPoints = await jsonRequest(
    new URL("/api/v1/provisioning/contact-points", grafana.url),
    { headers: grafanaHeaders(grafana) },
  );
  const contact = Array.isArray(contactPoints)
    ? contactPoints.find(
        (candidate) => candidate?.uid === grafana.contactPointUid,
      )
    : undefined;
  if (
    rule?.uid !== grafana.alertRuleUid ||
    rule?.labels?.service !== "uwplan" ||
    rule?.labels?.environment !== "rehearsal" ||
    rule?.notification_settings?.receiver !== "UWPlan rehearsal Discord" ||
    rule?.notification_settings?.group_wait !== "5s" ||
    rule?.notification_settings?.group_interval !== "10s" ||
    rule?.notification_settings?.repeat_interval !== "4h" ||
    rule?.annotations?.summary !==
      "UWPlan rehearsal readiness is unavailable" ||
    rule?.annotations?.description !==
      "The external HTTPS readiness probe has failed." ||
    !Array.isArray(rule?.data) ||
    !rule.data.some(
      (entry) => entry?.refId === "A" && entry?.model?.expr === probeExpression,
    ) ||
    contact?.uid !== grafana.contactPointUid ||
    contact?.type !== "discord" ||
    typeof contact?.settings?.url !== "string" ||
    contact.settings.url.length === 0 ||
    contact?.disableResolveMessage !== false
  ) {
    throw new Error("alert configuration does not match contract");
  }
}

async function main() {
  const configuration = loadConfiguration();
  const validationId =
    process.env.NODE_ENV === "test" &&
    validationPattern.test(process.env.UWPLAN_VALIDATION_ID ?? "")
      ? process.env.UWPLAN_VALIDATION_ID
      : `validation-${randomUUID()}`;

  const initial = await readiness(configuration.readiness, validationId);
  if (
    initial.response.status !== 200 ||
    initial.response.headers.get("x-uwplan-validation-id") !== validationId ||
    initial.body?.status !== "ready" ||
    initial.body?.release?.digest !== configuration.release.digest ||
    initial.body?.release?.revision !== configuration.release.revision
  ) {
    throw new Error("release readiness did not match validation target");
  }

  const queries = buildTelemetryQueries({
    lokiUid: configuration.grafana.lokiUid,
    prometheusUid: configuration.grafana.prometheusUid,
    tempoUid: configuration.grafana.tempoUid,
    digest: configuration.release.digest,
    validationId,
    readinessUrl: configuration.readiness.url.href,
  });
  await verifyAlertConfiguration(
    configuration.grafana,
    queries.probeSuccess.expr,
  );
  await jsonRequest(new URL("/api/annotations", configuration.grafana.url), {
    method: "POST",
    headers: grafanaHeaders(configuration.grafana),
    body: JSON.stringify({
      text: "UWPlan release validation",
      tags: ["uwplan", configuration.release.digest, validationId],
    }),
  });

  await poll(
    () => queryGrafana(configuration.grafana, queries.logs),
    (body) =>
      hasCorrelatedLog(body, validationId, configuration.release.digest),
  );
  await poll(
    () => queryGrafana(configuration.grafana, queries.applicationMetric),
    (body) =>
      metricSample(body, { service_version: configuration.release.digest }) !==
      undefined,
  );
  await poll(
    () => queryGrafana(configuration.grafana, queries.traces),
    hasTraceId,
  );
  const probeSuccess = await poll(
    () => queryGrafana(configuration.grafana, queries.probeSuccess),
    (body) =>
      metricSample(body, { instance: configuration.readiness.url.href }) === 1,
  );
  const probeStatus = await poll(
    () => queryGrafana(configuration.grafana, queries.probeStatus),
    (body) =>
      metricSample(body, { instance: configuration.readiness.url.href }) ===
      200,
  );
  const probeDuration = await poll(
    () => queryGrafana(configuration.grafana, queries.probeDuration),
    (body) => {
      const value = metricSample(body, {
        instance: configuration.readiness.url.href,
      });
      return typeof value === "number" && value > 0;
    },
  );
  const remoteDuration = metricSample(probeDuration, {
    instance: configuration.readiness.url.href,
  });

  const baselineMessages = await discordMessages(configuration.discord);
  const baselineIds = new Set(
    Array.isArray(baselineMessages)
      ? baselineMessages.flatMap((message) =>
          typeof message?.id === "string" ? [message.id] : [],
        )
      : [],
  );
  let failureTriggered = false;
  try {
    await setFailureState(configuration.failure, "unready", validationId);
    failureTriggered = true;
    await poll(
      () => readiness(configuration.readiness, validationId),
      ({ response }) => response.status === 503,
    );
    await poll(
      () => discordMessages(configuration.discord),
      (messages) =>
        containsAlertState(
          validateNewDiscordMessages(
            messages,
            baselineIds,
            configuration.sensitiveValues,
          ),
          "firing",
        ),
    );
  } finally {
    if (failureTriggered) {
      await setFailureState(configuration.failure, "ready", validationId);
    }
  }
  await poll(
    () => readiness(configuration.readiness, validationId),
    ({ response, body }) => response.status === 200 && body?.status === "ready",
  );
  await poll(
    () => discordMessages(configuration.discord),
    (messages) =>
      containsAlertState(
        validateNewDiscordMessages(
          messages,
          baselineIds,
          configuration.sensitiveValues,
        ),
        "resolved",
      ),
  );

  process.stdout.write(
    `${JSON.stringify({
      event: "observability.validation",
      status: "passed",
      validation_id: validationId,
      release_digest: configuration.release.digest,
      release_revision: configuration.release.revision,
      readiness: {
        status: 200,
        probe_target: configuration.readiness.url.href,
        probe_success:
          metricSample(probeSuccess, {
            instance: configuration.readiness.url.href,
          }) === 1,
        probe_http_status_code: metricSample(probeStatus, {
          instance: configuration.readiness.url.href,
        }),
        probe_duration_seconds: remoteDuration,
      },
      telemetry: { logs: true, metrics: true, traces: true },
      annotation: true,
      alert_configuration: true,
      alert: { firing: true, resolved: true, sanitized: true },
    })}\n`,
  );
}

main().catch(() => fail());
