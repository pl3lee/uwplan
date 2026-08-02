/** @jest-environment node */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request as sendHttpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const digest = `sha256:${"7".repeat(64)}`;
const revision = "rehearsal-control-test";
const validationId = "validation-33333333-3333-4333-8333-333333333333";
const secret = "rehearsal-control-secret-12345678901234567890";

async function unusedPort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(
  origin: string,
  child: ChildProcessWithoutNullStreams,
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Next.js stopped early");
    try {
      const response = await fetch(`${origin}/api/live`);
      if (response.ok) return;
    } catch {
      // Retry only during bounded server startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Next.js did not start");
}

async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}

async function startApp(extra: Record<string, string | undefined> = {}) {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(
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
        DATABASE_URL: "postgresql://uwplan:database-secret@127.0.0.1:1/uwplan",
        NEXT_TELEMETRY_DISABLED: "1",
        RELEASE_DIGEST: digest,
        RELEASE_REVISION: revision,
        ...extra,
      },
      stdio: "pipe",
    },
  );
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  await waitForHttp(origin, child);
  return { child, origin, output: () => output };
}

async function httpRequest(
  origin: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body = "",
) {
  const target = new URL(path, origin);
  return await new Promise<{
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }>((resolve, reject) => {
    const request = sendHttpRequest(target, { method, headers }, (response) => {
      let responseBody = "";
      response.on("data", (chunk) => (responseBody += chunk.toString()));
      response.once("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          text: async () => responseBody,
          json: async () => JSON.parse(responseBody) as unknown,
        }),
      );
    });
    request.once("error", reject);
    request.end(body);
  });
}

function controlRequest(
  origin: string,
  state: "ready" | "unready",
  options: {
    authorization?: string;
    host?: string;
    validationId?: string;
  } = {},
) {
  return httpRequest(
    origin,
    "/api/rehearsal/readiness-control",
    "POST",
    {
      "content-type": "application/json",
      ...(options.authorization
        ? { authorization: options.authorization }
        : {}),
      ...(options.host ? { host: options.host } : {}),
    },
    JSON.stringify({
      state,
      validationId: options.validationId ?? validationId,
    }),
  );
}

describe("rehearsal readiness failure controller", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "uwplan-rehearsal-control-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("is unavailable by default", async () => {
    const app = await startApp();
    try {
      const response = await controlRequest(app.origin, "unready", {
        authorization: `Bearer ${secret}`,
        host: "v2.uwplan.com",
      });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(secret);
      expect(app.output()).not.toContain(secret);
    } finally {
      await stop(app.child);
    }
  }, 35_000);

  it("requires rehearsal host, strong bearer auth, and supports failure then recovery", async () => {
    const stateFile = join(directory, "uwplan-rehearsal-readiness.json");
    const app = await startApp({
      UWPLAN_DEPLOYMENT_ENVIRONMENT: "rehearsal",
      UWPLAN_REHEARSAL_FAILURE_CONTROL_ENABLED: "true",
      UWPLAN_REHEARSAL_HOST: "v2.uwplan.com",
      UWPLAN_REHEARSAL_FAILURE_CONTROL_TOKEN: secret,
      UWPLAN_REHEARSAL_FAILURE_STATE_FILE: stateFile,
    });
    try {
      expect(
        (
          await controlRequest(app.origin, "unready", {
            authorization: `Bearer ${secret}`,
            host: "uwplan.com",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await controlRequest(app.origin, "unready", {
            host: "v2.uwplan.com",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await controlRequest(app.origin, "unready", {
            authorization: `Bearer ${secret}`,
            host: "v2.uwplan.com",
            validationId: "student@example.com",
          })
        ).status,
      ).toBe(400);

      const failed = await controlRequest(app.origin, "unready", {
        authorization: `Bearer ${secret}`,
        host: "v2.uwplan.com",
      });
      expect(failed.status).toBe(200);
      expect(await failed.json()).toEqual({
        status: "unready",
        validation_id: validationId,
      });

      const forcedReadiness = await httpRequest(
        app.origin,
        "/api/ready",
        "GET",
        {
          host: "v2.uwplan.com",
          "x-uwplan-validation-id": validationId,
        },
      );
      expect(forcedReadiness.status).toBe(503);
      expect(await forcedReadiness.json()).toEqual(
        expect.objectContaining({
          status: "unready",
          dependencies: expect.objectContaining({
            validation: "forced-unready",
          }),
        }),
      );

      const recovered = await controlRequest(app.origin, "ready", {
        authorization: `Bearer ${secret}`,
        host: "v2.uwplan.com",
      });
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toEqual({
        status: "ready",
        validation_id: validationId,
      });

      const recoveredReadiness = await httpRequest(
        app.origin,
        "/api/ready",
        "GET",
        {
          host: "v2.uwplan.com",
          "x-uwplan-validation-id": validationId,
        },
      );
      expect(recoveredReadiness.status).toBe(503);
      expect(await recoveredReadiness.json()).toEqual(
        expect.objectContaining({
          dependencies: { database: "unavailable" },
        }),
      );
      expect(app.output()).not.toContain(secret);
    } finally {
      await stop(app.child);
    }
  }, 35_000);
});
