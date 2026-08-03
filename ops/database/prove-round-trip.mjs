#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import {
  POSTGRES_MAJOR_VERSION,
  POSTGRES_UTILITY_IMAGE,
  POSTGRES_UTILITY_VERSION_NUM,
} from "./protocol.mjs";

const production = process.env.NODE_ENV !== "test";
const sshBinary = production
  ? "/usr/bin/ssh"
  : (process.env.UWPLAN_DB_SSH_BIN ?? "ssh");
const hostCommand = production
  ? "/opt/uwplan/current/ops/database/host-command.mjs"
  : (process.env.UWPLAN_DB_HOST_COMMAND ?? "/test/host-command.mjs");
const sourceHost = process.env.UWPLAN_DB_SOURCE_HOST ?? "";
const targetHost = process.env.UWPLAN_DB_TARGET_HOST ?? "";
const [forwardRunId, reverseRunId] = process.argv.slice(2);

const runIdPattern = /^[0-9]{8}T[0-9]{9}Z$/;
const hostPattern = /^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const releaseDigestPattern = /^sha256:[0-9a-f]{64}$/;
const releaseRevisionPattern = /^[A-Za-z0-9_.-]{1,128}$/;
const versionPattern = /^[0-9]{6}$/;

function majorVersion(version) {
  return version.slice(0, -4);
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

if (
  !runIdPattern.test(forwardRunId ?? "") ||
  !runIdPattern.test(reverseRunId ?? "") ||
  forwardRunId === reverseRunId
) {
  fail("distinct forward and reverse UTC run identifiers are required", 64);
}
if (
  !hostPattern.test(sourceHost) ||
  !hostPattern.test(targetHost) ||
  sourceHost === targetHost
) {
  fail(
    "distinct source and target SSH hosts are required and must be valid",
    64,
  );
}

function ssh(host, action, runId, ...args) {
  return spawn(
    sshBinary,
    [
      "-T",
      "-oBatchMode=yes",
      "-oClearAllForwardings=yes",
      host,
      hostCommand,
      action,
      runId,
      ...args,
    ],
    { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] },
  );
}

function collect(child, input) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", () =>
      reject(new Error("SSH transport failed to start")),
    );
    child.once("close", (status) => {
      if (status !== 0)
        reject(new Error(stderr.trim() || "remote operation failed"));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

async function json(child, input) {
  return JSON.parse(await collect(child, input));
}

async function transferArchive(source, target, runId, expectedSha256) {
  const sender = ssh(source, "stream-archive", runId);
  const receiver = ssh(target, "receive-archive", runId, expectedSha256);
  let senderError = "";
  let receiverOutput = "";
  let receiverError = "";
  sender.stderr.setEncoding("utf8");
  receiver.stdout.setEncoding("utf8");
  receiver.stderr.setEncoding("utf8");
  sender.stderr.on("data", (chunk) => (senderError += chunk));
  receiver.stdout.on("data", (chunk) => (receiverOutput += chunk));
  receiver.stderr.on("data", (chunk) => (receiverError += chunk));

  const senderClosed = new Promise((resolve, reject) => {
    sender.once("error", () =>
      reject(new Error("source SSH transport failed")),
    );
    sender.once("close", (status) =>
      status === 0
        ? resolve()
        : reject(
            new Error(senderError.trim() || "source archive stream failed"),
          ),
    );
  });
  const receiverClosed = new Promise((resolve, reject) => {
    receiver.once("error", () =>
      reject(new Error("target SSH transport failed")),
    );
    receiver.once("close", (status) =>
      status === 0
        ? resolve()
        : reject(
            new Error(receiverError.trim() || "target archive receive failed"),
          ),
    );
  });
  await Promise.all([
    pipeline(sender.stdout, receiver.stdin),
    senderClosed,
    receiverClosed,
  ]);
  const transfer = JSON.parse(receiverOutput);
  if (
    transfer.archiveReceived !== true ||
    transfer.runId !== runId ||
    transfer.sha256 !== expectedSha256
  ) {
    throw new Error("protected transfer did not preserve the archive SHA-256");
  }
}

function validateCapture(capture, runId) {
  if (
    capture.runId !== runId ||
    capture.utilityImage !== POSTGRES_UTILITY_IMAGE ||
    capture.utilityVersionNum !== POSTGRES_UTILITY_VERSION_NUM ||
    typeof capture.source?.serverVersionNum !== "string" ||
    !versionPattern.test(capture.source.serverVersionNum) ||
    majorVersion(capture.source.serverVersionNum) !== POSTGRES_MAJOR_VERSION ||
    Number(capture.source.serverVersionNum) >
      Number(POSTGRES_UTILITY_VERSION_NUM) ||
    capture.archive?.format !== "custom" ||
    !sha256Pattern.test(capture.archive?.sha256 ?? "") ||
    capture.archive?.complete !== true ||
    capture.archive?.owners !== false ||
    capture.archive?.privileges !== false ||
    capture.archive?.filters !== false ||
    capture.archive?.clusterGlobals !== false ||
    capture.archive?.listable !== true
  ) {
    throw new Error("source capture did not satisfy the archive contract");
  }
}

function validateRestore(restore, capture, runId) {
  if (
    restore.runId !== runId ||
    restore.archiveSha256 !== capture.archive.sha256 ||
    restore.targetVersionNum !== POSTGRES_UTILITY_VERSION_NUM ||
    majorVersion(restore.targetVersionNum) !==
      majorVersion(capture.source.serverVersionNum) ||
    restore.candidateDatabase !== `uwplan_candidate_${runId}` ||
    restore.restored !== true ||
    restore.singleTransaction !== true ||
    restore.exitOnError !== true ||
    restore.analyzed !== true ||
    restore.databaseOwner !== "uwplan_app" ||
    restore.migrationRole?.name !== "uwplan_migration_admin" ||
    restore.migrationRole?.login !== true ||
    restore.migrationRole?.createdb !== true ||
    restore.migrationRole?.createrole !== false ||
    restore.migrationRole?.appRoleAdmin !== false ||
    restore.migrationRole?.appRoleInherit !== false ||
    restore.migrationRole?.appRoleSet !== true ||
    Object.values({
      superuser: restore.migrationRole?.superuser,
      replication: restore.migrationRole?.replication,
      bypassRls: restore.migrationRole?.bypassRls,
    }).some((value) => value !== false) ||
    restore.appRole?.login !== true ||
    Object.values({ ...restore.appRole, login: false }).some(Boolean)
  ) {
    throw new Error("fresh candidate restore did not satisfy the contract");
  }
}

function validateIntegrity(integrity, restore, capture, runId) {
  if (
    integrity.runId !== runId ||
    integrity.candidateDatabase !== restore.candidateDatabase ||
    integrity.status !== "accepted" ||
    !Array.isArray(integrity.failedGates) ||
    integrity.failedGates.length !== 0 ||
    integrity.sourceArchiveSha256 !== capture.archive.sha256
  ) {
    const gates = Array.isArray(integrity.failedGates)
      ? integrity.failedGates.join(",")
      : "manifest";
    throw new Error(`candidate integrity rejected: ${gates}`);
  }
}

function validateReadiness(readiness, restore, runId) {
  if (
    readiness.runId !== runId ||
    readiness.candidateDatabase !== restore.candidateDatabase ||
    readiness.applicationBooted !== true ||
    readiness.readiness !== "ready" ||
    readiness.databaseDependency !== "available" ||
    readiness.applicationRole !== "uwplan_app" ||
    !releaseDigestPattern.test(readiness.release?.digest ?? "") ||
    !releaseRevisionPattern.test(readiness.release?.revision ?? "")
  ) {
    throw new Error("application candidate did not pass readiness");
  }
}

async function move({
  source,
  target,
  runId,
  captureAction,
  captureArgs = [],
}) {
  const capture = await json(ssh(source, captureAction, runId, ...captureArgs));
  validateCapture(capture, runId);
  const received = await json(
    ssh(target, "receive-manifest", runId),
    `${JSON.stringify(capture)}\n`,
  );
  if (received.manifestReceived !== true || received.runId !== runId) {
    throw new Error("target did not accept the source manifest");
  }
  await transferArchive(source, target, runId, capture.archive.sha256);
  const restore = await json(ssh(target, "restore", runId));
  validateRestore(restore, capture, runId);
  const integrity = await json(
    ssh(target, "validate-integrity", runId, restore.candidateDatabase),
  );
  validateIntegrity(integrity, restore, capture, runId);
  return { capture, restore, integrity };
}

try {
  const forward = await move({
    source: sourceHost,
    target: targetHost,
    runId: forwardRunId,
    captureAction: "capture",
  });
  const forwardReadiness = await json(
    ssh(
      targetHost,
      "boot-candidate",
      forwardRunId,
      forward.restore.candidateDatabase,
    ),
  );
  validateReadiness(forwardReadiness, forward.restore, forwardRunId);
  const workflowWrite = await json(
    ssh(
      targetHost,
      "write-candidate-workflow",
      forwardRunId,
      forward.restore.candidateDatabase,
    ),
  );
  if (
    workflowWrite.status !== "written" ||
    workflowWrite.proofRunId !== forwardRunId ||
    workflowWrite.candidateDatabase !== forward.restore.candidateDatabase ||
    workflowWrite.applicationRole !== "uwplan_app" ||
    workflowWrite.workflow !== "user-plan-schedule" ||
    workflowWrite.recordCount !== 3 ||
    !sha256Pattern.test(workflowWrite.proofSha256 ?? "")
  ) {
    throw new Error("forward UWPlan workflow write was not accepted");
  }

  const reverse = await move({
    source: targetHost,
    target: sourceHost,
    runId: reverseRunId,
    captureAction: "capture-candidate",
    captureArgs: [forward.restore.candidateDatabase, forwardRunId],
  });
  if (
    reverse.capture.proofRunId !== forwardRunId ||
    reverse.capture.source?.database !== forward.restore.candidateDatabase ||
    reverse.capture.workflowProofSha256 !== workflowWrite.proofSha256
  ) {
    throw new Error("reverse capture did not bind the workflow proof");
  }
  const workflowVerify = await json(
    ssh(
      sourceHost,
      "verify-candidate-workflow",
      reverseRunId,
      reverse.restore.candidateDatabase,
      forwardRunId,
    ),
  );
  if (
    workflowVerify.status !== "verified" ||
    workflowVerify.proofRunId !== forwardRunId ||
    workflowVerify.candidateDatabase !== reverse.restore.candidateDatabase ||
    workflowVerify.applicationRole !== "uwplan_app" ||
    workflowVerify.workflow !== "user-plan-schedule" ||
    workflowVerify.recordCount !== 3 ||
    workflowVerify.proofSha256 !== workflowWrite.proofSha256
  ) {
    throw new Error("reverse UWPlan workflow proof was not preserved");
  }
  const reverseReadiness = await json(
    ssh(
      sourceHost,
      "boot-candidate",
      reverseRunId,
      reverse.restore.candidateDatabase,
    ),
  );
  validateReadiness(reverseReadiness, reverse.restore, reverseRunId);

  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      event: "database.round-trip-proof",
      status: "accepted",
      transfer: "ssh",
      utilityImage: POSTGRES_UTILITY_IMAGE,
      sourceCapture: "live-consistent-read-only",
      servingDatabaseWritten: false,
      archives: { forward: "protected", reverse: "protected" },
      forward: {
        runId: forwardRunId,
        sourceVersionNum: forward.capture.source.serverVersionNum,
        targetVersionNum: forward.restore.targetVersionNum,
        archiveSha256: forward.capture.archive.sha256,
        candidateDatabase: forward.restore.candidateDatabase,
        integrity: "accepted",
        readiness: "ready",
        release: forwardReadiness.release,
      },
      workflow: {
        name: "user-plan-schedule",
        status: "preserved",
        recordCount: workflowVerify.recordCount,
        proofSha256: workflowVerify.proofSha256,
      },
      reverse: {
        runId: reverseRunId,
        sourceVersionNum: reverse.capture.source.serverVersionNum,
        targetVersionNum: reverse.restore.targetVersionNum,
        archiveSha256: reverse.capture.archive.sha256,
        candidateDatabase: reverse.restore.candidateDatabase,
        integrity: "accepted",
        readiness: "ready",
        release: reverseReadiness.release,
      },
    })}\n`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "database round trip failed");
}
