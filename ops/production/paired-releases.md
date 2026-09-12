# Paired release admission

The staged deployer accepts both the retained `deploy DIGEST REVISION` command
and `deploy-pair API_DIGEST WEB_DIGEST REVISION`. Each digest must be a complete
SHA-256 digest, and the revision must be a full lowercase Git commit ID. CI cannot
supply a registry, Compose command, path, or arbitrary shell arguments.

The pair resolves to the fixed UWPlan API and web repositories. Both AMD64 images
must carry the requested source revision before migration or application changes.
The release file records both immutable image references, their digests, and the
shared revision. Compose receives no shell overrides for those release fields,
so it runs the images from the admitted file. Readiness checks require the API identity in the JSON body and
the web identity in `X-UWPlan-Web-Release-Digest` and
`X-UWPlan-Web-Release-Revision`. The web proxy discards upstream copies of these
headers before supplying its own identity.

## Stage before switching publication

Install the backward-compatible `deploy.py` and `compose.rewrite.yaml` alongside
the retained `compose.yaml`. Keep the current release file unchanged until a
paired release has passed its checks and is admitted. The existing database
volume, unprivileged application role, forced SSH command, deployment lock,
maintenance freeze, and pre-migration backup remain in use.

Create root-owned mode-0600 files under `/etc/uwplan-production`:

- `api.env`: restricted `DATABASE_URL`, authenticated `REDIS_URL`, `PUBLIC_ORIGIN`,
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`,
  and server OTLP settings.
- `web.env`: retained server settings. Compose supplies the private API origin and
  overrides OTLP endpoints/headers for both applications.
- `observability.env`: `POSTHOG_PROJECT_TOKEN=phc_...`, read only by the collector.
- `redis.env`: a nonempty `REDIS_PASSWORD` matching the API URL.

Retain `app.env`, `migrator.env`, and `postgres-admin-password` for compatibility.
Only the web service publishes a port, on loopback for the existing Caddy route.
Redis persists sessions in its own named volume and uses a 32 MB data limit with
no eviction, within a 64 MB container limit. API and web each have a 128 MB memory
limit; PostgreSQL retains its 160 MB limit and current major version.

Stage the PostHog collector and updated deployer using the reviewed
[`stage-observability.py`](stage-observability.py) procedure in
[observability/README.md](observability/README.md) before admitting the first
PostHog release. It validates both configurations under the deployment lock and
retains root-only rollback copies. The token is never supplied by CI's restricted
command. The collector adds a 256 MB hard memory cap (no swap) and bounded durable
queues; check actual host headroom before staging. Admission starts Redis and the
collector before migration or stopping writers. Normal releases and application
rollbacks do not recreate the collector or its queue volume.

## Failure and recovery

Admission backs up the database and runs the candidate migrator before stopping
the previous application services. A failed candidate restores the entire prior
release file and both previous services together. Compatible schema changes and
candidate writes remain in the database. A failed candidate-stop command triggers
removal of only its application containers, without deleting volumes. If that
also fails, admission reports that manual recovery is required and does not start
competing application writers.

For manual rollback, use the immutable identity in `previous.env` with its
matching command. A retained legacy release is supported while its migration
history and runtime configuration are installed. Reverting a database backup is
not an application rollback: doing so would discard writes since that backup.

## Disposable rehearsal

Pull the retained legacy AMD64 production artifact pinned in
`.github/workflows/rewrite-images.yml`; build the API and web images with their
source-revision labels. Then run `tests/paired-production-stack.py` with `UWPLAN_LEGACY_IMAGE`,
`UWPLAN_API_IMAGE`, and `UWPLAN_WEB_IMAGE` set to those local images. The driver
imports the actual admission implementation and uses owned temporary paths,
a registry bound to the Docker host loopback, and a unique Compose project. It does not change production
paths or add a production bypass flag.

The rehearsal boots a legacy database and saved account relationships, admits the
pair, writes through an unhealthy candidate, and checks paired rollback, retained
legacy usability, and backup restoration. The restored database receives the
application role grants and serves authenticated reads, CSV export, creation, and
deletion through that restricted role. Only its own containers, volumes,
networks, and temporary image tags are removed afterward. OAuth callback behavior
is separately covered by the shared browser suite; real-provider sign-in remains
a production cutover check.
