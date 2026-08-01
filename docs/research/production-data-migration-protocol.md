# Production data migration and recovery protocol

## Decision

Use a full PostgreSQL 16 logical backup in custom archive format for both the rehearsal and final migration. Restore every archive into a newly created candidate database, never over an in-use database, with ownership and ACLs remapped to a dedicated non-superuser `uwplan_app` role. Promote a candidate only after checksum, restore, schema, migration-ledger, row-count, content-fingerprint, sequence, constraint, index, and ownership gates all pass.

The initial rehearsal may be copied while RackNerd remains live because `pg_dump` takes an internally consistent snapshot without blocking readers or writers. The final copy is made only after the RackNerd application and every writer have stopped and the database reports no remaining application sessions. That gives the final archive a clean acknowledged-write boundary. PostgreSQL documents both the consistency guarantee and the fact that `pg_dump` does not block ordinary database use ([SQL dump documentation](https://www.postgresql.org/docs/16/backup-dump.html), [pg_dump reference](https://www.postgresql.org/docs/16/app-pgdump.html)).

Once the DigitalOcean application is allowed to accept production traffic, RackNerd is stale. A rollback from that point is itself a reverse migration: stop DigitalOcean writes, dump DigitalOcean, restore and validate a new RackNerd candidate, then repoint traffic. Never simply restart the old RackNerd application against its pre-cutover database.

## Read-only baseline observed on 2026-08-01

- Production is PostgreSQL 16.6 in `postgres:16-alpine`; its bundled `pg_dump` and `pg_restore` are 16.6.
- The source image currently resolves to `postgres@sha256:52bba373df3c13594014b5e9ccc9f3c2cdb2221d50db1a91ec64570819f18aba`.
- The `uwplan` database is 26 MB, UTF-8, libc locale `en_US.utf8`, and owned by the `postgres` superuser.
- `postgres` is the only non-system role. The application currently connects as that superuser. Do not reproduce this on DigitalOcean.
- The only extension is `plpgsql`; there are no custom tablespaces and no unlogged relations.
- There are 16 application/migration tables across `public` and `drizzle`. `drizzle.__drizzle_migrations` has 10 rows with maximum id 10, matching the repository's ten migrations, `0000` through `0009`.
- The only sequence is `drizzle.__drizzle_migrations_id_seq`, currently at 10. Sequence state still must be captured and compared on every run; it must not be hard-coded from this observation.
- DigitalOcean does not yet run a uwplan PostgreSQL container.

These facts are evidence for this decision, not constants for the execution script. The script must rediscover and record them immediately before each dump.

## Version and archive format

1. Pin DigitalOcean to a specific, current PostgreSQL **16.x** image digest for both rehearsal and cutover. Record the image digest plus `postgres`, `pg_dump`, and `pg_restore` versions in the evidence bundle. Do not change the target image between the successful rehearsal and final cutover.
2. Pin one PostgreSQL 16 utility-container digest and use that exact `pg_dump`/`psql` build for archive and manifest generation on both hosts. Its patch version must be at least 16.6. A newer PostgreSQL 16 client may dump the older 16.6 source; the target server and `pg_restore` must also be major version 16 and at least 16.6.
3. Use one complete custom-format archive, with no table/schema filters:

   ```sh
   pg_dump --format=custom \
     --no-owner --no-privileges \
     --file="$UWPLAN_DUMP_TMP" \
     --username=postgres --dbname=uwplan
   ```

   Publish the file only by atomically renaming `*.tmp` after `pg_dump` exits zero. Capture stderr and treat every warning as a failed gate requiring review. Do not use `--no-sync`; PostgreSQL warns that it can leave a dump corrupt after an operating-system crash ([pg_dump options](https://www.postgresql.org/docs/16/app-pgdump.html)).

Custom archives are compressed by default, portable across architectures, inspectable with `pg_restore --list`, and selectively restorable if recovery needs it ([pg_dump format documentation](https://www.postgresql.org/docs/16/app-pgdump.html), [SQL dump examples](https://www.postgresql.org/docs/16/backup-dump.html)). PostgreSQL also documents that a dump can load into newer server versions, while `pg_dump` refuses to dump a server newer than its own major version; keeping both ends on major 16 removes that ambiguity ([pg_dump compatibility](https://www.postgresql.org/docs/16/app-pgdump.html)).

Do not run `pg_dumpall --globals-only`. The only source global role is the over-privileged `postgres` role, and roles are cluster-wide rather than database-local ([CREATE ROLE](https://www.postgresql.org/docs/16/sql-createrole.html)). The target roles are provisioned explicitly instead.

## Target ownership and roles

Keep the container-local `postgres` administrator inaccessible to the application and outside the public network. Create one application/migration role:

```sql
CREATE ROLE uwplan_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
```

Set its generated password through a non-logged secret input (for example, `psql`'s `\password` or an equivalent secret-fed bootstrap), never in a command argument, Git, shell history, issue comment, or restore log. Put the resulting `DATABASE_URL` only in the root-readable deployment secret file. PostgreSQL identifies `SUPERUSER` as dangerous and intended only when required ([CREATE ROLE](https://www.postgresql.org/docs/16/sql-createrole.html)).

For each attempt, create a new database with a short timestamped name, owned by `uwplan_app`, from `template0`. Preserve the source encoding, locale provider, collation, and character classification exactly. For the currently observed source that means UTF-8 and `en_US.utf8`; fail rather than silently substitute a different locale.

Examples are `uwplan_rehearsal_20260801` and `uwplan_cutover_20260801`. Restore while authenticated as the local administrator but set the restore role:

```sh
pg_restore --username=postgres --role=uwplan_app \
  --dbname="$UWPLAN_CANDIDATE_DB" \
  --no-owner --no-privileges \
  --single-transaction --exit-on-error --verbose \
  "$UWPLAN_DUMP"
```

`--no-owner` makes the restore role own the created objects instead of trying to recreate source ownership, and `--no-privileges` avoids importing source ACLs ([pg_restore ownership and ACL options](https://www.postgresql.org/docs/16/app-pgrestore.html)). `--single-transaction` makes the restore all-or-nothing and implies exit-on-error ([pg_restore single-transaction option](https://www.postgresql.org/docs/16/app-pgrestore.html)). Do not combine it with parallel restore. At 26 MB, atomicity is worth more than parallelism.

After restore, run `ANALYZE` as `uwplan_app`; `pg_dump` does not carry optimizer statistics, and PostgreSQL recommends analyzing after restore ([pg_dump notes](https://www.postgresql.org/docs/16/app-pgdump.html), [ANALYZE](https://www.postgresql.org/docs/16/sql-analyze.html)).

## Evidence bundle and integrity manifest

Every run gets a UTC id such as `20260801T184500Z` and a root-owned directory with mode `0700`. Files are created under `umask 077` and remain mode `0600`. Use task-specific variables rather than ambient paths:

```sh
UWPLAN_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
UWPLAN_BACKUP_DIR="/srv/uwplan-migration/backups/$UWPLAN_RUN_ID"
install -d -m 700 "$UWPLAN_BACKUP_DIR"
umask 077
```

The evidence bundle contains no row values. It contains:

- the archive and its SHA-256 digest;
- `pg_restore --list` output and tool/server/image versions;
- database encoding, locale, extensions, non-default tablespaces, and relation inventory;
- a normalized schema-only SHA-256 fingerprint;
- per-table row counts;
- a normalized data-only SHA-256 fingerprint;
- the migration-ledger row count, maximum id, and content fingerprint;
- each sequence's definition, `last_value`, and `is_called` state;
- counts of unvalidated constraints and invalid indexes;
- database/object owner inventory and role-attribute inventory;
- dump, transfer, restore, validation, and `ANALYZE` exit statuses.

For the live rehearsal copy, the custom archive and source manifests must share one exported snapshot. Keep a read-only `REPEATABLE READ` transaction open, call `pg_export_snapshot()`, and pass that identifier to each `pg_dump --snapshot=...` invocation before committing the exporter transaction. PostgreSQL documents both exported snapshots and `SET TRANSACTION SNAPSHOT`; `pg_dump` documents `--snapshot` specifically for synchronizing with another session ([SET TRANSACTION](https://www.postgresql.org/docs/16/sql-set-transaction.html), [pg_dump snapshot option](https://www.postgresql.org/docs/16/app-pgdump.html)). This avoids comparing the archive to counts taken after later live writes.

Generate the normalized fingerprints with the pinned PostgreSQL 16 utility client at source and target:

- schema fingerprint: `pg_dump --schema-only --no-owner --no-privileges --no-comments --quote-all-identifiers`, remove generated header/blank lines plus random `\restrict`/`\unrestrict` markers if that client emits them, then SHA-256 the remaining stream;
- data fingerprints: discover every ordinary application table from `pg_catalog`; for each one, stream `COPY (SELECT to_jsonb(t)::text FROM schema.table AS t ORDER BY to_jsonb(t)::text COLLATE "C") TO STDOUT` directly into SHA-256. Store only `<schema>.<table>`, row count, and digest, sorted by qualified table name. Quote discovered identifiers with PostgreSQL's `format('%I', ...)` rather than interpolating raw catalog text.

For the source, the schema dump and every table-fingerprint query use the exported archive snapshot. For the target, stop the target application while generating the manifest. Row serialization can contain user data, so pipe it directly to the hash process: never print it, retain it, or write it to logs. If an implementation needs a temporary plaintext file, create it only in the protected run directory and delete it immediately after hashing. Only hashes and counts go in logs or GitHub. Sequence state is separately mandatory because PostgreSQL treats sequence values as part of a data dump ([pg_dump data-only option](https://www.postgresql.org/docs/16/app-pgdump.html)).

The final migration uses the same snapshot helper even though all writers are stopped. This keeps rehearsal and cutover procedures identical.

## Initial rehearsal protocol

1. Resolve the production application and database containers from their Compose/Coolify metadata and the production application's database host. Do not copy or print the connection URL.
2. Record the baseline facts and confirm source server/client major version 16.
3. Create the protected run directory. Export one synchronized-snapshot custom archive and manifest. Fail on any dump warning or nonzero exit.
4. Run `pg_restore --list` against the completed archive and record its exit status. Compute the archive SHA-256.
5. Transfer the archive and non-sensitive evidence files over SSH to an identically protected directory on DigitalOcean. SSH is the only transport; never use an HTTP upload, public object URL, Git, or issue attachment. Recompute SHA-256 on DigitalOcean and require exact equality before restore. `scp` transfers over an SSH connection ([OpenBSD scp manual](https://man.openbsd.org/scp)).
6. Provision the target role and a fresh rehearsal candidate database. Restore atomically, run `ANALYZE`, and generate the target manifest with the rehearsal app stopped.
7. Require all evidence gates below. Only then point the Basic-Auth-protected `v2.uwplan.com` application at the rehearsal candidate and begin the one-day acceptance soak.
8. Never apply repository migrations or seeds to the restored database during migration. The archive already contains the schema and migration ledger. A future release migration occurs only through the separately chosen deployment process.

The source application stays available throughout the initial copy. The rehearsal is a point-in-time snapshot; later RackNerd writes are intentionally absent until the final migration reruns this protocol.

## Final cutover protocol

1. Confirm the rehearsal passed and that the exact dump/restore/manifest script and target PostgreSQL image digest are unchanged.
2. Put `uwplan.com` behind the approved maintenance response **before** stopping the source application. Stop the production app and all scheduled/background writers.
3. Query `pg_stat_activity` and require zero sessions for the `uwplan` database other than the operator's validation session. Recheck immediately before the snapshot transaction. This timestamp is the last acknowledged-write boundary.
4. Export a new timestamped archive and manifest from RackNerd. Do not reuse the rehearsal archive.
5. Transfer over SSH, verify SHA-256, restore into a fresh DigitalOcean cutover candidate, run `ANALYZE`, and execute every evidence gate. The rehearsal database remains untouched until the candidate passes.
6. Stop the rehearsal app, change only its database name/secret reference to the validated cutover candidate, start it behind Basic Auth, and perform the approved non-destructive smoke checks.
7. Promote traffic according to the separate DNS decision tree. Once DigitalOcean can receive production traffic, conservatively assume it has accepted writes; from this point, rollback requires reverse migration.
8. Keep the RackNerd production app stopped and its database/container/volume intact for seven days. A maintenance response on the old IP must remain in place for stale DNS clients.

If any gate fails before step 7, do not change production DNS. Keep the failed DigitalOcean candidate offline, record the evidence, and either retry with a new candidate or remove maintenance and restart the unchanged RackNerd app. Because RackNerd was the only writer and its database was never overwritten, no acknowledged writes are lost.

## Mandatory evidence gates

All of these are pass/fail; there is no discretionary “looks close enough” result.

1. Source `pg_dump` exits zero without unexplained warnings; `pg_restore --list` exits zero and lists the expected complete archive.
2. Source and DigitalOcean archive SHA-256 digests are identical.
3. Target `pg_restore --single-transaction` exits zero. A failed restore leaves no partial objects committed.
4. Source and target use PostgreSQL major 16; target is at least source patch 16.6; the rehearsed target image digest is unchanged at final cutover.
5. Encoding, locale provider, collation, character classification, extension versions, and non-default tablespace inventory match.
6. Normalized schema fingerprints match exactly.
7. The migration ledger fingerprints match exactly. Its row count and maximum id also match the repository expectation; currently that is 10 migrations and maximum id 10, but execution reads the current repository and source rather than hard-coding it.
8. Every source and target table has the same exact row count, and the normalized whole-database data fingerprints match exactly.
9. Every sequence definition, `last_value`, and `is_called` value matches exactly. This prevents the first post-cutover insert from reusing an existing sequence value.
10. There are zero unvalidated constraints and zero invalid indexes on the target; these counts equal the source.
11. The database and every application object are owned by `uwplan_app`; the application can connect as `uwplan_app`; that role is login-enabled but is not superuser, database creator, role creator, replication-enabled, or RLS-bypassing. The app cannot connect as `postgres`.
12. `ANALYZE` succeeds. The approved application authentication and user-workflow smoke tests then pass without writes that alter validation fixtures.
13. Both VPSes have the timestamped archive, identical checksum, mode-`0700` parent directory, and mode-`0600` files. Neither logs nor evidence output contain credentials or row values.

## Recovery and rollback

### Failed archive, transfer, or restore

- A dump is valid only after its temporary name is atomically renamed. Remove failed `*.tmp` files and retry with a new run id.
- On checksum mismatch, delete the bad DigitalOcean copy, transfer again, and recheck. Never restore a mismatched archive.
- On restore or validation failure, keep the candidate offline. Because restore is single-transaction, it has no partial restored state; drop only that precisely named candidate after retaining non-sensitive diagnostics. Never clean or overwrite the last validated database.

### Rollback before DigitalOcean can accept writes

Revert DNS/routing as specified by the cutover decision tree, remove maintenance, and restart the unchanged RackNerd app. No reverse data copy is needed only when DigitalOcean was never capable of accepting production writes.

### Rollback after DigitalOcean can accept writes

1. Put both endpoints into maintenance and stop DigitalOcean application/background writers.
2. Require zero DigitalOcean application sessions, then create a new final archive and manifest from DigitalOcean using the same protocol.
3. Copy that archive to both VPSes and verify checksums.
4. Restore it into a **new** timestamped RackNerd candidate database. Source ownership there may remain compatible with the existing RackNerd deployment, but the restore still uses `--no-owner --no-privileges`, `--single-transaction`, and a deliberately selected restore role.
5. Compare the DigitalOcean source manifest to the RackNerd candidate on every evidence gate.
6. Change the stopped RackNerd app's database reference to the validated candidate, smoke-test behind maintenance, repoint traffic, and only then admit writes on RackNerd. Leave DigitalOcean stopped.

This preserves all acknowledged DigitalOcean writes only if the DigitalOcean database is readable enough to take the reverse dump. If it is not, zero-loss rollback is impossible with periodic logical dumps: recovery can restore only the newest verified backup, and the operator must explicitly accept its measured recovery point. During the seven-day rollback window, create at least one verified logical backup from DigitalOcean after cutover and then daily, copy each to RackNerd, and record the latest successful timestamp so that this worst-case RPO is visible. Continuous zero-loss disaster recovery would require WAL archiving or replication and is outside this migration decision.

## Seven-day retention and disposal

- Keep each rehearsal/final/reverse archive only as long as it is needed and no longer than seven days unless an active incident places it on explicit hold. Keep the final RackNerd and DigitalOcean copies through the seven-day rollback window.
- A daily job lists candidates older than seven days, resolves the exact timestamped directories, and deletes only those directories after verifying they are not the active recovery point or on hold. Log filenames, timestamps, sizes, and digests, never contents.
- Remove temporary plaintext fingerprint streams immediately after hashing. Keep only their digests.
- Standard deletion on VPS storage cannot guarantee physical overwrite on SSD/provider snapshots. The control available here is narrow permissions, SSH-only transfer, short retention, and provider volume/snapshot policy; do not claim that `shred` provides guaranteed erasure.
- After the seven-day acceptance point and a separately verified ongoing backup policy, delete the migration archives and decommission the stale RackNerd data through the separate execution/decommission decision.

## Why this protocol

It repeats the exact same logical operation for rehearsal, cutover, and reverse rollback; it makes partial restores impossible; it prevents source superuser ownership and credentials from crossing providers; and it turns “the data looks right” into recorded, reproducible gates. Its explicit limit is equally important: the maintenance-window migration can have zero acknowledged-write loss, but recovery after DigitalOcean itself becomes unreadable has the RPO of the latest verified backup unless a later effort adds continuous WAL-based protection.
