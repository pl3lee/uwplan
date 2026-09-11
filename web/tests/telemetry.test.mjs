import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

test("production web exports safe correlated requests and forwards API trace context", {
  timeout: 20_000,
}, async (t) => {
  const payloads = [];
  const collector = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    payloads.push({
      path: req.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    assert.equal(req.headers.authorization, "fixture-collector-token");
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  const collectorOrigin = await listen(collector);
  t.after(() => {
    collector.closeAllConnections();
    collector.close();
  });
  let apiTraceparent;
  let apiValidation;
  const api = createServer((req, res) => {
    if (req.url === "/api/ready") {
      res
        .writeHead(200, {
          "content-type": "application/json",
          "X-UWPlan-Web-Release-Digest": "upstream-must-not-identify-web",
          "X-UWPlan-Web-Release-Revision": "upstream-must-not-identify-web",
        })
        .end(
          JSON.stringify({
            status: "ready",
            release: {
              digest: `sha256:${"c".repeat(64)}`,
              revision: "b".repeat(40),
            },
          }),
        );
    } else if (req.url.startsWith("/api/failure")) {
      req.socket.destroy();
    } else if (req.url.startsWith("/api/live")) {
      apiTraceparent = req.headers.traceparent;
      apiValidation = req.headers["x-uwplan-validation-id"];
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"status":"live"}');
    } else if (req.headers.cookie?.includes("private-canary")) {
      res
        .writeHead(500, { "content-type": "application/json" })
        .end('{"title":"private-canary","status":500}');
    } else {
      res
        .writeHead(401, { "content-type": "application/json" })
        .end('{"title":"Unauthorized","status":401}');
    }
  });
  const apiOrigin = await listen(api);
  t.after(() => {
    api.closeAllConnections();
    api.close();
  });
  const { origin, digest, revision, child, exited, output } = await startWeb(
    t,
    collectorOrigin,
    apiOrigin,
  );
  await waitReady(origin);
  const readiness = await fetch(`${origin}/api/ready`);
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), {
    status: "ready",
    release: { digest: `sha256:${"c".repeat(64)}`, revision },
  });
  assert.equal(readiness.headers.get("X-UWPlan-Web-Release-Digest"), digest);
  assert.equal(
    readiness.headers.get("X-UWPlan-Web-Release-Revision"),
    revision,
  );
  const validation = "validation-33333333-3333-3333-3333-333333333333";
  const response = await fetch(
    `${origin}/api/live?code=private-canary&state=private-canary`,
    {
      headers: {
        traceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`,
        "x-uwplan-validation-id": validation,
        Cookie: "uwplan_session=private-canary",
        Authorization: "Bearer private-canary",
        baggage: "secret=private-canary",
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "live" });
  const failure = await fetch(`${origin}/api/failure?code=private-canary`, {
    headers: { traceparent: `00-${"4".repeat(32)}-${"5".repeat(16)}-01` },
  });
  assert.equal(failure.status, 502);
  assert.deepEqual(await failure.json(), {
    title: "Bad Gateway",
    status: 502,
    detail: "API unavailable",
  });
  const renderFailure = await fetch(`${origin}/signin?code=private-canary`, {
    headers: {
      Cookie: "uwplan_session=private-canary",
      traceparent: `00-${"6".repeat(32)}-${"7".repeat(16)}-01`,
    },
  });
  assert.equal(renderFailure.status, 500);
  assert.ok(!(await renderFailure.text()).includes("private-canary"));
  const notFound = await fetch(`${origin}/missing-private-canary`, {
    headers: { traceparent: `00-${"8".repeat(32)}-${"9".repeat(16)}-01` },
  });
  assert.equal(notFound.status, 404);
  assert.ok((await notFound.text()).includes("Unable to load this page"));
  child.kill("SIGTERM");
  const [exitCode] = await exited;
  assert.equal(exitCode, 0);
  const records = payloads.flatMap(({ body }) =>
    (body.resourceLogs ?? []).flatMap((resource) =>
      resource.scopeLogs.flatMap((scope) =>
        scope.logRecords.map((record) => ({
          resource: resource.resource,
          record,
        })),
      ),
    ),
  );
  const requestLog = records.find(
    ({ record }) => record.traceId === "1".repeat(32),
  );
  assert.ok(requestLog, "correlated request log reaches collector before exit");
  assert.deepEqual(
    Object.fromEntries(
      requestLog.resource.attributes.map(({ key, value }) => [
        key,
        value.stringValue,
      ]),
    ),
    {
      "service.name": "uwplan-web",
      "service.version": digest,
      "vcs.ref.head.revision": revision,
    },
  );
  assert.equal(requestLog.record.body.stringValue, "http.request");
  assert.ok(
    records.some(
      ({ record }) =>
        record.body.stringValue === "render.failed" &&
        record.traceId === "6".repeat(32) &&
        record.severityNumber === 17,
    ),
    "loader/render failure reaches collector with request context",
  );
  const notFoundLogs = records.filter(
    ({ record }) => record.traceId === "8".repeat(32),
  );
  assert.ok(
    notFoundLogs.some(
      ({ record }) => record.body.stringValue === "http.request",
    ),
  );
  assert.ok(
    notFoundLogs.every(({ record }) => record.severityNumber < 17),
    "ordinary missing routes must not report a server rendering failure",
  );
  const failedLogs = records.filter(
    ({ record }) => record.traceId === "4".repeat(32),
  );
  assert.deepEqual(
    failedLogs.map(({ record }) => [
      record.body.stringValue,
      record.severityNumber,
    ]),
    [
      ["api.proxy.failed", 17],
      ["http.request", 17],
    ],
  );
  const spans = payloads.flatMap(({ body }) =>
    (body.resourceSpans ?? []).flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans),
    ),
  );
  const span = spans.find((span) => span.traceId === "1".repeat(32));
  assert.ok(span, "correlated web span reaches collector");
  assert.equal(span.parentSpanId, "2".repeat(16));
  assert.equal(span.name, "GET /api/*");
  assert.equal(apiTraceparent, `00-${span.traceId}-${span.spanId}-01`);
  assert.equal(apiValidation, validation);
  const failedSpan = spans.find((span) => span.traceId === "4".repeat(32));
  assert.equal(failedSpan?.status.code, 2);
  assert.ok(
    !JSON.stringify(payloads).includes("private-canary"),
    "request secrets stay out of all exported signals",
  );
  assert.ok(
    !output().includes("private-canary"),
    "request secrets stay out of stdout",
  );
});

test("collector outage leaves web requests available and shutdown bounded", {
  timeout: 20_000,
}, async (t) => {
  let exporting;
  const exportStarted = new Promise((resolve) => {
    exporting = resolve;
  });
  const collector = createServer(() => exporting());
  const collectorOrigin = await listen(collector);
  t.after(() => {
    collector.closeAllConnections();
    collector.close();
  });
  const { origin, child, exited } = await startWeb(
    t,
    collectorOrigin,
    "http://127.0.0.1:1",
  );
  await waitReady(origin);
  await exportStarted;
  const response = await fetch(`${origin}/signin`, {
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Sign in to your account/);
  child.kill("SIGTERM");
  const [exitCode] = await Promise.race([
    exited,
    delay(5000, undefined, { ref: false }).then(() => {
      throw new Error("telemetry shutdown exceeded five seconds");
    }),
  ]);
  assert.equal(exitCode, 0);
});

test("fatal startup errors reach the collector before the web process exits", {
  timeout: 10_000,
}, async (t) => {
  const payloads = [];
  const collector = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    payloads.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  const collectorOrigin = await listen(collector);
  t.after(() => {
    collector.closeAllConnections();
    collector.close();
  });
  const { exited, output } = await startWeb(
    t,
    collectorOrigin,
    "http://127.0.0.1:1",
    {
      PORT: "private-canary",
    },
  );
  const [exitCode] = await exited;
  assert.equal(exitCode, 1);
  const records = payloads.flatMap((body) =>
    (body.resourceLogs ?? []).flatMap((resource) =>
      resource.scopeLogs.flatMap((scope) => scope.logRecords),
    ),
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].body.stringValue, "startup.failed");
  assert.equal(records[0].severityNumber, 17);
  assert.ok(!JSON.stringify(payloads).includes("private-canary"));
  assert.ok(!output().includes("private-canary"));
});

test("collector error bodies stay redacted when OTEL_LOG_LEVEL is configured", {
  timeout: 10_000,
}, async (t) => {
  let requests = 0;
  const collector = createServer((req, res) => {
    requests++;
    req.resume();
    res.writeHead(400).end("private-canary");
  });
  const collectorOrigin = await listen(collector);
  t.after(() => {
    collector.closeAllConnections();
    collector.close();
  });
  const { origin, child, exited, output } = await startWeb(
    t,
    collectorOrigin,
    "http://127.0.0.1:1",
    {
      OTEL_LOG_LEVEL: "error",
    },
  );
  await waitReady(origin);
  child.kill("SIGTERM");
  assert.equal((await exited)[0], 0);
  assert.ok(requests > 0);
  assert.ok(
    !output().includes("private-canary"),
    "collector response bodies never reach application logs",
  );
  assert.match(output(), /telemetry\.(export|shutdown)\.failed/);
});

async function startWeb(t, collectorOrigin, apiOrigin, overrides = {}) {
  const reservation = createServer();
  const origin = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const digest = `sha256:${"a".repeat(64)}`;
  const revision = "b".repeat(40);
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: new URL(origin).port,
    API_ORIGIN: apiOrigin,
    OTEL_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: collectorOrigin,
    RELEASE_DIGEST: digest,
    RELEASE_REVISION: revision,
    OTEL_EXPORTER_OTLP_HEADERS: "",
    ...overrides,
  };
  for (const signal of ["LOGS", "TRACES", "METRICS"]) {
    env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`] =
      `${collectorOrigin}/v1/${signal.toLowerCase()}`;
    env[`OTEL_EXPORTER_OTLP_${signal}_HEADERS`] =
      "authorization=fixture-collector-token";
  }
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
  });
  return { origin, digest, revision, child, exited, output: () => output };
}

async function waitReady(origin) {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${origin}/signin`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, "production server becomes ready");
}
