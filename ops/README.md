# UWPlan runtime stack

`compose.yaml` owns only the `uwplan` application, PostgreSQL, one-shot migrator, Alloy, and their project-scoped volumes and network. Caddy remains a host service and imports `ops/caddy/Caddyfile`.

The Compose environment must provide:

- `UWPLAN_IMAGE`: the application manifest reference (`ghcr.io/pl3lee/uwplan@sha256:…` in production);
- `RELEASE_DIGEST` and `RELEASE_REVISION`: the identity returned by readiness;
- `UWPLAN_ENV_FILE`: a mode-`0600` file containing application secrets and `DATABASE_URL`; and
- `POSTGRES_PASSWORD_FILE`: a mode-`0600` file containing only the database password.

Start the dependencies, run the release's one-shot migration, then admit the app:

```sh
docker compose up --detach --wait db alloy
docker compose --profile migration run --rm migrator
docker compose up --detach --wait app
```

Stopping or running `docker compose down` preserves PostgreSQL data. Deleting the named volume is intentionally not part of the lifecycle. Commands must always target this Compose file/project; no fixed container names or global cleanup are used, so neighboring workloads remain outside its scope.

Production Caddy reaches the backend on `127.0.0.1:5000` and uses normal automatic HTTPS when the test-only variables are unset. The disposable integration test changes the site addresses and sets the complete optional `UWPLAN_CADDY_TLS_DIRECTIVE` to `tls internal`; production leaves it empty until the separately approved origin-certificate work installs explicit TLS configuration.
