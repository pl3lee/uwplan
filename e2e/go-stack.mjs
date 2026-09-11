import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const image =
  "node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3";
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();

export async function startGoStack({
  directory,
  database,
  redis,
  password,
  publicOrigin,
}) {
  const network = `uwplan-e2e-network-${randomUUID()}`;
  const provider = `uwplan-e2e-provider-${randomUUID()}`;
  const api = `uwplan-e2e-api-${randomUUID()}`;
  const created = [];
  const connected = [];
  let networkCreated = false;
  const close = () => {
    const cleanup = (...args) => {
      try {
        docker(...args);
      } catch {
        console.error(
          `Could not clean up isolated E2E resource: ${args.at(-1)}`,
        );
        process.exitCode = 1;
      }
    };
    while (created.length) cleanup("rm", "--force", created.pop());
    if (networkCreated) {
      while (connected.length)
        cleanup("network", "disconnect", network, connected.pop());
      cleanup("network", "rm", network);
      networkCreated = false;
    }
  };
  try {
    const architecture = {
      aarch64: "arm64",
      arm64: "arm64",
      x86_64: "amd64",
      amd64: "amd64",
    }[docker("info", "--format", "{{.Architecture}}")];
    if (!architecture) throw new Error("Unsupported Docker architecture");
    const binary = join(directory, "uwplan-api");
    execFileSync("go", ["build", "-o", binary, "./cmd/api"], {
      cwd: "api",
      stdio: "inherit",
      env: {
        ...process.env,
        GOOS: "linux",
        GOARCH: architecture,
        CGO_ENABLED: "0",
      },
    });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        join(directory, "provider.key"),
        "-out",
        join(directory, "provider.crt"),
        "-subj",
        "/CN=UWPlan isolated OAuth fixture",
        "-addext",
        "subjectAltName=DNS:github.com,DNS:api.github.com,DNS:oauth2.googleapis.com,DNS:www.googleapis.com",
      ],
      { stdio: "ignore" },
    );
    docker("network", "create", network);
    networkCreated = true;
    docker("network", "connect", "--alias", "database", network, database);
    connected.push(database);
    docker("network", "connect", "--alias", "redis", network, redis);
    connected.push(redis);
    const isolation = [
      "--network",
      network,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
    ];
    docker(
      "create",
      "--name",
      provider,
      ...isolation,
      "--network-alias",
      "provider",
      "--memory",
      "96m",
      "--publish",
      "127.0.0.1::8081",
      "--mount",
      `type=bind,source=${resolve("e2e")},target=/fixture,readonly`,
      "--mount",
      `type=bind,source=${directory},target=/certs,readonly`,
      "--env",
      `E2E_BASE_URL=${publicOrigin}`,
      image,
      "node",
      "/fixture/provider-proxy.mjs",
    );
    created.push(provider);
    docker("start", provider);
    const providerPort = docker("port", provider, "8081/tcp").split(":").at(-1);
    const providerOrigin = `http://127.0.0.1:${providerPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (
          (
            await fetch(`${providerOrigin}/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("OAuth fixture did not become ready");
    docker(
      "create",
      "--name",
      api,
      ...isolation,
      "--memory",
      "256m",
      "--publish",
      "127.0.0.1::8080",
      "--mount",
      `type=bind,source=${binary},target=/uwplan-api,readonly`,
      "--mount",
      `type=bind,source=${join(directory, "provider.crt")},target=/provider.crt,readonly`,
      "--env",
      "HTTP_ADDR=:8080",
      "--env",
      `PUBLIC_ORIGIN=${publicOrigin}`,
      "--env",
      `DATABASE_URL=postgres://postgres:${password}@database:5432/uwplan_e2e`,
      "--env",
      "REDIS_URL=redis://redis:6379",
      "--env",
      "HTTPS_PROXY=http://provider:8080",
      "--env",
      "SSL_CERT_FILE=/provider.crt",
      "--env",
      "SSL_CERT_DIR=/nonexistent",
      "--env",
      "AUTH_GOOGLE_ID=e2e-google",
      "--env",
      "AUTH_GOOGLE_SECRET=e2e-google-secret",
      "--env",
      "AUTH_GITHUB_ID=e2e-github",
      "--env",
      "AUTH_GITHUB_SECRET=e2e-github-secret",
      "--env",
      `RELEASE_DIGEST=sha256:${"a".repeat(64)}`,
      "--env",
      `RELEASE_REVISION=${"b".repeat(40)}`,
      "--entrypoint",
      "/uwplan-api",
      image,
    );
    created.push(api);
    // Start before resolving the ephemeral published port; Playwright attaches
    // to this process and forwards termination signals.
    docker("start", api);
    const apiPort = docker("port", api, "8080/tcp").split(":").at(-1);
    return {
      close,
      providerOrigin,
      environment: {
        E2E_API_CONTAINER: api,
        API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
