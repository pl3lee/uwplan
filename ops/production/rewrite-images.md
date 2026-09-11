# Replacement release artifacts

The Go API and React Router server have separate production images. CI builds and checks them before paired publication and admission.
The rollback rehearsal uses the retained immutable legacy production artifact.

Build from the repository root:

```sh
docker build --build-arg RELEASE_REVISION="$(git rev-parse HEAD)" -f api/Dockerfile -t uwplan-api:local .
docker build --build-arg RELEASE_REVISION="$(git rev-parse HEAD)" -f web/Dockerfile -t uwplan-web:local .
UWPLAN_API_IMAGE=uwplan-api:local UWPLAN_WEB_IMAGE=uwplan-web:local bash tests/rewrite-images.sh
```

The API artifact includes `/app/api`, `/app/migrate`, `/app/courses-update`, and
`/app/seed`, including embedded migrations and template definitions. Run tooling
by overriding the image entrypoint, with secrets supplied only at runtime. The
server listens on port 8080; configuration is documented in `api/README.md`.

The web artifact contains the production build, server entry point, telemetry
module, and its production dependencies. It listens on port 3000 and requires an
internal `API_ORIGIN`. Workspace injection enables pnpm's dedicated deployment
lockfile, keeping root application dependencies out of this artifact; see the
[pnpm deployment documentation](https://pnpm.io/10.x/cli/deploy).

Both images run as non-root users, include an OCI source revision, and accept
runtime release digests for telemetry. Their health checks exercise the API's
liveness endpoint; release admission must additionally check dependency readiness
and both image identities. Base images are pinned by digest. Runtime containers
need neither source files nor build tools.

The `Replacement Images` workflow builds both artifacts on AMD64 runners and runs
the same disposable smoke test. That test migrates an empty PostgreSQL 16
database, starts Redis, checks readiness, sign-in and privacy pages, static assets,
and protected-route redirects. Only the web port is published on loopback. Web
and API run with read-only filesystems, dropped capabilities, and 128 MiB limits;
PostgreSQL has 160 MiB and Redis has 64 MiB with a 32 MiB data cap. These are smoke
test limits, not a production capacity claim; deployment rehearsal must validate
real workloads and telemetry on the shared host.

The test owns and removes its named containers and network. It never mounts a
production volume or reads production credentials. Failure output includes
fixture-container logs. The harness requires Docker, Bash, curl, jq, and Python 3.
