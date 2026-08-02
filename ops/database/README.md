# PostgreSQL candidate moves

`move-candidate.mjs` moves a complete PostgreSQL 16 database into a new
candidate identity. It does not accept database URLs, passwords, or tokens on
the command line. Both hosts read credentials from root-owned mode-`0600`
environment files, and the archive and manifest travel only inside SSH
sessions with forwarding disabled.

The utility image is pinned once in `protocol.mjs` and is used for capture,
archive listing, restore, and analysis. Capture holds one exported
repeatable-read snapshot while both `pg_dump` and the source metadata query
consume it. A custom archive is published by rename only after `pg_restore
--list` succeeds. Restore checks the transferred SHA-256, rejects an existing
candidate identity, creates `uwplan_candidate_<UTC run id>` from `template0`
with the source encoding and locale, restores as `uwplan_app` in one
transaction with exit-on-error, and runs `ANALYZE`.

## Protected host configuration

Install the repository at `/opt/uwplan/current` on both hosts and create a
mode-`0700` `/var/lib/uwplan-migration`. The source file
`/etc/uwplan/database-source.env` contains only `PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD`, `PGDATABASE`, and `UWPLAN_DB_DOCKER_NETWORK`. The target file
`/etc/uwplan/database-target.env` contains the same fields for a database
administrator that may create a fresh database and alter `uwplan_app`; it is
never used by the application.

Use a dedicated SSH key whose `authorized_keys` entry forces
`ops/database/forced-command.mjs`, disables forwarding, and has access only to
the fixed root-owned host command through the host's separately reviewed
privilege boundary:

```text
restrict,command="/opt/uwplan/current/ops/database/forced-command.mjs" ssh-ed25519 REPLACE_WITH_MIGRATION_PUBLIC_KEY uwplan-database-migration
```

The target runtime additionally needs `/etc/uwplan/runtime.env` and
`/var/lib/uwplan-runtime/release.env`. The runtime file names the protected
application, Alloy, app-role password, and administrator-password files. The
candidate app profile copies the protected app environment into its run
directory, replaces only the database pathname, boots without publishing a
port, calls `/api/ready` inside the container, then removes the container and
temporary environment file.

Run the operator-side command with only host identities in its environment:

```sh
UWPLAN_DB_SOURCE_HOST=migration-source \
UWPLAN_DB_TARGET_HOST=migration-target \
node ops/database/move-candidate.mjs 20260802T193000000Z
```

Success prints one sanitized JSON record. A checksum difference, non-listable
archive, reused database identity, restore error, unsafe role attributes, or
failed application readiness exits nonzero without emitting credentials.

`tests/database-candidate-command.test.ts` proves the SSH orchestration and
fail-closed gates with a fake transport. `tests/database-candidate.sh` uses two
disposable PostgreSQL instances and the built application image to prove the
snapshot, archive, restore, credential separation, fixture data, and readiness
path without production data or hosts.
