#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly RUN_ID="${1:?Pass the UTC migration run identifier}"
readonly EVIDENCE_DIRECTORY="${2:-/evidence}"
readonly ARCHIVE_PARTIAL="${EVIDENCE_DIRECTORY}/source.dump.partial"
readonly ARCHIVE_PATH="${EVIDENCE_DIRECTORY}/source.dump"
readonly MANIFEST_PARTIAL="${EVIDENCE_DIRECTORY}/source-manifest.json.partial"
readonly MANIFEST_PATH="${EVIDENCE_DIRECTORY}/source-manifest.json"
readonly INTEGRITY_PARTIAL="${EVIDENCE_DIRECTORY}/source-integrity.json.partial"
readonly INTEGRITY_PATH="${EVIDENCE_DIRECTORY}/source-integrity.json"
readonly DUMP_WARNINGS="${EVIDENCE_DIRECTORY}/pg-dump.stderr"
readonly SNAPSHOT_INPUT="${EVIDENCE_DIRECTORY}/snapshot.input"
readonly SNAPSHOT_OUTPUT="${EVIDENCE_DIRECTORY}/snapshot.output"

[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{9}Z$ ]]
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
[[ "$PGDATABASE" =~ ^[A-Za-z0-9_-]+$ ]]

role_statement=""
pg_dump_role=()
if [[ "$PGUSER" == "uwplan_migration_admin" ]]; then
  role_statement="SET ROLE uwplan_app;"
  pg_dump_role=(--role=uwplan_app)
fi

mkdir -p "$EVIDENCE_DIRECTORY"
chmod 700 "$EVIDENCE_DIRECTORY"
rm -f "$ARCHIVE_PARTIAL" "$MANIFEST_PARTIAL"

snapshot_pid=""
cleanup() {
  rm -f "$ARCHIVE_PARTIAL" "$MANIFEST_PARTIAL" "$INTEGRITY_PARTIAL" "$DUMP_WARNINGS"
  if [[ -n "$snapshot_pid" ]]; then
    printf 'ROLLBACK;\n\\q\n' >&3 2>/dev/null || true
    exec 3>&- 4<&- || true
  fi
  if [[ -n "$snapshot_pid" ]]; then
    wait "$snapshot_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

rm -f "$SNAPSHOT_INPUT" "$SNAPSHOT_OUTPUT"
mkfifo -m 600 "$SNAPSHOT_INPUT" "$SNAPSHOT_OUTPUT"
psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
  <"$SNAPSHOT_INPUT" >"$SNAPSHOT_OUTPUT" &
snapshot_pid="$!"
exec 3>"$SNAPSHOT_INPUT"
exec 4<"$SNAPSHOT_OUTPUT"
rm -f "$SNAPSHOT_INPUT" "$SNAPSHOT_OUTPUT"

printf '%s\n' \
  "$role_statement" \
  'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;' \
  'SELECT pg_export_snapshot();' >&3
IFS= read -r snapshot_id <&4
[[ "$snapshot_id" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+$ ]]

metadata="$({
  printf '%s\n' \
    "$role_statement" \
    'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;' \
    "SET TRANSACTION SNAPSHOT '${snapshot_id}';" \
    "SELECT pg_encoding_to_char(encoding) || E'\\t' || datcollate || E'\\t' || datctype || E'\\t' || current_setting('server_version_num') FROM pg_database WHERE datname = current_database();" \
    'COMMIT;'
} | psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1)"

IFS=$'\t' read -r source_encoding source_collation source_ctype source_version <<<"$metadata"
[[ "$source_encoding" =~ ^[A-Z0-9_-]+$ ]]
[[ "$source_collation" =~ ^[A-Za-z0-9_.@-]+$ ]]
[[ "$source_ctype" =~ ^[A-Za-z0-9_.@-]+$ ]]
[[ "$source_version" =~ ^16[0-9]{4}$ ]]
(( 10#$source_version <= 160014 ))

pg_dump \
  "${pg_dump_role[@]}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --snapshot="$snapshot_id" \
  --file="$ARCHIVE_PARTIAL" \
  "$PGDATABASE" 2>"$DUMP_WARNINGS"
if [[ -s "$DUMP_WARNINGS" ]]; then
  echo "pg_dump emitted unexpected diagnostics" >&2
  exit 1
fi
rm -f "$DUMP_WARNINGS"

pg_restore --list "$ARCHIVE_PARTIAL" >/dev/null
archive_sha256="$(sha256sum "$ARCHIVE_PARTIAL" | awk '{print $1}')"
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]]

/integrity.sh "$RUN_ID" "$PGDATABASE" "$snapshot_id" "$EVIDENCE_DIRECTORY" \
  >"$INTEGRITY_PARTIAL"
integrity="$(cat "$INTEGRITY_PARTIAL")"

printf '{"schemaVersion":1,"runId":"%s","snapshotId":"%s","utilityVersionNum":"160014","archive":{"format":"custom","sha256":"%s","complete":true,"owners":false,"privileges":false,"filters":false,"clusterGlobals":false,"listable":true},"source":{"database":"%s","serverVersionNum":"%s","encoding":"%s","collation":"%s","ctype":"%s"},"integrity":%s}\n' \
  "$RUN_ID" "$snapshot_id" "$archive_sha256" "$PGDATABASE" \
  "$source_version" "$source_encoding" "$source_collation" "$source_ctype" "$integrity" \
  >"$MANIFEST_PARTIAL"

chmod 600 "$ARCHIVE_PARTIAL" "$MANIFEST_PARTIAL" "$INTEGRITY_PARTIAL"
mv "$ARCHIVE_PARTIAL" "$ARCHIVE_PATH"
mv "$INTEGRITY_PARTIAL" "$INTEGRITY_PATH"
mv "$MANIFEST_PARTIAL" "$MANIFEST_PATH"

printf 'COMMIT;\n\\q\n' >&3
exec 3>&- 4<&-
wait "$snapshot_pid"
snapshot_pid=""
trap - EXIT

cat "$MANIFEST_PATH"
