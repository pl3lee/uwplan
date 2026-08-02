/** @jest-environment node */

import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const digest = `sha256:${"5".repeat(64)}`;
const revision = "observability-test";
const validationId = "validation-11111111-1111-4111-8111-111111111111";
const tokenSentinel = "token-secret-must-not-leak-1234567890";
const userSentinel = "student-data-must-not-leak";
const channelId = "123456789012345678";

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function runValidator(environmentFile: string, timeout = "1000") {
  return await new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(process.execPath, ["ops/observability/validate.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        UWPLAN_OBSERVABILITY_ENV_FILE: environmentFile,
        UWPLAN_VALIDATION_ALLOW_LOOPBACK_HTTP: "true",
        UWPLAN_VALIDATION_ID: validationId,
        UWPLAN_VALIDATION_POLL_INTERVAL_MS: "10",
        UWPLAN_VALIDATION_TIMEOUT_MS: timeout,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("exit", (status) => resolve({ status, stdout, stderr }));
  });
}

function grafanaFrame(value: unknown, labels: Record<string, string> = {}) {
  return {
    schema: {
      fields: [
        { name: "Time", type: "time" },
        { name: "Value", type: "number", labels },
      ],
    },
    data: { values: [[Date.now()], [value]] },
  };
}

describe("observability validation entry point", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "uwplan-observability-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function exerciseBoundary(
    options: { unsafeAlert?: "sentinel" | "nested-url" } = {},
  ) {
    let ready = true;
    let failureObserved = false;
    let recoveryObserved = false;
    const grafanaRequests: Array<{
      method: string;
      path: string;
      body: string;
    }> = [];
    const discordPaths: string[] = [];

    const target = await listen((request, response) => {
      const receivedId = request.headers["x-uwplan-validation-id"];
      response.setHeader("content-type", "application/json");
      response.setHeader("x-uwplan-validation-id", String(receivedId));
      response.statusCode = ready ? 200 : 503;
      response.end(
        JSON.stringify({
          status: ready ? "ready" : "unready",
          release: { digest, revision },
          dependencies: { database: ready ? "available" : "unavailable" },
        }),
      );
    });
    const readinessUrl = `${target.origin}/api/ready`;
    const grafana = await listen((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk.toString()));
      request.on("end", () => {
        const path = request.url ?? "";
        grafanaRequests.push({ method: request.method ?? "", path, body });
        response.setHeader("content-type", "application/json");
        if (
          request.method === "GET" &&
          path === "/api/v1/provisioning/alert-rules/uwplan-rehearsal-readiness"
        ) {
          response.end(
            JSON.stringify({
              uid: "uwplan-rehearsal-readiness",
              title: "UWPlan rehearsal readiness",
              labels: { environment: "rehearsal", service: "uwplan" },
              annotations: {
                summary: "UWPlan rehearsal readiness is unavailable",
                description: "The external HTTPS readiness probe has failed.",
              },
              data: [
                {
                  refId: "A",
                  model: {
                    expr: `probe_success{instance=${JSON.stringify(readinessUrl)}}`,
                  },
                },
              ],
              notification_settings: {
                receiver: "UWPlan rehearsal Discord",
                group_wait: "5s",
                group_interval: "10s",
                repeat_interval: "4h",
              },
            }),
          );
          return;
        }
        if (
          request.method === "GET" &&
          path === "/api/v1/provisioning/contact-points"
        ) {
          response.end(
            JSON.stringify([
              {
                uid: "uwplan-discord-rehearsal",
                name: "UWPlan rehearsal Discord",
                type: "discord",
                settings: { url: "https://discord.com/api/webhooks/redacted" },
                disableResolveMessage: false,
              },
            ]),
          );
          return;
        }
        if (request.method === "POST" && path === "/api/annotations") {
          response.end(JSON.stringify({ id: 17, message: "Annotation added" }));
          return;
        }
        if (request.method !== "POST" || path !== "/api/ds/query") {
          response.statusCode = 404;
          response.end("{}");
          return;
        }
        const payload = JSON.parse(body) as {
          queries?: Array<Record<string, unknown>>;
        };
        const query = payload.queries?.[0];
        const uid = (query?.datasource as { uid?: string } | undefined)?.uid;
        let frame: unknown;
        if (
          uid === "loki" &&
          query?.queryType === "range" &&
          query?.editorMode === "code" &&
          typeof query.expr === "string" &&
          query.expr.includes(validationId) &&
          query.expr.includes(digest)
        ) {
          frame = {
            schema: { fields: [{ name: "Line", type: "string" }] },
            data: {
              values: [
                [
                  JSON.stringify({
                    validation_id: validationId,
                    release_digest: digest,
                  }),
                ],
              ],
            },
          };
        } else if (
          uid === "tempo" &&
          query?.queryType === "traceqlSearch" &&
          typeof query.query === "string" &&
          query.query.includes(validationId) &&
          query.query.includes(digest)
        ) {
          frame = {
            schema: { fields: [{ name: "traceID", type: "string" }] },
            data: { values: [["a".repeat(32)]] },
          };
        } else if (
          uid === "prometheus" &&
          query?.format === "time_series" &&
          query?.instant === false &&
          typeof query.expr === "string"
        ) {
          const expression = query.expr;
          const exactInstance = `instance="${readinessUrl}"`;
          if (expression.includes("uwplan_health_requests_total")) {
            frame = grafanaFrame(1, { service_version: digest });
          } else if (
            expression.includes("probe_success") &&
            expression.includes(exactInstance)
          ) {
            frame = grafanaFrame(1, { instance: readinessUrl });
          } else if (
            expression.includes("probe_http_status_code") &&
            expression.includes(exactInstance)
          ) {
            frame = grafanaFrame(200, { instance: readinessUrl });
          } else if (
            expression.includes("probe_duration_seconds") &&
            expression.includes(exactInstance)
          ) {
            frame = grafanaFrame(0.123, { instance: readinessUrl });
          }
        }
        if (!frame) {
          response.statusCode = 400;
          response.end(JSON.stringify({ message: "wrong query shape" }));
          return;
        }
        response.end(JSON.stringify({ results: { A: { frames: [frame] } } }));
      });
    });
    const control = await listen((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk.toString()));
      request.on("end", () => {
        const state = (JSON.parse(body) as { state: string }).state;
        ready = state === "ready";
        if (ready) recoveryObserved = true;
        else failureObserved = true;
        response.statusCode = 204;
        response.end();
      });
    });
    const discord = await listen((request, response) => {
      discordPaths.push(request.url ?? "");
      const messages = [];
      if (recoveryObserved) {
        messages.push({
          id: "2",
          content: "",
          embeds: [
            {
              title: "[RESOLVED] UWPlan readiness",
              description: "Rehearsal readiness recovered",
            },
          ],
          mentions: [],
          mention_roles: [],
          attachments: [],
        });
      }
      if (failureObserved) {
        messages.push({
          id: "1",
          content: "",
          embeds: [
            {
              title: "[FIRING] UWPlan readiness",
              description:
                options.unsafeAlert === "sentinel"
                  ? `Rehearsal failure: ${userSentinel} ${tokenSentinel}`
                  : "Rehearsal readiness failed",
              ...(options.unsafeAlert === "nested-url"
                ? {
                    url: `https://alerts.example/view?token=${tokenSentinel}`,
                    provider: { name: "student@example.com" },
                    image: { url: "https://cdn.example/student-record.png" },
                  }
                : {}),
            },
          ],
          mentions: [],
          mention_roles: [],
          attachments: [],
        });
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(messages));
    });

    const environmentFile = join(directory, "observability.env");
    await writeFile(
      environmentFile,
      [
        "UWPLAN_VALIDATION_ENVIRONMENT=rehearsal",
        `UWPLAN_READINESS_URL=${readinessUrl}`,
        `UWPLAN_GRAFANA_URL=${grafana.origin}`,
        `UWPLAN_GRAFANA_TOKEN=${tokenSentinel}`,
        "UWPLAN_GRAFANA_ALERT_RULE_UID=uwplan-rehearsal-readiness",
        "UWPLAN_GRAFANA_CONTACT_POINT_UID=uwplan-discord-rehearsal",
        "UWPLAN_PROMETHEUS_DATASOURCE_UID=prometheus",
        "UWPLAN_LOKI_DATASOURCE_UID=loki",
        "UWPLAN_TEMPO_DATASOURCE_UID=tempo",
        `UWPLAN_DISCORD_API_URL=${discord.origin}/api/v10/`,
        `UWPLAN_DISCORD_CHANNEL_ID=${channelId}`,
        `UWPLAN_DISCORD_BOT_TOKEN=${tokenSentinel}`,
        `UWPLAN_FAILURE_CONTROL_URL=${control.origin}/readiness`,
        `UWPLAN_FAILURE_CONTROL_TOKEN=${tokenSentinel}`,
        `RELEASE_DIGEST=${digest}`,
        `RELEASE_REVISION=${revision}`,
        `UWPLAN_VALIDATION_PRIVATE_SENTINEL=${userSentinel}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await chmod(environmentFile, 0o600);

    const close = () =>
      Promise.all([
        target.close(),
        grafana.close(),
        control.close(),
        discord.close(),
      ]);
    return {
      environmentFile,
      readinessUrl,
      grafanaRequests,
      discordPaths,
      recovered: () => recoveryObserved,
      close,
    };
  }

  it("correlates exact telemetry and proves clean embedded firing and recovery evidence", async () => {
    const boundary = await exerciseBoundary();
    const result = await runValidator(boundary.environmentFile);
    await boundary.close();

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      event: "observability.validation",
      status: "passed",
      validation_id: validationId,
      release_digest: digest,
      release_revision: revision,
      readiness: {
        status: 200,
        probe_target: boundary.readinessUrl,
        probe_success: true,
        probe_http_status_code: 200,
        probe_duration_seconds: 0.123,
      },
      telemetry: { logs: true, metrics: true, traces: true },
      annotation: true,
      alert_configuration: true,
      alert: { firing: true, resolved: true, sanitized: true },
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain(tokenSentinel);
    expect(`${result.stdout}${result.stderr}`).not.toContain(userSentinel);
    expect(`${result.stdout}${result.stderr}`).not.toContain(tokenSentinel);
    expect(boundary.discordPaths).not.toHaveLength(0);
    for (const path of boundary.discordPaths) {
      expect(path).toBe(`/api/v10/channels/${channelId}/messages?limit=25`);
    }
    const queries = boundary.grafanaRequests
      .filter(({ path }) => path === "/api/ds/query")
      .map(({ body }) => JSON.parse(body) as { queries: unknown[] });
    expect(queries).toHaveLength(6);
  });

  it("rejects sensitive alert embeds and still restores rehearsal readiness", async () => {
    const boundary = await exerciseBoundary({ unsafeAlert: "sentinel" });
    const result = await runValidator(boundary.environmentFile, "200");
    await boundary.close();

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(`${result.stdout}${result.stderr}`).not.toContain(userSentinel);
    expect(boundary.recovered()).toBe(true);
  });

  it("rejects unsafe nested embed URLs and provider fields and still recovers", async () => {
    const boundary = await exerciseBoundary({ unsafeAlert: "nested-url" });
    const result = await runValidator(boundary.environmentFile, "200");
    await boundary.close();

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(`${result.stdout}${result.stderr}`).not.toContain(tokenSentinel);
    expect(boundary.recovered()).toBe(true);
  });

  it("fails closed before requests when protected configuration is incomplete", async () => {
    const environmentFile = join(directory, "incomplete.env");
    await writeFile(environmentFile, `RELEASE_DIGEST=${digest}\n`, {
      mode: 0o600,
    });

    const result = await runValidator(environmentFile);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("observability configuration is invalid");
  });
});
