import vocabulary from "./telemetry-vocabulary.json" with { type: "json" };

const traceIdPattern = /^[a-f0-9]{32}$/;

function datasource(uid) {
  return { uid };
}

function prometheusQuery(uid, expression) {
  return {
    refId: "A",
    datasource: datasource(uid),
    expr: expression,
    format: "time_series",
    instant: false,
    intervalMs: 1_000,
    maxDataPoints: 1_000,
  };
}

export function buildTelemetryQueries({
  lokiUid,
  prometheusUid,
  tempoUid,
  digest,
  validationId,
  readinessUrl,
}) {
  const instance = `${vocabulary.labels.probeInstance}=${JSON.stringify(readinessUrl)}`;
  return {
    logs: {
      refId: "A",
      datasource: datasource(lokiUid),
      expr: `{${vocabulary.log.serviceAttribute}=${JSON.stringify(vocabulary.service.name)}, ${vocabulary.log.releaseAttribute}=${JSON.stringify(digest)}} |= ${JSON.stringify(validationId)}`,
      queryType: "range",
      editorMode: "code",
      maxLines: 100,
    },
    applicationMetric: prometheusQuery(
      prometheusUid,
      `${vocabulary.metrics.healthRequestsPrometheus}{${vocabulary.labels.serviceVersion}=${JSON.stringify(digest)}}`,
    ),
    traces: {
      refId: "A",
      datasource: datasource(tempoUid),
      query: `{ resource.${vocabulary.service.nameResourceAttribute} = ${JSON.stringify(vocabulary.service.name)} && resource.${vocabulary.service.releaseResourceAttribute} = ${JSON.stringify(digest)} && span.${vocabulary.span.validationAttribute} = ${JSON.stringify(validationId)} }`,
      queryType: "traceqlSearch",
      limit: 20,
      tableType: "traces",
    },
    probeSuccess: prometheusQuery(
      prometheusUid,
      `${vocabulary.metrics.probeSuccess}{${instance}}`,
    ),
    probeStatus: prometheusQuery(
      prometheusUid,
      `${vocabulary.metrics.probeStatus}{${instance}}`,
    ),
    probeDuration: prometheusQuery(
      prometheusUid,
      `${vocabulary.metrics.probeDuration}{${instance}}`,
    ),
  };
}

export function frames(body) {
  const candidates = Object.values(body?.results ?? {}).flatMap((result) =>
    Array.isArray(result?.frames) ? result.frames : [],
  );
  return candidates.filter(
    (frame) =>
      Array.isArray(frame?.schema?.fields) &&
      Array.isArray(frame?.data?.values),
  );
}

function flattenedValues(body) {
  return frames(body).flatMap((frame) => frame.data.values.flat(4));
}

export function hasCorrelatedLog(body, validationId, digest) {
  const values = flattenedValues(body).filter(
    (value) => typeof value === "string",
  );
  return values.some(
    (value) => value.includes(validationId) && value.includes(digest),
  );
}

export function hasTraceId(body) {
  return flattenedValues(body).some(
    (value) => typeof value === "string" && traceIdPattern.test(value),
  );
}

export function metricSample(body, expectedLabels = {}) {
  for (const frame of frames(body)) {
    for (let index = 0; index < frame.schema.fields.length; index += 1) {
      const field = frame.schema.fields[index];
      const labels = field?.labels ?? {};
      if (
        !Object.entries(expectedLabels).every(
          ([key, value]) => labels[key] === value,
        )
      ) {
        continue;
      }
      const values = frame.data.values[index];
      if (!Array.isArray(values)) continue;
      const sample = [...values]
        .reverse()
        .find((value) => typeof value === "number" && Number.isFinite(value));
      if (typeof sample === "number") return sample;
    }
  }
  return undefined;
}

export function discordMessagesUrl(baseUrl, channelId) {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const url = new URL(`channels/${channelId}/messages`, base);
  url.searchParams.set("limit", "25");
  return url;
}

function allStrings(value, strings = [], keys = []) {
  if (typeof value === "string") {
    strings.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) allStrings(item, strings, keys);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      allStrings(nested, strings, keys);
    }
  }
  return { strings, keys };
}

function unsafeUrl(value, secrets) {
  if (!/^https?:\/\//i.test(value)) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (url.protocol !== "https:" || url.username || url.password) return true;
  for (const [key, parameter] of url.searchParams) {
    if (
      /(?:auth|bearer|cookie|email|key|password|secret|session|token|user)/i.test(
        key,
      ) ||
      secrets.some((secret) => secret && parameter.includes(secret))
    ) {
      return true;
    }
  }
  return false;
}

export function validateNewDiscordMessages(messages, baselineIds, secrets) {
  if (!Array.isArray(messages)) return [];
  const newMessages = messages.filter(
    (message) =>
      typeof message?.id === "string" && !baselineIds.has(message.id),
  );
  return newMessages.map((message) => {
    if (
      (Array.isArray(message.mentions) && message.mentions.length > 0) ||
      (Array.isArray(message.mention_roles) &&
        message.mention_roles.length > 0) ||
      (Array.isArray(message.attachments) && message.attachments.length > 0) ||
      message.mention_everyone === true
    ) {
      throw new Error("alert evidence is not sanitized");
    }
    const { strings, keys } = allStrings(message);
    const text = strings.join("\n");
    const normalized = text.toLowerCase();
    if (
      secrets.some((secret) => secret && text.includes(secret)) ||
      strings.some((value) => unsafeUrl(value, secrets)) ||
      keys.some((key) =>
        /^(?:authorization|cookie|database_url|email|password|secret|session|token|user(?:_id|_email)?)$/i.test(
          key,
        ),
      ) ||
      /<@|@everyone|@here/i.test(text) ||
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
      /\bstudent(?:[-_. ]?(?:data|email|id|record))\b|postgres(?:ql)?:\/\/|\bbearer\s+|\b(?:authorization|cookie|database_url|password|token|user(?:_id|_email)?|student|session)\s*[:=]/i.test(
        text,
      )
    ) {
      throw new Error("alert evidence is not sanitized");
    }
    return { ...message, __uwplanAlertText: normalized };
  });
}

export function containsAlertState(messages, state) {
  return messages.some(
    (message) =>
      message.__uwplanAlertText?.includes("uwplan") &&
      message.__uwplanAlertText?.includes("readiness") &&
      message.__uwplanAlertText?.includes(state),
  );
}
