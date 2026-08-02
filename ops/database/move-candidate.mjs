#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { POSTGRES_UTILITY_IMAGE } from "./protocol.mjs";

const production = process.env.NODE_ENV !== "test";
const sshBinary = production
  ? "/usr/bin/ssh"
  : (process.env.UWPLAN_DB_SSH_BIN ?? "ssh");
const hostCommand = production
  ? "/opt/uwplan/current/ops/database/host-command.mjs"
  : (process.env.UWPLAN_DB_HOST_COMMAND ?? "/test/host-command.mjs");
const sourceHost = process.env.UWPLAN_DB_SOURCE_HOST ?? "";
const targetHost = process.env.UWPLAN_DB_TARGET_HOST ?? "";
const requestedRunId = process.argv[2];
const runId =
  requestedRunId ?? new Date().toISOString().replaceAll(/[-:.]/g, "");

const runIdPattern = /^[0-9]{8}T[0-9]{9}Z$/;
const hostPattern = /^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

if (!runIdPattern.test(runId)) fail("invalid UTC migration run identifier", 64);
if (!hostPattern.test(sourceHost) || !hostPattern.test(targetHost)) {
  fail("source and target SSH hosts are required and must be valid", 64);
}

function ssh(host, action, ...args) {
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
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function transferArchive(expectedSha256) {
  const sender = ssh(sourceHost, "stream-archive");
  const receiver = ssh(targetHost, "receive-archive", expectedSha256);
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
  return JSON.parse(receiverOutput);
}

try {
  const capture = JSON.parse(await collect(ssh(sourceHost, "capture")));
  if (
    capture.runId !== runId ||
    capture.utilityImage !== POSTGRES_UTILITY_IMAGE ||
    capture.utilityVersionNum !== "160014" ||
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

  const targetManifest = JSON.parse(
    await collect(
      ssh(targetHost, "receive-manifest"),
      `${JSON.stringify(capture)}\n`,
    ),
  );
  if (!targetManifest.manifestReceived || targetManifest.runId !== runId) {
    throw new Error("target did not accept the source manifest");
  }

  const transfer = await transferArchive(capture.archive.sha256);
  if (
    !transfer.archiveReceived ||
    transfer.runId !== runId ||
    transfer.sha256 !== capture.archive.sha256
  ) {
    throw new Error("protected transfer did not preserve the archive SHA-256");
  }

  const restore = JSON.parse(await collect(ssh(targetHost, "restore")));
  if (
    restore.runId !== runId ||
    restore.archiveSha256 !== capture.archive.sha256 ||
    restore.restored !== true ||
    restore.singleTransaction !== true ||
    restore.exitOnError !== true ||
    restore.analyzed !== true ||
    restore.databaseOwner !== "uwplan_app" ||
    restore.appRole?.login !== true ||
    Object.values({ ...restore.appRole, login: false }).some(Boolean)
  ) {
    throw new Error(
      "fresh candidate restore did not satisfy the restore contract",
    );
  }

  const integrity = JSON.parse(
    await collect(
      ssh(targetHost, "validate-integrity", restore.candidateDatabase),
    ),
  );
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

  const readiness = JSON.parse(
    await collect(ssh(targetHost, "boot-candidate", restore.candidateDatabase)),
  );
  if (
    readiness.runId !== runId ||
    readiness.candidateDatabase !== restore.candidateDatabase ||
    readiness.applicationBooted !== true ||
    readiness.readiness !== "ready" ||
    readiness.databaseDependency !== "available" ||
    readiness.applicationRole !== "uwplan_app"
  ) {
    throw new Error("application candidate did not pass readiness");
  }

  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      event: "database.candidate-move",
      status: "accepted",
      runId,
      utilityImage: POSTGRES_UTILITY_IMAGE,
      archiveSha256: capture.archive.sha256,
      transfer: "ssh",
      candidateDatabase: restore.candidateDatabase,
      integrity: "accepted",
      sourceSchemaSha256: integrity.sourceSchemaSha256,
      candidateSchemaSha256: integrity.candidateSchemaSha256,
      ordinaryTableCount: integrity.ordinaryTableCount,
      sequenceCount: integrity.sequenceCount,
      applicationRole: "uwplan_app",
      readiness: "ready",
      release: readiness.release,
    })}\n`,
  );
} catch (error) {
  fail(
    error instanceof Error ? error.message : "database candidate move failed",
  );
}
