export const ADAPTER_OPERATIONS = Object.freeze([
  "migrate",
  "recreate-app",
  "wait-ready",
]);

export const ROOT_COMPOSE_HELPER =
  "/usr/local/libexec/uwplan-deploy/compose-adapter.mjs";
export const PRODUCTION_DISPATCHER =
  "/opt/uwplan/current/ops/deploy/forced-command.mjs";

const adapterOperationSet = new Set(ADAPTER_OPERATIONS);
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const revisionPattern = /^[A-Za-z0-9._-]{1,128}$/;
const repositoryPattern = /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?[a-z0-9._/-]+$/;

export function isDigest(value) {
  return typeof value === "string" && digestPattern.test(value);
}

export function isRevision(value) {
  return typeof value === "string" && revisionPattern.test(value);
}

export function isRepository(value) {
  return (
    typeof value === "string" &&
    repositoryPattern.test(value) &&
    !value.includes("..")
  );
}

export function parseAdapterRequest(argumentsList) {
  if (!Array.isArray(argumentsList) || argumentsList.length !== 4) return null;
  const [operation, repository, digest, revision] = argumentsList;
  if (
    !adapterOperationSet.has(operation) ||
    !isRepository(repository) ||
    !isDigest(digest) ||
    !isRevision(revision)
  ) {
    return null;
  }
  return Object.freeze({
    operation,
    repository,
    digest,
    revision,
    image: `${repository}@${digest}`,
  });
}

export function allowsDisposableDockerRunner(
  invokedPath,
  environment,
  temporaryDirectory,
) {
  return Boolean(
    invokedPath !== ROOT_COMPOSE_HELPER &&
      environment.NODE_ENV === "test" &&
      environment.UWPLAN_DEPLOY_TEST_ROOT?.startsWith(
        `${temporaryDirectory}/`,
      ) &&
      environment.UWPLAN_DEPLOY_TEST_DOCKER_RUNNER?.startsWith(
        `${temporaryDirectory}/`,
      ),
  );
}
