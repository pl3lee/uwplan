import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { startOAuthFixture } from "./oauth-server.mjs";

// This runner owns its database. It never uses DATABASE_URL from a developer's env.
const container = `uwplan-e2e-${randomUUID()}`;
const password = randomUUID();
let child;
let oauth;
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
process.on("SIGINT", () => child?.kill("SIGINT"));
process.on("SIGTERM", () => child?.kill("SIGTERM"));

try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_DB=uwplan_e2e",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:16.14-bookworm",
  );
  const port = docker("port", container, "5432/tcp").split(":").at(-1);
  const databaseURL = `postgres://postgres:${password}@127.0.0.1:${port}/uwplan_e2e`;
  const sql = postgres(databaseURL, { max: 1, connect_timeout: 2 });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await sql`select 1`;
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!ready) throw new Error("E2E PostgreSQL did not become ready");
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  } finally {
    await sql.end();
  }
  const appPort = await availablePort();
  process.env.E2E_BASE_URL = `http://localhost:${appPort}`;
  oauth = await startOAuthFixture();
  child = spawn("npx", ["playwright", "test", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseURL,
      E2E_DATABASE_URL: databaseURL,
      E2E_PORT: String(appPort),
      E2E_OAUTH_ORIGIN: oauth.origin,
      E2E_BASE_URL: process.env.E2E_BASE_URL,
      AUTH_URL: process.env.E2E_BASE_URL,
      AUTH_TRUST_HOST: "true",
      AUTH_SECRET: randomUUID(),
      AUTH_GOOGLE_ID: "e2e-google",
      AUTH_GOOGLE_SECRET: "e2e-google-secret",
      AUTH_GITHUB_ID: "e2e-github",
      AUTH_GITHUB_SECRET: "e2e-github-secret",
      OTEL_ENABLED: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await oauth?.close();
  docker("rm", "--force", container);
}
