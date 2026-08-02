/** @jest-environment node */

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const commandPath = join(process.cwd(), "ops/deploy/forced-command.mjs");
const candidateDigest = `sha256:${"a".repeat(64)}`;

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function makeHarness() {
  const root = mkdtempSync(join(tmpdir(), "uwplan-deploy-test-"));
  const stateDirectory = join(root, "state");
  const adapterLog = join(root, "adapter.jsonl");
  const adapter = join(root, "fake-adapter.mjs");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(
    adapter,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const [operation, ...args] = process.argv.slice(2);
appendFileSync(process.env.FAKE_ADAPTER_LOG, JSON.stringify({ operation, args }) + "\\n");
if (operation === "migrate" && process.env.FAKE_MIGRATION_DELAY_MS) {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_MIGRATION_DELAY_MS)));
}
if (operation === "migrate" && process.env.FAKE_FAIL_MIGRATION === "1") process.exit(42);
const unhealthy = (process.env.FAKE_UNHEALTHY_DIGESTS ?? "").split(",");
if (operation === "wait-ready" && unhealthy.includes(args[1])) process.exit(43);
`,
  );
  chmodSync(adapter, 0o700);

  return {
    root,
    stateDirectory,
    adapterLog,
    run(
      originalCommand: string,
      extraEnvironment: Record<string, string | undefined> = {},
    ) {
      return spawnSync(process.execPath, [commandPath], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          SSH_ORIGINAL_COMMAND: originalCommand,
          UWPLAN_DEPLOY_TEST_ADAPTER: adapter,
          UWPLAN_DEPLOY_STATE_DIR: stateDirectory,
          UWPLAN_IMAGE_REPOSITORY: "ghcr.io/pl3lee/uwplan",
          FAKE_ADAPTER_LOG: adapterLog,
          ...extraEnvironment,
        },
      }) as CommandResult;
    },
    runAsync(
      originalCommand: string,
      extraEnvironment: Record<string, string | undefined> = {},
    ) {
      return new Promise<CommandResult>((resolveRun) => {
        const child = spawn(process.execPath, [commandPath], {
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            TMPDIR: process.env.TMPDIR,
            SSH_ORIGINAL_COMMAND: originalCommand,
            UWPLAN_DEPLOY_TEST_ADAPTER: adapter,
            UWPLAN_DEPLOY_STATE_DIR: stateDirectory,
            UWPLAN_IMAGE_REPOSITORY: "ghcr.io/pl3lee/uwplan",
            FAKE_ADAPTER_LOG: adapterLog,
            ...extraEnvironment,
          },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on(
          "data",
          (chunk: Buffer) => (stdout += chunk.toString()),
        );
        child.stderr.on(
          "data",
          (chunk: Buffer) => (stderr += chunk.toString()),
        );
        child.once("exit", (status) => resolveRun({ status, stdout, stderr }));
      });
    },
    operations() {
      try {
        return readFileSync(adapterLog, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(
            (line) => JSON.parse(line) as { operation: string; args: string[] },
          );
      } catch {
        return [];
      }
    },
    state() {
      return JSON.parse(
        readFileSync(join(stateDirectory, "state.json"), "utf8"),
      ) as Record<string, unknown>;
    },
    seedState(state: Record<string, unknown>) {
      writeFileSync(
        join(stateDirectory, "state.json"),
        `${JSON.stringify(state)}\n`,
        { mode: 0o600 },
      );
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("restricted deployment command", () => {
  it("migrates, recreates only the app, verifies readiness, and records the immutable release", () => {
    const harness = makeHarness();

    try {
      const result = harness.run(`deploy ${candidateDigest} release-abc123`);

      expect(result).toEqual(
        expect.objectContaining({ status: 0, stderr: "" }),
      );
      expect(harness.operations()).toEqual([
        {
          operation: "migrate",
          args: ["ghcr.io/pl3lee/uwplan", candidateDigest, "release-abc123"],
        },
        {
          operation: "recreate-app",
          args: ["ghcr.io/pl3lee/uwplan", candidateDigest, "release-abc123"],
        },
        {
          operation: "wait-ready",
          args: ["ghcr.io/pl3lee/uwplan", candidateDigest, "release-abc123"],
        },
      ]);
      expect(harness.state()).toEqual(
        expect.objectContaining({
          frozen: false,
          previous: null,
          current: {
            digest: candidateDigest,
            revision: "release-abc123",
          },
          lastAttempt: expect.objectContaining({
            outcome: "deployed",
            schemaRollback: false,
          }),
        }),
      );
    } finally {
      harness.cleanup();
    }
  });

  it("restores the previous app image when candidate readiness fails without claiming schema rollback", () => {
    const harness = makeHarness();
    const previousDigest = `sha256:${"b".repeat(64)}`;
    const previous = { digest: previousDigest, revision: "release-previous" };
    harness.seedState({
      schemaVersion: 1,
      frozen: false,
      previous: null,
      current: previous,
      lastAttempt: null,
    });

    try {
      const result = harness.run(
        `deploy ${candidateDigest} release-candidate`,
        {
          FAKE_UNHEALTHY_DIGESTS: candidateDigest,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("previous app image restored");
      expect(harness.operations()).toEqual([
        {
          operation: "migrate",
          args: ["ghcr.io/pl3lee/uwplan", candidateDigest, "release-candidate"],
        },
        {
          operation: "recreate-app",
          args: ["ghcr.io/pl3lee/uwplan", candidateDigest, "release-candidate"],
        },
        {
          operation: "wait-ready",
          args: ["ghcr.io/pl3lee/uwplan", candidateDigest, "release-candidate"],
        },
        {
          operation: "recreate-app",
          args: ["ghcr.io/pl3lee/uwplan", previousDigest, "release-previous"],
        },
        {
          operation: "wait-ready",
          args: ["ghcr.io/pl3lee/uwplan", previousDigest, "release-previous"],
        },
      ]);
      expect(harness.state()).toEqual(
        expect.objectContaining({
          current: previous,
          lastAttempt: expect.objectContaining({
            previous,
            candidate: {
              digest: candidateDigest,
              revision: "release-candidate",
            },
            outcome: "readiness-rollback",
            schemaRollback: false,
          }),
        }),
      );
      const evidence = readFileSync(
        join(harness.stateDirectory, "evidence.jsonl"),
        "utf8",
      );
      expect(evidence).toContain('"databaseSchemaReversed":false');
      expect(evidence).toContain(`"restored":${JSON.stringify(previous)}`);
    } finally {
      harness.cleanup();
    }
  });

  it("records the running release as unknown when the previous image also fails readiness", () => {
    const harness = makeHarness();
    const previousDigest = `sha256:${"b".repeat(64)}`;
    const previous = { digest: previousDigest, revision: "release-previous" };
    harness.seedState({
      schemaVersion: 1,
      frozen: false,
      previous: null,
      current: previous,
      lastAttempt: null,
    });

    try {
      const result = harness.run(
        `deploy ${candidateDigest} release-candidate`,
        {
          FAKE_UNHEALTHY_DIGESTS: `${candidateDigest},${previousDigest}`,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("both failed readiness");
      expect(harness.state()).toEqual(
        expect.objectContaining({
          current: null,
          lastAttempt: expect.objectContaining({
            previous,
            outcome: "rollback-failed",
            schemaRollback: false,
          }),
        }),
      );
      const evidence = readFileSync(
        join(harness.stateDirectory, "evidence.jsonl"),
        "utf8",
      );
      expect(evidence).toContain(
        `"attemptedRestore":${JSON.stringify(previous)}`,
      );
      expect(evidence).toContain('"restored":null');
      expect(evidence).toContain('"rollbackHealthy":false');
    } finally {
      harness.cleanup();
    }
  });

  it("rejects an invalid digest before invoking the host adapter", () => {
    const harness = makeHarness();

    try {
      const result = harness.run("deploy latest release-abc123");

      expect(result.status).toBe(64);
      expect(result.stderr).toBe("requested manifest digest is invalid\n");
      expect(harness.operations()).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  it("serializes concurrent deployments through the exclusive lock", async () => {
    const harness = makeHarness();
    const secondDigest = `sha256:${"d".repeat(64)}`;

    try {
      const first = harness.runAsync(
        `deploy ${candidateDigest} release-first`,
        { FAKE_MIGRATION_DELAY_MS: "250" },
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (harness.operations()[0]?.args[1] === candidateDigest) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      expect(harness.operations()[0]?.args[1]).toBe(candidateDigest);
      const second = harness.runAsync(`deploy ${secondDigest} release-second`, {
        FAKE_MIGRATION_DELAY_MS: "250",
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.status).toBe(0);
      expect(secondResult.status).toBe(0);
      expect(
        harness.operations().map(({ operation, args }) => [operation, args[1]]),
      ).toEqual([
        ["migrate", candidateDigest],
        ["recreate-app", candidateDigest],
        ["wait-ready", candidateDigest],
        ["migrate", secondDigest],
        ["recreate-app", secondDigest],
        ["wait-ready", secondDigest],
      ]);
      expect(harness.state()).toEqual(
        expect.objectContaining({
          previous: {
            digest: candidateDigest,
            revision: "release-first",
          },
          current: {
            digest: secondDigest,
            revision: "release-second",
          },
        }),
      );
    } finally {
      harness.cleanup();
    }
  }, 10_000);

  it("leaves the running app unchanged when migration fails", () => {
    const harness = makeHarness();
    const previous = {
      digest: `sha256:${"c".repeat(64)}`,
      revision: "release-previous",
    };
    harness.seedState({
      schemaVersion: 1,
      frozen: false,
      previous: null,
      current: previous,
      lastAttempt: null,
    });

    try {
      const result = harness.run(
        `deploy ${candidateDigest} release-candidate`,
        {
          FAKE_FAIL_MIGRATION: "1",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("release migration failed\n");
      expect(harness.operations()).toEqual([
        {
          operation: "migrate",
          args: ["ghcr.io/pl3lee/uwplan", candidateDigest, "release-candidate"],
        },
      ]);
      expect(harness.state()).toEqual(
        expect.objectContaining({
          current: previous,
          lastAttempt: expect.objectContaining({
            outcome: "migration-failed",
            schemaRollback: false,
          }),
        }),
      );
    } finally {
      harness.cleanup();
    }
  });

  it("freezes and thaws idempotently without releasing an image", () => {
    const harness = makeHarness();

    try {
      expect(harness.run("freeze").status).toBe(0);
      expect(harness.run("freeze").status).toBe(0);
      expect(harness.state()).toEqual(
        expect.objectContaining({ frozen: true, current: null }),
      );

      expect(harness.run("thaw").status).toBe(0);
      expect(harness.run("thaw").status).toBe(0);
      expect(harness.state()).toEqual(
        expect.objectContaining({ frozen: false, current: null }),
      );
      expect(harness.operations()).toEqual([]);

      const evidence = readFileSync(
        join(harness.stateDirectory, "evidence.jsonl"),
        "utf8",
      );
      expect(evidence).toContain('"changed":false');
      expect(evidence).toContain('"imageReleased":false');
    } finally {
      harness.cleanup();
    }
  });

  it("does not expose a general shell through the forced command", () => {
    const harness = makeHarness();

    try {
      const result = harness.run("sh -c id");

      expect(result.status).toBe(64);
      expect(result.stderr).toBe("command is not permitted\n");
      expect(harness.operations()).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
