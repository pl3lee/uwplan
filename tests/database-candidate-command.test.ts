/** @jest-environment node */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const command = join(process.cwd(), "ops/database/move-candidate.mjs");
const utilityImage =
  "docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55";
const runId = "20260802T193000000Z";
const archiveSha256 =
  "56e4ad93e7ca743c19ff2734ebbe40bdb47d20d5efddf0cf12b66e427903621a";

function harness(
  options: { badReceiveHash?: boolean; unready?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "uwplan-db-command-"));
  const log = join(root, "ssh.jsonl");
  const ssh = join(root, "fake-ssh.mjs");
  writeFileSync(
    ssh,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const host = args[3];
const action = args[5];
const runId = args[6];
const extra = args.slice(7);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, host, action, runId, extra }) + "\\n");
const archive = Buffer.from("complete disposable postgres custom archive fixture");
const manifest = {
  schemaVersion: 1,
  runId,
  snapshotId: "00000003-0000001B-1",
  utilityVersionNum: "160014",
  utilityImage: ${JSON.stringify(utilityImage)},
  archive: { format: "custom", sha256: ${JSON.stringify(archiveSha256)}, complete: true, owners: false, privileges: false, filters: false, clusterGlobals: false, listable: true },
  source: { database: "fixture", serverVersionNum: "160014", encoding: "UTF8", collation: "C", ctype: "C" }
};
if (action === "capture") process.stdout.write(JSON.stringify(manifest));
else if (action === "receive-manifest") {
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  JSON.parse(input); process.stdout.write(JSON.stringify({ manifestReceived: true, runId }));
} else if (action === "stream-archive") process.stdout.write(archive);
else if (action === "receive-archive") {
  for await (const _ of process.stdin) {}
  process.stdout.write(JSON.stringify({ archiveReceived: true, runId, sha256: ${options.badReceiveHash ? '"0".repeat(64)' : JSON.stringify(archiveSha256)} }));
} else if (action === "restore") process.stdout.write(JSON.stringify({
  schemaVersion: 1, runId, candidateDatabase: "uwplan_candidate_" + runId,
  archiveSha256: ${JSON.stringify(archiveSha256)}, restored: true, singleTransaction: true,
  exitOnError: true, analyzed: true, databaseOwner: "uwplan_app",
  appRole: { login: true, superuser: false, createdb: false, createrole: false, replication: false, bypassRls: false }
}));
else if (action === "boot-candidate") process.stdout.write(JSON.stringify({
  schemaVersion: 1, runId, candidateDatabase: extra[0], applicationBooted: true,
  readiness: ${options.unready ? '"unready"' : '"ready"'}, databaseDependency: "available",
  applicationRole: "uwplan_app", release: { digest: "sha256:test", revision: "fixture" }
}));
else process.exit(64);
`,
  );
  chmodSync(ssh, 0o700);

  return {
    run() {
      return spawnSync(process.execPath, [command, runId], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          UWPLAN_DB_SSH_BIN: ssh,
          UWPLAN_DB_HOST_COMMAND: "/fixed/host-command.mjs",
          UWPLAN_DB_SOURCE_HOST: "migration-source",
          UWPLAN_DB_TARGET_HOST: "migration-target",
        },
      });
    },
    operations() {
      return readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("database candidate move command", () => {
  it("uses SSH for capture, protected transfer, fresh restore, and readiness", () => {
    const test = harness();
    try {
      const result = test.run();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          event: "database.candidate-move",
          status: "accepted",
          runId,
          utilityImage,
          archiveSha256,
          transfer: "ssh",
          candidateDatabase: `uwplan_candidate_${runId}`,
          applicationRole: "uwplan_app",
          readiness: "ready",
        }),
      );
      const operations = test.operations();
      const requested = operations.map(({ host, action }) => [host, action]);
      expect(requested.slice(0, 2)).toEqual([
        ["migration-source", "capture"],
        ["migration-target", "receive-manifest"],
      ]);
      expect(
        requested
          .slice(2, 4)
          .sort((left, right) =>
            String(left[1]).localeCompare(String(right[1])),
          ),
      ).toEqual([
        ["migration-target", "receive-archive"],
        ["migration-source", "stream-archive"],
      ]);
      expect(requested.slice(4)).toEqual([
        ["migration-target", "restore"],
        ["migration-target", "boot-candidate"],
      ]);
      for (const operation of operations) {
        expect(operation.args).toEqual(
          expect.arrayContaining([
            "-T",
            "-oBatchMode=yes",
            "-oClearAllForwardings=yes",
            "/fixed/host-command.mjs",
            runId,
          ]),
        );
      }
    } finally {
      test.cleanup();
    }
  });

  it("fails closed before restore when target SHA-256 evidence differs", () => {
    const test = harness({ badReceiveHash: true });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "protected transfer did not preserve the archive SHA-256\n",
      );
      const actions = test.operations().map(({ action }) => action);
      expect(actions.slice(0, 2)).toEqual(["capture", "receive-manifest"]);
      expect(actions.slice(2).sort()).toEqual([
        "receive-archive",
        "stream-archive",
      ]);
    } finally {
      test.cleanup();
    }
  });

  it("rejects a candidate whose application is not ready", () => {
    const test = harness({ unready: true });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "application candidate did not pass readiness\n",
      );
    } finally {
      test.cleanup();
    }
  });

  it("rejects SSH option injection before any transport is started", () => {
    const test = harness();
    try {
      const result = spawnSync(process.execPath, [command, runId], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          UWPLAN_DB_SSH_BIN: "/unused/fake-ssh",
          UWPLAN_DB_SOURCE_HOST: "-oProxyCommand=malicious",
          UWPLAN_DB_TARGET_HOST: "migration-target",
        },
      });
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("must be valid");
    } finally {
      test.cleanup();
    }
  });
});
