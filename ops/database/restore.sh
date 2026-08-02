#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly RUN_ID="${1:?Pass the UTC migration run identifier}"
readonly CANDIDATE_DATABASE="${2:?Pass the fresh candidate database name}"
readonly SOURCE_ENCODING="${3:?Pass the source encoding}"
readonly SOURCE_COLLATION="${4:?Pass the source collation}"
readonly SOURCE_CTYPE="${5:?Pass the source ctype}"
readonly EXPECTED_SHA256="${6:?Pass the expected archive SHA-256}"
readonly EVIDENCE_DIRECTORY="${7:-/evidence}"
readonly ARCHIVE_PATH="${EVIDENCE_DIRECTORY}/source.dump"

[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{9}Z$ ]]
[[ "$CANDIDATE_DATABASE" =~ ^uwplan_candidate_[0-9]{8}T[0-9]{9}Z$ ]]
[[ "$SOURCE_ENCODING" =~ ^[A-Z0-9_-]+$ ]]
[[ "$SOURCE_COLLATION" =~ ^[A-Za-z0-9_.@-]+$ ]]
[[ "$SOURCE_CTYPE" =~ ^[A-Za-z0-9_.@-]+$ ]]
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

actual_sha256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
[[ "$actual_sha256" == "$EXPECTED_SHA256" ]]
pg_restore --list "$ARCHIVE_PATH" >/dev/null
target_version="$(psql --no-psqlrc --quiet --tuples-only --no-align --command "SELECT current_setting('server_version_num')")"
[[ "$target_version" =~ ^16[0-9]{4}$ ]]

psql --no-psqlrc --set ON_ERROR_STOP=1 --quiet <<'SQL'
DO $role$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uwplan_app') THEN
    CREATE ROLE uwplan_app LOGIN;
  END IF;
END
$role$;
ALTER ROLE uwplan_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL

if psql --no-psqlrc --quiet --tuples-only --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '$CANDIDATE_DATABASE'" \
  | grep --quiet 1; then
  echo "candidate database already exists; a fresh identity is required" >&2
  exit 1
fi

createdb \
  --template=template0 \
  --owner=uwplan_app \
  --encoding="$SOURCE_ENCODING" \
  --lc-collate="$SOURCE_COLLATION" \
  --lc-ctype="$SOURCE_CTYPE" \
  "$CANDIDATE_DATABASE"

restore_failed=1
cleanup() {
  if [[ "$restore_failed" == 1 ]]; then
    dropdb --if-exists "$CANDIDATE_DATABASE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

pg_restore \
  --dbname="$CANDIDATE_DATABASE" \
  --no-owner \
  --no-privileges \
  --role=uwplan_app \
  --single-transaction \
  --exit-on-error \
  "$ARCHIVE_PATH"
vacuumdb --analyze-only "$CANDIDATE_DATABASE" >/dev/null

role_attributes="$(psql --no-psqlrc --quiet --tuples-only --no-align --field-separator='|' \
  --command "SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'uwplan_app'")"
[[ "$role_attributes" == "t|f|f|f|f|f" ]]

database_owner="$(psql --no-psqlrc --quiet --tuples-only --no-align \
  --command "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$CANDIDATE_DATABASE'")"
[[ "$database_owner" == "uwplan_app" ]]

restore_failed=0
trap - EXIT
printf '{"schemaVersion":1,"runId":"%s","candidateDatabase":"%s","archiveSha256":"%s","targetVersionNum":"%s","restored":true,"singleTransaction":true,"exitOnError":true,"analyzed":true,"databaseOwner":"uwplan_app","appRole":{"login":true,"superuser":false,"createdb":false,"createrole":false,"replication":false,"bypassRls":false}}\n' \
  "$RUN_ID" "$CANDIDATE_DATABASE" "$actual_sha256" "$target_version"
