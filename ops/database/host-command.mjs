#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { POSTGRES_UTILITY_IMAGE } from "./protocol.mjs";
import { compareIntegrity, isIntegrityManifest } from "./integrity.mjs";

const production = process.env.NODE_ENV !== "test";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const stateRoot = production
  ? "/var/lib/uwplan-migration"
  : (process.env.UWPLAN_DB_STATE_ROOT ?? "/tmp/uwplan-migration-test");
const sourceEnvironment = production
  ? "/etc/uwplan/database-source.env"
  : (process.env.UWPLAN_DB_SOURCE_ENV ?? "");
const targetEnvironment = production
  ? "/etc/uwplan/database-target.env"
  : (process.env.UWPLAN_DB_TARGET_ENV ?? "");
const runtimeEnvironment = production
  ? "/etc/uwplan/runtime.env"
  : (process.env.UWPLAN_DB_RUNTIME_ENV ?? "");
const releaseEnvironment = production
  ? "/var/lib/uwplan-runtime/release.env"
  : (process.env.UWPLAN_DB_RELEASE_ENV ?? "");
const composeFile = production
  ? "/opt/uwplan/current/compose.yaml"
  : (process.env.UWPLAN_DB_COMPOSE_FILE ?? "compose.yaml");
const dockerBinary = production
  ? "/usr/bin/docker"
  : (process.env.UWPLAN_DB_DOCKER_BIN ?? "docker");
const composeProject = production
  ? "uwplan"
  : (process.env.COMPOSE_PROJECT_NAME ?? "uwplan-candidate-test");

const runIdPattern = /^[0-9]{8}T[0-9]{9}Z$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const candidatePattern = /^uwplan_candidate_[0-9]{8}T[0-9]{9}Z$/;
const safeValuePattern = /^[A-Za-z0-9_.@-]+$/;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readEnvironment(path) {
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail(`invalid protected environment file: ${path}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function requireProtectedFile(path) {
  if (!path) fail("protected environment path is required");
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    fail(`protected environment must be a mode-0600 regular file: ${path}`);
  }
}

function runDirectory(runId) {
  if (!runIdPattern.test(runId))
    fail("invalid UTC migration run identifier", 64);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  const path = join(stateRoot, runId);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    if (options.throwOnFailure) {
      throw new Error(options.failureMessage ?? "candidate command failed");
    }
    fail(`required command failed to start: ${command}`);
  }
  if (result.status !== 0) {
    if (options.throwOnFailure) {
      throw new Error(options.failureMessage ?? "candidate command failed");
    }
    if (result.stderr) process.stderr.write(result.stderr);
    fail(options.failureMessage ?? "database candidate operation failed");
  }
  return result.stdout ?? "";
}

function utility(
  action,
  runId,
  environmentPath,
  extra = [],
  databaseOverride = "",
) {
  requireProtectedFile(environmentPath);
  const environment = readEnvironment(environmentPath);
  const network = environment.UWPLAN_DB_DOCKER_NETWORK;
  if (!network || !/^[A-Za-z0-9_.-]+$/.test(network)) {
    fail("protected database environment must name a Docker network");
  }
  const directory = runDirectory(runId);
  const script = join(scriptDirectory, `${action}.sh`);
  return run(
    dockerBinary,
    [
      "run",
      "--rm",
      "--network",
      network,
      "--env-file",
      environmentPath,
      "--env",
      `UWPLAN_DB_UTILITY_IMAGE=${POSTGRES_UTILITY_IMAGE}`,
      ...(databaseOverride ? ["--env", `PGDATABASE=${databaseOverride}`] : []),
      "--volume",
      `${directory}:/evidence`,
      "--volume",
      `${script}:/${action}.sh:ro`,
      "--volume",
      `${join(scriptDirectory, "integrity.sh")}:/integrity.sh:ro`,
      POSTGRES_UTILITY_IMAGE,
      "/bin/bash",
      `/${action}.sh`,
      runId,
      ...extra,
      "/evidence",
    ],
    { failureMessage: `${action} failed` },
  );
}

function requireAcceptedCandidate(runId, candidateDatabase) {
  if (!candidatePattern.test(candidateDatabase))
    fail("invalid candidate identity", 64);
  const acceptancePath = join(runDirectory(runId), "integrity-accepted.json");
  if (!existsSync(acceptancePath))
    fail("candidate has no accepted integrity evidence");
  const acceptance = JSON.parse(readFileSync(acceptancePath, "utf8"));
  if (
    acceptance.status !== "accepted" ||
    acceptance.runId !== runId ||
    acceptance.candidateDatabase !== candidateDatabase
  ) {
    fail("candidate integrity evidence does not match its identity");
  }
  return acceptance;
}

function sha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function loadManifest(directory) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "source-manifest.json"), "utf8"),
  );
  if (
    manifest?.schemaVersion !== 1 ||
    !runIdPattern.test(manifest?.runId ?? "") ||
    manifest?.utilityVersionNum !== "160014" ||
    manifest?.archive?.format !== "custom" ||
    !sha256Pattern.test(manifest?.archive?.sha256 ?? "") ||
    manifest?.archive?.complete !== true ||
    manifest?.archive?.owners !== false ||
    manifest?.archive?.privileges !== false ||
    manifest?.archive?.filters !== false ||
    manifest?.archive?.clusterGlobals !== false ||
    manifest?.archive?.listable !== true ||
    !/^16[0-9]{4}$/.test(manifest?.source?.serverVersionNum ?? "") ||
    Number(manifest?.source?.serverVersionNum) > 160014 ||
    !safeValuePattern.test(manifest?.source?.encoding ?? "") ||
    !safeValuePattern.test(manifest?.source?.collation ?? "") ||
    !safeValuePattern.test(manifest?.source?.ctype ?? "") ||
    !isIntegrityManifest(manifest?.integrity) ||
    manifest.integrity.runId !== manifest.runId
  ) {
    fail("source manifest failed validation");
  }
  return manifest;
}

async function receive(path, expectedSha256) {
  if (!sha256Pattern.test(expectedSha256)) fail("invalid expected SHA-256", 64);
  const partial = `${path}.partial`;
  rmSync(partial, { force: true });
  await pipeline(process.stdin, createWriteStream(partial, { mode: 0o600 }));
  chmodSync(partial, 0o600);
  const actualSha256 = sha256(partial);
  if (actualSha256 !== expectedSha256) {
    rmSync(partial, { force: true });
    fail("transferred artifact SHA-256 did not match");
  }
  renameSync(partial, path);
  return actualSha256;
}

function candidateEnvironment(runId, candidateDatabase, extra = {}) {
  requireProtectedFile(runtimeEnvironment);
  const runtime = readEnvironment(runtimeEnvironment);
  const applicationPath = runtime.UWPLAN_ENV_FILE;
  requireProtectedFile(applicationPath);
  const original = readFileSync(applicationPath, "utf8");
  let found = false;
  const rewritten = original.split(/\r?\n/).map((line) => {
    if (!/^\s*DATABASE_URL\s*=/.test(line)) return line;
    const raw = line
      .slice(line.indexOf("=") + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    const url = new URL(raw);
    if (decodeURIComponent(url.username) !== "uwplan_app") {
      fail("candidate app database URL must use uwplan_app");
    }
    url.pathname = `/${candidateDatabase}`;
    found = true;
    return `DATABASE_URL=${url.toString()}`;
  });
  if (!found) fail("application environment has no DATABASE_URL");
  for (const [key, value] of Object.entries(extra)) {
    if (
      !/^[A-Z][A-Z0-9_]*$/.test(key) ||
      typeof value !== "string" ||
      value.includes("\n")
    ) {
      fail("invalid candidate-only application environment");
    }
    rewritten.push(`${key}=${value}`);
  }
  const path = join(runDirectory(runId), "candidate-app.env");
  writeFileSync(path, `${rewritten.join("\n")}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { path, runtime };
}

function validateReadiness(body, release) {
  if (
    body.status !== "ready" ||
    body.dependencies?.database !== "available" ||
    !/^sha256:[0-9a-f]{64}$/.test(release.RELEASE_DIGEST ?? "") ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(release.RELEASE_REVISION ?? "") ||
    body.release?.digest !== release.RELEASE_DIGEST ||
    body.release?.revision !== release.RELEASE_REVISION
  ) {
    throw new Error(
      "candidate readiness release identity did not match protected state",
    );
  }
}

function removeCandidate(environment, path) {
  const removal = spawnSync(
    dockerBinary,
    [
      "compose",
      "--project-name",
      composeProject,
      "--file",
      composeFile,
      "rm",
      "--force",
      "--stop",
      "candidate-app",
    ],
    { env: environment, stdio: "ignore" },
  );
  rmSync(path, { force: true });
  if (removal.error || removal.status !== 0) {
    fail("candidate app cleanup failed");
  }
}

function bootCandidate(runId, candidateDatabase) {
  if (!candidatePattern.test(candidateDatabase))
    fail("invalid candidate identity", 64);
  requireProtectedFile(releaseEnvironment);
  const release = readEnvironment(releaseEnvironment);
  const { path, runtime } = candidateEnvironment(runId, candidateDatabase);
  const environment = {
    ...process.env,
    ...runtime,
    ...release,
    UWPLAN_CANDIDATE_ENV_FILE: path,
  };
  const compose = (args, options = {}) =>
    run(
      dockerBinary,
      [
        "compose",
        "--project-name",
        composeProject,
        "--file",
        composeFile,
        ...args,
      ],
      {
        env: environment,
        throwOnFailure: true,
        ...options,
      },
    );

  try {
    compose(
      ["--profile", "candidate", "up", "--detach", "--wait", "candidate-app"],
      {
        failureMessage: "candidate app did not become live",
      },
    );
    const readiness = compose(
      [
        "exec",
        "--no-TTY",
        "candidate-app",
        "node",
        "-e",
        "fetch('http://127.0.0.1:5000/api/ready').then(async response => { const body = await response.json(); if (!response.ok || body.status !== 'ready' || body.dependencies?.database !== 'available') process.exit(1); process.stdout.write(JSON.stringify(body)); }).catch(() => process.exit(1))",
      ],
      { failureMessage: "candidate readiness failed" },
    );
    const body = JSON.parse(readiness);
    validateReadiness(body, release);
    return {
      schemaVersion: 1,
      runId,
      candidateDatabase,
      applicationBooted: true,
      readiness: "ready",
      databaseDependency: "available",
      release: body.release,
      applicationRole: "uwplan_app",
    };
  } finally {
    removeCandidate(environment, path);
  }
}

function candidateWorkflow(runId, candidateDatabase, action, proofRunId) {
  requireAcceptedCandidate(runId, candidateDatabase);
  if (!runIdPattern.test(proofRunId))
    fail("invalid workflow proof run identifier", 64);
  requireProtectedFile(releaseEnvironment);
  const release = readEnvironment(releaseEnvironment);
  const token = randomBytes(32).toString("hex");
  const { path, runtime } = candidateEnvironment(runId, candidateDatabase, {
    UWPLAN_DEPLOYMENT_ENVIRONMENT: "candidate",
    UWPLAN_RESTORE_PROOF_ENABLED: "true",
    UWPLAN_RESTORE_PROOF_TOKEN: token,
  });
  const environment = {
    ...process.env,
    ...runtime,
    ...release,
    UWPLAN_CANDIDATE_ENV_FILE: path,
  };
  const compose = (args, options = {}) =>
    run(
      dockerBinary,
      [
        "compose",
        "--project-name",
        composeProject,
        "--file",
        composeFile,
        ...args,
      ],
      { env: environment, throwOnFailure: true, ...options },
    );
  try {
    compose(
      ["--profile", "candidate", "up", "--detach", "--wait", "candidate-app"],
      { failureMessage: "candidate app did not become live" },
    );
    const readiness = JSON.parse(
      compose(
        [
          "exec",
          "--no-TTY",
          "candidate-app",
          "node",
          "-e",
          "fetch('http://127.0.0.1:5000/api/ready').then(async response => { const body = await response.json(); if (!response.ok) process.exit(1); process.stdout.write(JSON.stringify(body)); }).catch(() => process.exit(1))",
        ],
        { failureMessage: "candidate readiness failed" },
      ),
    );
    validateReadiness(readiness, release);
    const output = compose(
      [
        "exec",
        "--no-TTY",
        "candidate-app",
        "node",
        "-e",
        `fetch('http://127.0.0.1:5000/api/candidate/restore-proof', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.UWPLAN_RESTORE_PROOF_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ action: '${action}', proofRunId: '${proofRunId}' }) }).then(async response => { const body = await response.json(); if (!response.ok) process.exit(1); process.stdout.write(JSON.stringify(body)); }).catch(() => process.exit(1))`,
      ],
      {
        failureMessage: "candidate workflow proof failed",
      },
    );
    const result = JSON.parse(output);
    const expectedStatus = action === "write" ? "written" : "verified";
    if (
      result.schemaVersion !== 1 ||
      result.event !== "database.workflow-proof" ||
      result.status !== expectedStatus ||
      result.proofRunId !== proofRunId ||
      result.candidateDatabase !== candidateDatabase ||
      result.applicationRole !== "uwplan_app" ||
      result.workflow !== "user-plan-schedule" ||
      result.recordCount !== 3 ||
      !sha256Pattern.test(result.proofSha256 ?? "")
    ) {
      throw new Error("candidate workflow evidence failed validation");
    }
    const evidencePath = join(
      runDirectory(runId),
      action === "write" ? "workflow-written.json" : "workflow-verified.json",
    );
    writeFileSync(evidencePath, `${JSON.stringify(result)}\n`, { mode: 0o600 });
    chmodSync(evidencePath, 0o600);
    return result;
  } finally {
    removeCandidate(environment, path);
  }
}

const [action, runId, ...arguments_] = process.argv.slice(2);
if (!action || !runId)
  fail("usage: host-command <action> <run-id> [arguments]", 64);
const directory = runDirectory(runId);

switch (action) {
  case "capture": {
    const manifestPath = join(directory, "source-manifest.json");
    if (!existsSync(manifestPath)) utility("capture", runId, sourceEnvironment);
    const manifest = loadManifest(directory);
    if (manifest.runId !== runId) fail("source manifest run identity mismatch");
    if (sha256(join(directory, "source.dump")) !== manifest.archive.sha256) {
      fail("published source archive SHA-256 did not match its manifest");
    }
    process.stdout.write(
      `${JSON.stringify({ ...manifest, utilityImage: POSTGRES_UTILITY_IMAGE })}\n`,
    );
    break;
  }
  case "capture-candidate": {
    const candidateDatabase = arguments_[0] ?? "";
    const sourceRunId = arguments_[1] ?? "";
    if (
      !runIdPattern.test(sourceRunId) ||
      candidateDatabase !== `uwplan_candidate_${sourceRunId}`
    ) {
      fail("candidate capture identity did not match its forward run", 64);
    }
    requireAcceptedCandidate(sourceRunId, candidateDatabase);
    const workflow = JSON.parse(
      readFileSync(
        join(runDirectory(sourceRunId), "workflow-written.json"),
        "utf8",
      ),
    );
    if (
      workflow.status !== "written" ||
      workflow.proofRunId !== sourceRunId ||
      workflow.candidateDatabase !== candidateDatabase ||
      !sha256Pattern.test(workflow.proofSha256 ?? "")
    ) {
      fail("candidate has no accepted UWPlan workflow write evidence");
    }
    const manifestPath = join(directory, "source-manifest.json");
    if (!existsSync(manifestPath)) {
      utility("capture", runId, targetEnvironment, [], candidateDatabase);
    }
    const manifest = loadManifest(directory);
    if (
      manifest.runId !== runId ||
      manifest.source.database !== candidateDatabase
    ) {
      fail("candidate capture source identity mismatch");
    }
    if (sha256(join(directory, "source.dump")) !== manifest.archive.sha256) {
      fail("published candidate archive SHA-256 did not match its manifest");
    }
    process.stdout.write(
      `${JSON.stringify({
        ...manifest,
        utilityImage: POSTGRES_UTILITY_IMAGE,
        proofRunId: sourceRunId,
        workflowProofSha256: workflow.proofSha256,
      })}\n`,
    );
    break;
  }
  case "stream-manifest": {
    process.stdout.write(readFileSync(join(directory, "source-manifest.json")));
    break;
  }
  case "receive-manifest": {
    const path = join(directory, "source-manifest.json");
    const partial = `${path}.partial`;
    await pipeline(process.stdin, createWriteStream(partial, { mode: 0o600 }));
    renameSync(partial, path);
    const manifest = loadManifest(directory);
    if (manifest.runId !== runId)
      fail("received manifest run identity mismatch");
    process.stdout.write(
      `${JSON.stringify({ manifestReceived: true, runId })}\n`,
    );
    break;
  }
  case "stream-archive": {
    await pipeline(
      createReadStream(join(directory, "source.dump")),
      process.stdout,
    );
    break;
  }
  case "receive-archive": {
    const actualSha256 = await receive(
      join(directory, "source.dump"),
      arguments_[0] ?? "",
    );
    process.stdout.write(
      `${JSON.stringify({ archiveReceived: true, runId, sha256: actualSha256 })}\n`,
    );
    break;
  }
  case "restore": {
    const manifest = loadManifest(directory);
    const actualSha256 = sha256(join(directory, "source.dump"));
    if (actualSha256 !== manifest.archive.sha256)
      fail("target archive SHA-256 mismatch");
    const candidateDatabase = `uwplan_candidate_${runId}`;
    const output = utility("restore", runId, targetEnvironment, [
      candidateDatabase,
      manifest.source.encoding,
      manifest.source.collation,
      manifest.source.ctype,
      manifest.archive.sha256,
    ]);
    process.stdout.write(output);
    break;
  }
  case "validate-integrity": {
    const candidateDatabase = arguments_[0] ?? "";
    if (!candidatePattern.test(candidateDatabase))
      fail("invalid candidate identity", 64);
    const manifest = loadManifest(directory);
    const acceptancePath = join(directory, "integrity-accepted.json");
    const rejectionPath = join(directory, "candidate-rejected.json");
    if (existsSync(rejectionPath))
      fail("failed candidate identity cannot be retried");
    rmSync(acceptancePath, { force: true });
    writeFileSync(
      rejectionPath,
      `${JSON.stringify({ schemaVersion: 1, runId, candidateDatabase, status: "validation-in-progress" })}\n`,
      { mode: 0o600 },
    );
    chmodSync(rejectionPath, 0o600);
    const candidate = JSON.parse(
      utility("integrity", runId, targetEnvironment, [candidateDatabase, "-"]),
    );
    const result = compareIntegrity(manifest.integrity, candidate);
    const evidence = {
      schemaVersion: 1,
      event: "database.candidate-integrity",
      runId,
      candidateDatabase,
      status: result.status,
      failedGates: result.failedGates,
      sourceArchiveSha256: manifest.archive.sha256,
      sourceSchemaSha256: manifest.integrity.schemaSha256,
      candidateSchemaSha256: candidate.schemaSha256,
      ordinaryTableCount: candidate.tables?.length ?? 0,
      sequenceCount: candidate.sequences?.length ?? 0,
    };
    const evidencePath = join(directory, "candidate-integrity.json");
    writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`, {
      mode: 0o600,
    });
    chmodSync(evidencePath, 0o600);
    if (result.status === "accepted") {
      writeFileSync(acceptancePath, `${JSON.stringify(evidence)}\n`, {
        mode: 0o600,
      });
      chmodSync(acceptancePath, 0o600);
      rmSync(rejectionPath, { force: true });
    } else {
      writeFileSync(rejectionPath, `${JSON.stringify(evidence)}\n`, {
        mode: 0o600,
      });
      chmodSync(rejectionPath, 0o600);
    }
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    break;
  }
  case "boot-candidate": {
    requireAcceptedCandidate(runId, arguments_[0] ?? "");
    try {
      const result = bootCandidate(runId, arguments_[0] ?? "");
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "candidate boot failed");
    }
    break;
  }
  case "write-candidate-workflow": {
    try {
      const result = candidateWorkflow(
        runId,
        arguments_[0] ?? "",
        "write",
        runId,
      );
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "candidate workflow failed",
      );
    }
    break;
  }
  case "verify-candidate-workflow": {
    try {
      const result = candidateWorkflow(
        runId,
        arguments_[0] ?? "",
        "verify",
        arguments_[1] ?? "",
      );
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "candidate workflow failed",
      );
    }
    break;
  }
  default:
    fail("unsupported database candidate host action", 64);
}
