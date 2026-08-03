/** @jest-environment node */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const command = join(process.cwd(), "ops/database/prove-round-trip.mjs");
const utilityImage =
  "docker.io/library/postgres:16.14-bookworm@sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55";
const forwardRunId = "20260802T193000000Z";
const reverseRunId = "20260802T194000000Z";
const forwardSha256 = "a".repeat(64);
const reverseSha256 = "b".repeat(64);
const proofSha256 = "c".repeat(64);

function harness(
  options: {
    badTransferRunId?: string;
    failedRestoreRunId?: string;
    failedIntegrityRunId?: string;
    mismatchedWorkflowProof?: boolean;
    missingReleaseRunId?: string;
    wrongTargetVersionRunId?: string;
    unreadyRunId?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "uwplan-db-round-trip-"));
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
const forwardRunId = ${JSON.stringify(forwardRunId)};
const reverseRunId = ${JSON.stringify(reverseRunId)};
const sha256 = runId === forwardRunId ? ${JSON.stringify(forwardSha256)} : ${JSON.stringify(reverseSha256)};
const archive = Buffer.from("protected-" + runId);
const capture = {
  schemaVersion: 1, runId, snapshotId: "00000003-0000001B-1",
  utilityVersionNum: "160014", utilityImage: ${JSON.stringify(utilityImage)},
  archive: { format: "custom", sha256, complete: true, owners: false, privileges: false, filters: false, clusterGlobals: false, listable: true },
  source: { database: action === "capture-candidate" ? "uwplan_candidate_" + forwardRunId : "fixture", serverVersionNum: action === "capture-candidate" ? "160014" : "160006", encoding: "UTF8", collation: "C", ctype: "C" },
  integrity: { fixture: true },
  ...(action === "capture-candidate" ? { proofRunId: forwardRunId, workflowProofSha256: ${JSON.stringify(proofSha256)} } : {})
};
if (action === "capture" || action === "capture-candidate") process.stdout.write(JSON.stringify(capture));
else if (action === "receive-manifest") {
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  JSON.parse(input); process.stdout.write(JSON.stringify({ manifestReceived: true, runId }));
} else if (action === "stream-archive") process.stdout.write(archive);
else if (action === "receive-archive") {
  for await (const _ of process.stdin) {}
  process.stdout.write(JSON.stringify({ archiveReceived: true, runId, sha256: runId === ${JSON.stringify(options.badTransferRunId)} ? "0".repeat(64) : extra[0] }));
} else if (action === "restore") {
  if (runId === ${JSON.stringify(options.failedRestoreRunId)}) { process.stderr.write("restore failed\\n"); process.exit(1); }
  process.stdout.write(JSON.stringify({
  schemaVersion: 1, runId, candidateDatabase: "uwplan_candidate_" + runId,
  archiveSha256: sha256, targetVersionNum: runId === ${JSON.stringify(options.wrongTargetVersionRunId)} ? "160013" : "160014", restored: true, singleTransaction: true,
  exitOnError: true, analyzed: true, databaseOwner: "uwplan_app",
  appRole: { login: true, superuser: false, createdb: false, createrole: false, replication: false, bypassRls: false }
})); }
else if (action === "validate-integrity") process.stdout.write(JSON.stringify({
  schemaVersion: 1, event: "database.candidate-integrity", runId,
  candidateDatabase: extra[0],
  status: runId === ${JSON.stringify(options.failedIntegrityRunId)} ? "rejected" : "accepted",
  failedGates: runId === ${JSON.stringify(options.failedIntegrityRunId)} ? ["tables"] : [],
  sourceArchiveSha256: sha256,
  sourceSchemaSha256: "d".repeat(64), candidateSchemaSha256: "d".repeat(64),
  ordinaryTableCount: 17, sequenceCount: 1
}));
else if (action === "boot-candidate") process.stdout.write(JSON.stringify({
  schemaVersion: 1, runId, candidateDatabase: extra[0], applicationBooted: true,
  readiness: runId === ${JSON.stringify(options.unreadyRunId)} ? "unready" : "ready",
  databaseDependency: "available", applicationRole: "uwplan_app",
  release: runId === ${JSON.stringify(options.missingReleaseRunId)} ? {} : { digest: "sha256:" + "e".repeat(64), revision: "fixture" }
}));
else if (action === "write-candidate-workflow" || action === "verify-candidate-workflow") process.stdout.write(JSON.stringify({
  schemaVersion: 1, event: "database.workflow-proof",
  status: action === "write-candidate-workflow" ? "written" : "verified",
  proofRunId: forwardRunId, candidateDatabase: extra[0], applicationRole: "uwplan_app",
  workflow: "user-plan-schedule", recordCount: 3,
  proofSha256: action === "verify-candidate-workflow" && ${Boolean(options.mismatchedWorkflowProof)} ? "f".repeat(64) : ${JSON.stringify(proofSha256)}
}));
else process.exit(64);
`,
  );
  chmodSync(ssh, 0o700);

  return {
    run(environment: Record<string, string> = {}) {
      return spawnSync(
        process.execPath,
        [command, forwardRunId, reverseRunId],
        {
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            UWPLAN_DB_SSH_BIN: ssh,
            UWPLAN_DB_HOST_COMMAND: "/fixed/host-command.mjs",
            UWPLAN_DB_SOURCE_HOST: "racknerd-migration",
            UWPLAN_DB_TARGET_HOST: "digitalocean-migration",
            ...environment,
          },
        },
      );
    },
    operations() {
      if (!existsSync(log)) return [];
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

describe("database round-trip proof command", () => {
  it("proves forward restore, UWPlan writes, reverse restore, and preserved readiness", () => {
    const test = harness();
    try {
      const result = test.run();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        event: "database.round-trip-proof",
        status: "accepted",
        transfer: "ssh",
        utilityImage,
        sourceCapture: "live-consistent-read-only",
        servingDatabaseWritten: false,
        archives: { forward: "protected", reverse: "protected" },
        forward: {
          runId: forwardRunId,
          sourceVersionNum: "160006",
          targetVersionNum: "160014",
          archiveSha256: forwardSha256,
          candidateDatabase: `uwplan_candidate_${forwardRunId}`,
          integrity: "accepted",
          readiness: "ready",
          release: {
            digest: `sha256:${"e".repeat(64)}`,
            revision: "fixture",
          },
        },
        workflow: {
          name: "user-plan-schedule",
          status: "preserved",
          recordCount: 3,
          proofSha256,
        },
        reverse: {
          runId: reverseRunId,
          sourceVersionNum: "160014",
          targetVersionNum: "160014",
          archiveSha256: reverseSha256,
          candidateDatabase: `uwplan_candidate_${reverseRunId}`,
          integrity: "accepted",
          readiness: "ready",
          release: {
            digest: `sha256:${"e".repeat(64)}`,
            revision: "fixture",
          },
        },
      });

      const requested = test
        .operations()
        .map(({ host, action, runId }) => [host, action, runId]);
      expect(requested.slice(0, 2)).toEqual([
        ["racknerd-migration", "capture", forwardRunId],
        ["digitalocean-migration", "receive-manifest", forwardRunId],
      ]);
      expect(requested).toEqual(
        expect.arrayContaining([
          ["digitalocean-migration", "boot-candidate", forwardRunId],
          ["digitalocean-migration", "write-candidate-workflow", forwardRunId],
          ["digitalocean-migration", "capture-candidate", reverseRunId],
          ["racknerd-migration", "verify-candidate-workflow", reverseRunId],
          ["racknerd-migration", "boot-candidate", reverseRunId],
        ]),
      );
      for (const operation of test.operations()) {
        expect(operation.args).toEqual(
          expect.arrayContaining([
            "-T",
            "-oBatchMode=yes",
            "-oClearAllForwardings=yes",
            "/fixed/host-command.mjs",
          ]),
        );
      }
    } finally {
      test.cleanup();
    }
  });

  it("keeps both applications offline when forward integrity fails", () => {
    const test = harness({ failedIntegrityRunId: forwardRunId });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("candidate integrity rejected: tables\n");
      expect(test.operations().map(({ action }) => action)).not.toContain(
        "boot-candidate",
      );
      expect(test.operations().map(({ action }) => action)).not.toContain(
        "write-candidate-workflow",
      );
      expect(test.operations().map(({ action }) => action)).not.toContain(
        "capture-candidate",
      );
    } finally {
      test.cleanup();
    }
  });

  it("does not boot the reverse app when the workflow proof changed", () => {
    const test = harness({ mismatchedWorkflowProof: true });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "reverse UWPlan workflow proof was not preserved\n",
      );
      const reverseBoot = test
        .operations()
        .filter(
          ({ action, runId }) =>
            action === "boot-candidate" && runId === reverseRunId,
        );
      expect(reverseBoot).toHaveLength(0);
    } finally {
      test.cleanup();
    }
  });

  it("does not verify or boot a reverse candidate whose integrity fails", () => {
    const test = harness({ failedIntegrityRunId: reverseRunId });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("candidate integrity rejected: tables\n");
      const actions = test.operations().map(({ action }) => action);
      expect(actions).not.toContain("verify-candidate-workflow");
      expect(
        actions.filter((action) => action === "boot-candidate"),
      ).toHaveLength(1);
    } finally {
      test.cleanup();
    }
  });

  it.each([forwardRunId, reverseRunId])(
    "rejects unready application evidence for %s",
    (unreadyRunId) => {
      const test = harness({ unreadyRunId });
      try {
        const result = test.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toBe(
          "application candidate did not pass readiness\n",
        );
        expect(result.stdout).toBe("");
      } finally {
        test.cleanup();
      }
    },
  );

  it("rejects readiness that is not bound to an immutable release", () => {
    const test = harness({ missingReleaseRunId: forwardRunId });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "application candidate did not pass readiness\n",
      );
      expect(test.operations().map(({ action }) => action)).not.toContain(
        "write-candidate-workflow",
      );
    } finally {
      test.cleanup();
    }
  });

  it("fails before restore when a protected transfer hash differs", () => {
    const test = harness({ badTransferRunId: forwardRunId });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "protected transfer did not preserve the archive SHA-256\n",
      );
      expect(test.operations().map(({ action }) => action)).not.toContain(
        "restore",
      );
    } finally {
      test.cleanup();
    }
  });

  it("fails closed when the fresh reverse restore fails", () => {
    const test = harness({ failedRestoreRunId: reverseRunId });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("restore failed\n");
      const reverseActions = test
        .operations()
        .filter(({ runId }) => runId === reverseRunId)
        .map(({ action }) => action);
      expect(reverseActions).not.toContain("validate-integrity");
      expect(reverseActions).not.toContain("boot-candidate");
    } finally {
      test.cleanup();
    }
  });

  it("rejects a round-trip target that is not the pinned PostgreSQL patch", () => {
    const test = harness({ wrongTargetVersionRunId: forwardRunId });
    try {
      const result = test.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "fresh candidate restore did not satisfy the contract\n",
      );
      expect(test.operations().map(({ action }) => action)).not.toContain(
        "validate-integrity",
      );
    } finally {
      test.cleanup();
    }
  });

  it("rejects a same-host topology before SSH starts", () => {
    const test = harness();
    try {
      const result = test.run({
        UWPLAN_DB_SOURCE_HOST: "same-host",
        UWPLAN_DB_TARGET_HOST: "same-host",
      });
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("distinct source and target SSH hosts");
      expect(test.operations()).toEqual([]);
    } finally {
      test.cleanup();
    }
  });
});
