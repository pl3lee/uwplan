/** @jest-environment node */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";

const expectedDigest = `sha256:${"a".repeat(64)}`;
const databaseSecret = "health-secret-must-not-leak";
const validationId = "validation-22222222-2222-4222-8222-222222222222";

async function unusedPort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("Could not allocate an HTTP test port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForHttp(
  url: string,
  process: ChildProcessWithoutNullStreams,
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `Next.js exited before becoming ready (${process.exitCode})`,
      );
    }
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Next.js did not become ready within 30 seconds");
}

async function stop(process: ChildProcessWithoutNullStreams) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    process.once("exit", () => resolve());
    setTimeout(() => {
      process.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}

describe("health HTTP contracts", () => {
  let app: ChildProcessWithoutNullStreams;
  let collector: Server;
  let collectorOrigin: string;
  let telemetryPaths: string[];
  let origin: string;
  let output: string;

  beforeAll(async () => {
    telemetryPaths = [];
    collector = createHttpServer((request, response) => {
      request.resume();
      request.once("end", () => {
        telemetryPaths.push(request.url ?? "");
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end("{}");
      });
    });
    await new Promise<void>((resolve, reject) => {
      collector.once("error", reject);
      collector.listen(0, "127.0.0.1", resolve);
    });
    const collectorAddress = collector.address();
    if (!collectorAddress || typeof collectorAddress === "string") {
      throw new Error("Could not allocate an OTLP collector port");
    }
    collectorOrigin = `http://127.0.0.1:${collectorAddress.port}`;
    const port = await unusedPort();
    origin = `http://127.0.0.1:${port}`;
    output = "";
    app = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AUTH_GITHUB_ID: "test-github-id",
          AUTH_GITHUB_SECRET: "test-github-secret",
          AUTH_GOOGLE_ID: "test-google-id",
          AUTH_GOOGLE_SECRET: "test-google-secret",
          AUTH_SECRET: "test-auth-secret",
          DATABASE_URL: `postgresql://uwplan:${databaseSecret}@127.0.0.1:1/uwplan`,
          NEXT_TELEMETRY_DISABLED: "1",
          OTEL_EXPORTER_OTLP_ENDPOINT: collectorOrigin,
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${collectorOrigin}/v1/metrics`,
          OTEL_METRIC_EXPORT_INTERVAL: "100",
          RELEASE_DIGEST: expectedDigest,
          RELEASE_REVISION: "health-contract-test",
        },
        stdio: "pipe",
      },
    );
    app.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    app.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    await waitForHttp(`${origin}/api/live`, app);
  }, 35_000);

  afterAll(async () => {
    await stop(app);
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  });

  it("reports process liveness without consulting the unavailable database", async () => {
    const response = await fetch(`${origin}/api/live`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "live" });
  });

  it("fails readiness with release identity and no connection details", async () => {
    const response = await fetch(`${origin}/api/ready`);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(body)).toEqual({
      status: "unready",
      release: {
        digest: expectedDigest,
        revision: "health-contract-test",
      },
      dependencies: { database: "unavailable" },
    });
    expect(body).not.toContain(databaseSecret);
    expect(output).not.toContain(databaseSecret);
    expect(body).not.toContain("postgresql://");
  });

  it("emits structured health request results with release identity", async () => {
    output = "";
    await fetch(`${origin}/api/live`);
    await fetch(`${origin}/api/ready`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const records = output
      .split("\n")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      })
      .filter((record) => record.event === "health.request");

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "/api/live",
          status_code: 200,
          release_digest: expectedDigest,
        }),
        expect.objectContaining({
          route: "/api/ready",
          status_code: 503,
          release_digest: expectedDigest,
          database: "unavailable",
        }),
      ]),
    );
  });

  it("correlates a known readiness request across response, logs, traces, and metrics", async () => {
    output = "";
    telemetryPaths = [];
    const response = await fetch(`${origin}/api/ready`, {
      headers: { "x-uwplan-validation-id": validationId },
    });

    expect(response.headers.get("x-uwplan-validation-id")).toBe(validationId);
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      (!telemetryPaths.includes("/v1/traces") ||
        !telemetryPaths.includes("/v1/metrics"))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const record = output
      .split("\n")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      })
      .find(
        (candidate) =>
          candidate.event === "health.request" &&
          candidate.validation_id === validationId,
      );
    expect(record).toEqual(
      expect.objectContaining({
        validation_id: validationId,
        release_digest: expectedDigest,
        trace_id: expect.stringMatching(/^[a-f0-9]{32}$/),
      }),
    );
    expect(telemetryPaths).toEqual(
      expect.arrayContaining(["/v1/traces", "/v1/metrics"]),
    );
  });
});
