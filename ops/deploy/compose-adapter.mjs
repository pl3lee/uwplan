#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  allowsDisposableDockerRunner,
  parseAdapterRequest,
} from "./protocol.mjs";

const request = parseAdapterRequest(process.argv.slice(2));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!request) fail("invalid deployment adapter request");

const testRoot = process.env.UWPLAN_DEPLOY_TEST_ROOT;
const disposableTestMode = allowsDisposableDockerRunner(
  realpathSync(process.argv[1]),
  process.env,
  tmpdir(),
);
const deployRoot = resolve(
  disposableTestMode ? testRoot : "/opt/uwplan/current",
);
const composeFile = resolve(
  disposableTestMode
    ? (process.env.UWPLAN_DEPLOY_TEST_COMPOSE_FILE ??
        `${deployRoot}/compose.yaml`)
    : "/opt/uwplan/current/compose.yaml",
);
const runtimeEnvironment = resolve(
  disposableTestMode
    ? (process.env.UWPLAN_DEPLOY_TEST_RUNTIME_ENV ??
        `${deployRoot}/runtime.env`)
    : "/etc/uwplan/runtime.env",
);
const releaseEnvironment = resolve(
  disposableTestMode
    ? (process.env.UWPLAN_DEPLOY_TEST_RELEASE_ENV ??
        `${deployRoot}/release.env`)
    : "/var/lib/uwplan-runtime/release.env",
);
const readinessUrl = disposableTestMode
  ? (process.env.UWPLAN_DEPLOY_TEST_READINESS_URL ??
    "http://127.0.0.1:5000/api/ready")
  : "http://127.0.0.1:5000/api/ready";
const readinessAttempts = Number(
  disposableTestMode
    ? (process.env.UWPLAN_DEPLOY_TEST_READINESS_ATTEMPTS ?? "1")
    : "30",
);
const readinessIntervalMs = Number(disposableTestMode ? "0" : "2000");
const dockerRunner = disposableTestMode
  ? process.env.UWPLAN_DEPLOY_TEST_DOCKER_RUNNER
  : "docker";

const release = {
  image: request.image,
  digest: request.digest,
  revision: request.revision,
};

function releaseEnvironmentContents() {
  return [
    `UWPLAN_IMAGE=${release.image}`,
    `RELEASE_DIGEST=${release.digest}`,
    `RELEASE_REVISION=${release.revision}`,
    "",
  ].join("\n");
}

function writeReleaseEnvironment(target) {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${Date.now()}`;
  writeFileSync(temporary, releaseEnvironmentContents(), { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
}

function compose(environmentFile, args) {
  const result = spawnSync(
    dockerRunner,
    [
      "compose",
      "--project-name",
      "uwplan",
      "--file",
      composeFile,
      "--env-file",
      runtimeEnvironment,
      "--env-file",
      environmentFile,
      ...args,
    ],
    {
      cwd: deployRoot,
      encoding: "utf8",
      env: disposableTestMode
        ? {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            TEST_DOCKER_LOG: process.env.UWPLAN_DEPLOY_TEST_DOCKER_LOG,
          }
        : { PATH: process.env.PATH },
      timeout: 9 * 60 * 1000,
    },
  );
  return result.error === undefined && result.status === 0;
}

async function waitUntilReady() {
  if (
    !Number.isSafeInteger(readinessAttempts) ||
    readinessAttempts < 1 ||
    !Number.isSafeInteger(readinessIntervalMs) ||
    readinessIntervalMs < 0
  ) {
    return false;
  }
  for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
    try {
      const response = await fetch(readinessUrl, {
        signal: AbortSignal.timeout(3_000),
      });
      const body = await response.json();
      if (
        response.ok &&
        body?.status === "ready" &&
        body?.release?.digest === release.digest &&
        body?.release?.revision === release.revision
      ) {
        return true;
      }
    } catch {
      // Readiness is retried until the bounded deadline below.
    }
    if (attempt + 1 < readinessAttempts) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, readinessIntervalMs),
      );
    }
  }
  return false;
}

if (request.operation === "migrate") {
  const candidateEnvironment = `${releaseEnvironment}.candidate.${process.pid}`;
  try {
    writeReleaseEnvironment(candidateEnvironment);
    if (
      !compose(candidateEnvironment, [
        "--profile",
        "migration",
        "run",
        "--rm",
        "migrator",
      ])
    ) {
      fail("backward-compatible release migration failed");
    }
  } finally {
    rmSync(candidateEnvironment, { force: true });
  }
} else if (request.operation === "recreate-app") {
  writeReleaseEnvironment(releaseEnvironment);
  if (
    !compose(releaseEnvironment, [
      "up",
      "--detach",
      "--no-deps",
      "--force-recreate",
      "app",
    ])
  ) {
    fail("application recreation failed");
  }
} else if (!(await waitUntilReady())) {
  fail("application readiness did not admit the requested release");
}
