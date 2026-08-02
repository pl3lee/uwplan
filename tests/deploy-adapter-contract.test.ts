/** @jest-environment node */

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const adapter = join(process.cwd(), "ops/deploy/compose-adapter.mjs");
const digest = `sha256:${"e".repeat(64)}`;
const revision = "adapter-contract";
const repository = "ghcr.io/pl3lee/uwplan";

describe("root Compose adapter protocol", () => {
  it("honors the shared operation and argument contract with a disposable Docker runner", async () => {
    const root = mkdtempSync(join(tmpdir(), "uwplan-adapter-contract-"));
    const runner = join(root, "docker-runner.mjs");
    const runnerLog = join(root, "docker.jsonl");
    const composeFile = join(root, "compose.yaml");
    const runtimeEnvironment = join(root, "runtime.env");
    const releaseEnvironment = join(root, "release.env");
    writeFileSync(composeFile, "name: uwplan-test\nservices: {}\n");
    writeFileSync(runtimeEnvironment, "UWPLAN_ENV_FILE=/test/app.env\n");
    writeFileSync(
      runner,
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.TEST_DOCKER_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`,
    );
    chmodSync(runner, 0o700);

    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ready",
          release: { digest, revision },
          dependencies: { database: "available" },
        }),
      );
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test readiness server did not bind a port");
    }

    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      TEST_DOCKER_LOG: runnerLog,
      UWPLAN_DEPLOY_TEST_ROOT: root,
      UWPLAN_DEPLOY_TEST_DOCKER_RUNNER: runner,
      UWPLAN_DEPLOY_TEST_DOCKER_LOG: runnerLog,
      UWPLAN_DEPLOY_TEST_COMPOSE_FILE: composeFile,
      UWPLAN_DEPLOY_TEST_RUNTIME_ENV: runtimeEnvironment,
      UWPLAN_DEPLOY_TEST_RELEASE_ENV: releaseEnvironment,
      UWPLAN_DEPLOY_TEST_READINESS_URL: `http://127.0.0.1:${address.port}/api/ready`,
      UWPLAN_DEPLOY_TEST_READINESS_ATTEMPTS: "1",
    };
    const invokeSync = (
      operation: string,
      args = [repository, digest, revision],
    ) =>
      spawnSync(process.execPath, [adapter, operation, ...args], {
        encoding: "utf8",
        env: environment,
      });
    const invokeAsync = (operation: string) =>
      new Promise<{ status: number | null; stderr: string }>(
        (resolveInvoke) => {
          const child = spawn(
            process.execPath,
            [adapter, operation, repository, digest, revision],
            { env: environment },
          );
          let stderr = "";
          child.stderr.on(
            "data",
            (chunk: Buffer) => (stderr += chunk.toString()),
          );
          child.once("exit", (status) => resolveInvoke({ status, stderr }));
        },
      );

    try {
      expect(invokeSync("migrate").status).toBe(0);
      expect(invokeSync("recreate-app").status).toBe(0);
      expect((await invokeAsync("wait-ready")).status).toBe(0);

      const dockerCalls = readFileSync(runnerLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(dockerCalls).toHaveLength(2);
      expect(dockerCalls[0]).toEqual([
        "compose",
        "--project-name",
        "uwplan",
        "--file",
        composeFile,
        "--env-file",
        runtimeEnvironment,
        "--env-file",
        expect.stringMatching(/release\.env\.candidate\.\d+$/),
        "--profile",
        "migration",
        "run",
        "--rm",
        "migrator",
      ]);
      expect(dockerCalls[1]).toEqual([
        "compose",
        "--project-name",
        "uwplan",
        "--file",
        composeFile,
        "--env-file",
        runtimeEnvironment,
        "--env-file",
        releaseEnvironment,
        "up",
        "--detach",
        "--no-deps",
        "--force-recreate",
        "app",
      ]);
      expect(readFileSync(releaseEnvironment, "utf8")).toBe(
        `UWPLAN_IMAGE=${repository}@${digest}\nRELEASE_DIGEST=${digest}\nRELEASE_REVISION=${revision}\n`,
      );

      const drifted = invokeSync("migrate", [digest, repository, revision]);
      expect(drifted.status).toBe(1);
      expect(drifted.stderr).toBe("invalid deployment adapter request\n");
      expect(readFileSync(runnerLog, "utf8").trim().split("\n")).toHaveLength(
        2,
      );

      const protocolUrl = pathToFileURL(
        join(process.cwd(), "ops/deploy/protocol.mjs"),
      ).href;
      const productionResolution = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import { allowsDisposableDockerRunner, ROOT_COMPOSE_HELPER } from ${JSON.stringify(protocolUrl)}; process.stdout.write(String(allowsDisposableDockerRunner(ROOT_COMPOSE_HELPER, process.env, ${JSON.stringify(tmpdir())})));`,
        ],
        { encoding: "utf8", env: environment },
      );
      expect(productionResolution).toEqual(
        expect.objectContaining({ status: 0, stdout: "false" }),
      );
    } finally {
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      rmSync(root, { recursive: true, force: true });
    }
  });
});
