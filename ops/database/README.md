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

Before the candidate application may boot, `integrity.sh` derives source and
candidate manifests from repeatable-read snapshots and `integrity.mjs`
compares them. The contract requires exact PostgreSQL versions, the pinned
utility-image digest, locale/encoding, extensions, non-default tablespaces,
normalized schema, Drizzle ledger count/max-id/hash, every ordinary-table
count/content hash, and every sequence definition/value/`is_called` state. It
also rejects unvalidated constraints, invalid indexes, unsafe database/object
ownership, or elevated `uwplan_app` attributes.

Table rows pass directly from `COPY` into SHA-256; neither row serialization
nor row values are written to evidence, stdout, or stderr. Evidence contains
only identities, counts, digests, gate names, and the candidate/run identity.
The host writes a mode-`0600` acceptance marker only after every gate passes,
and `boot-candidate` refuses to run without that matching marker. A restore or
integrity failure writes a terminal rejection marker, keeps the candidate app
offline, and requires a new UTC run/candidate identity instead of repairing a
failed candidate in place.

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

Success prints one sanitized JSON record. A corruption/checksum difference,
version or locale drift, schema/ledger/table/sequence mismatch, invalid
constraint/index, unsafe ownership or role attributes, reused identity,
restore error, or failed application readiness exits nonzero without emitting
credentials or row values.

`tests/database-integrity.test.ts` and
`tests/database-candidate-command.test.ts` prove the exact comparison and SSH
failure matrix with fake infrastructure. `tests/database-candidate.sh` uses
two disposable PostgreSQL 16 instances and the built application image to
prove synchronized capture, exact privacy-safe integrity, restore, credential
separation, fixture data, and readiness without production data or hosts.
