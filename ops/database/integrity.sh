#!/usr/bin/env bash
set -euo pipefail
set -E

umask 077

readonly RUN_ID="${1:?Pass the UTC migration run identifier}"
readonly DATABASE_NAME="${2:?Pass the database name}"
readonly REQUESTED_SNAPSHOT="${3:--}"
readonly EVIDENCE_DIRECTORY="${4:-/evidence}"
readonly UTILITY_IMAGE="${UWPLAN_DB_UTILITY_IMAGE:?Pinned utility image is required}"

stage="preflight"
trap 'printf "database integrity manifest failed during %s\n" "$stage" >&2' ERR

[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{9}Z$ ]]
[[ "$DATABASE_NAME" =~ ^[A-Za-z0-9_-]+$ ]]
[[ "$UTILITY_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"

role_statement=""
pg_dump_role=()
if [[ "$PGUSER" == "uwplan_migration_admin" ]]; then
  role_statement="SET ROLE uwplan_app;"
  pg_dump_role=(--role=uwplan_app)
fi

mkdir -p "$EVIDENCE_DIRECTORY"
chmod 700 "$EVIDENCE_DIRECTORY"

snapshot_id="$REQUESTED_SNAPSHOT"
snapshot_pid=""
snapshot_input="${EVIDENCE_DIRECTORY}/integrity-snapshot.input"
snapshot_output="${EVIDENCE_DIRECTORY}/integrity-snapshot.output"

cleanup() {
  if [[ -n "$snapshot_pid" ]]; then
    printf 'ROLLBACK;\n\\q\n' >&3 2>/dev/null || true
    exec 3>&- 4<&- || true
    wait "$snapshot_pid" 2>/dev/null || true
  fi
  rm -f "$snapshot_input" "$snapshot_output"
}
trap cleanup EXIT

if [[ "$snapshot_id" == "-" ]]; then
  rm -f "$snapshot_input" "$snapshot_output"
  mkfifo -m 600 "$snapshot_input" "$snapshot_output"
  psql --dbname="$DATABASE_NAME" --no-psqlrc --quiet --tuples-only \
    --no-align --set ON_ERROR_STOP=1 <"$snapshot_input" >"$snapshot_output" &
  snapshot_pid="$!"
  exec 3>"$snapshot_input"
  exec 4<"$snapshot_output"
  rm -f "$snapshot_input" "$snapshot_output"
  printf '%s\n' \
    "$role_statement" \
    'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;' \
    'SELECT pg_export_snapshot();' >&3
  IFS= read -r snapshot_id <&4
fi
[[ "$snapshot_id" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+$ ]]

snapshot_query() {
  local sql="$1"
  {
    printf '%s\n' \
      "$role_statement" \
      'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;' \
      "SET TRANSACTION SNAPSHOT '${snapshot_id}';" \
      "SET LOCAL TIME ZONE 'UTC';" \
      "SET LOCAL DateStyle = 'ISO, YMD';" \
      "SET LOCAL bytea_output = 'hex';" \
      "SET LOCAL extra_float_digits = 3;"
    printf '%s\n' "$sql"
    printf '%s\n' 'COMMIT;'
  } | psql --dbname="$DATABASE_NAME" --no-psqlrc --quiet --tuples-only \
    --no-align --set ON_ERROR_STOP=1
}

hash_query() {
  snapshot_query "$1" | sha256sum | awk '{print $1}'
}

database_json="$(snapshot_query "
SELECT json_build_object(
  'serverVersionNum', current_setting('server_version_num'),
  'encoding', pg_encoding_to_char(d.encoding),
  'collation', d.datcollate,
  'ctype', d.datctype,
  'localeProvider', d.datlocprovider,
  'icuLocale', d.daticulocale,
  'localeVersion', d.datcollversion,
  'defaultTablespace', t.spcname
)::text
FROM pg_database d
JOIN pg_tablespace t ON t.oid = d.dattablespace
WHERE d.datname = current_database();")"

stage="database-metadata"
server_version="$(printf '%s' "$database_json" | sed -nE 's/.*"serverVersionNum"[ ]*:[ ]*"([0-9]+)".*/\1/p')"
[[ "$server_version" =~ ^16[0-9]{4}$ ]]

stage="normalized-schema"
schema_sha256="$({
  pg_dump --dbname="$DATABASE_NAME" "${pg_dump_role[@]}" \
    --schema-only --no-owner --no-privileges \
    --snapshot="$snapshot_id"
} | sed -E '/^--/d;/^\\(un)?restrict /d;/^[[:space:]]*$/d' \
  | sha256sum | awk '{print $1}')"

stage="extensions"
extensions_json="$(snapshot_query "
SELECT COALESCE(json_agg(json_build_object(
  'name', e.extname,
  'version', e.extversion,
  'schemaIdentity', encode(convert_to(n.nspname, 'UTF8'), 'base64')
) ORDER BY e.extname)::text, '[]')
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace;")"

stage="tablespaces"
tablespaces_json="$(snapshot_query "
SELECT COALESCE(json_agg(identity ORDER BY identity)::text, '[]')
FROM (
  SELECT DISTINCT encode(convert_to(
    n.nspname || '.' || c.relname || '=' || t.spcname, 'UTF8'
  ), 'base64') AS identity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_tablespace t ON t.oid = c.reltablespace
  WHERE c.reltablespace <> 0
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)'
) entries;")"

stage="ordinary-tables"
table_rows="$(snapshot_query "
SELECT
  replace(encode(convert_to(n.nspname, 'UTF8'), 'base64'), E'\\n', '') || '|' ||
  replace(encode(convert_to(c.relname, 'UTF8'), 'base64'), E'\\n', '') || '|' ||
  replace(encode(convert_to(format('%I.%I', n.nspname, c.relname), 'UTF8'), 'base64'), E'\\n', '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast|temp)'
ORDER BY n.nspname COLLATE \"C\", c.relname COLLATE \"C\";")"

tables_json="["
separator=""
while IFS='|' read -r schema_identity name_identity qualified_identity; do
  [[ -n "$qualified_identity" ]] || continue
  qualified="$(printf '%s' "$qualified_identity" | base64 --decode)"
  count="$(snapshot_query "SELECT count(*) FROM ${qualified};")"
  [[ "$count" =~ ^[0-9]+$ ]]
  content_sha256="$(hash_query "COPY (
    SELECT row_to_json(row_data)::text
    FROM ${qualified} AS row_data
    ORDER BY row_to_json(row_data)::text COLLATE \"C\"
  ) TO STDOUT;")"
  tables_json+="${separator}{\"schemaIdentity\":\"${schema_identity}\",\"nameIdentity\":\"${name_identity}\",\"count\":${count},\"sha256\":\"${content_sha256}\"}"
  separator=","
done <<<"$table_rows"
tables_json+="]"

stage="migration-ledger"
ledger_count="$(snapshot_query 'SELECT count(*) FROM drizzle.__drizzle_migrations;')"
ledger_max_id="$(snapshot_query 'SELECT max(id) FROM drizzle.__drizzle_migrations;')"
[[ "$ledger_count" =~ ^[0-9]+$ ]]
if [[ -z "$ledger_max_id" ]]; then
  ledger_max_id_json="null"
else
  [[ "$ledger_max_id" =~ ^[0-9]+$ ]]
  ledger_max_id_json="$ledger_max_id"
fi
ledger_sha256="$(hash_query 'COPY (
  SELECT row_to_json(row_data)::text
  FROM drizzle.__drizzle_migrations AS row_data
  ORDER BY row_to_json(row_data)::text COLLATE "C"
) TO STDOUT;')"
ledger_json="{\"count\":${ledger_count},\"maxId\":${ledger_max_id_json},\"sha256\":\"${ledger_sha256}\"}"

stage="sequences"
sequence_rows="$(snapshot_query "
SELECT
  replace(encode(convert_to(n.nspname, 'UTF8'), 'base64'), E'\\n', '') || '|' ||
  replace(encode(convert_to(c.relname, 'UTF8'), 'base64'), E'\\n', '') || '|' ||
  replace(encode(convert_to(format('%I.%I', n.nspname, c.relname), 'UTF8'), 'base64'), E'\\n', '') || '|' ||
  replace(encode(convert_to(json_build_object(
    'dataType', format_type(s.seqtypid, NULL),
    'startValue', s.seqstart::text,
    'incrementBy', s.seqincrement::text,
    'minValue', s.seqmin::text,
    'maxValue', s.seqmax::text,
    'cacheSize', s.seqcache::text,
    'cycle', s.seqcycle
  )::text, 'UTF8'), 'base64'), E'\\n', '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_sequence s ON s.seqrelid = c.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast|temp)'
ORDER BY n.nspname COLLATE \"C\", c.relname COLLATE \"C\";")"

sequences_json="["
separator=""
while IFS='|' read -r schema_identity name_identity qualified_identity definition_identity; do
  [[ -n "$qualified_identity" ]] || continue
  qualified="$(printf '%s' "$qualified_identity" | base64 --decode)"
  definition_sha256="$(printf '%s' "$definition_identity" | base64 --decode | sha256sum | awk '{print $1}')"
  sequence_state="$(snapshot_query "SELECT last_value::text || '|' || is_called::text FROM ${qualified};")"
  IFS='|' read -r last_value is_called <<<"$sequence_state"
  [[ "$last_value" =~ ^-?[0-9]+$ ]]
  [[ "$is_called" == "true" || "$is_called" == "false" ]]
  sequences_json+="${separator}{\"schemaIdentity\":\"${schema_identity}\",\"nameIdentity\":\"${name_identity}\",\"definitionSha256\":\"${definition_sha256}\",\"lastValue\":\"${last_value}\",\"isCalled\":${is_called}}"
  separator=","
done <<<"$sequence_rows"
sequences_json+="]"

stage="constraints-and-indexes"
unvalidated_constraints_json="$(snapshot_query "
SELECT COALESCE(json_agg(identity ORDER BY identity)::text, '[]')
FROM (
  SELECT encode(convert_to(n.nspname || '.' || c.relname || '.' || con.conname, 'UTF8'), 'base64') AS identity
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT con.convalidated
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)'
) entries;")"

invalid_indexes_json="$(snapshot_query "
SELECT COALESCE(json_agg(identity ORDER BY identity)::text, '[]')
FROM (
  SELECT encode(convert_to(n.nspname || '.' || c.relname, 'UTF8'), 'base64') AS identity
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE (NOT i.indisvalid OR NOT i.indisready)
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)'
) entries;")"

stage="ownership"
ownership_violations_json="$(snapshot_query "
WITH violations AS (
  SELECT 'database:' || current_database() AS identity
  FROM pg_database d
  WHERE d.datname = current_database()
    AND pg_get_userbyid(d.datdba) <> 'uwplan_app'
  UNION ALL
  SELECT 'schema:' || n.nspname
  FROM pg_namespace n
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)'
    AND NOT (n.nspname = 'public' AND pg_get_userbyid(n.nspowner) = 'pg_database_owner')
    AND pg_get_userbyid(n.nspowner) <> 'uwplan_app'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e'
    )
  UNION ALL
  SELECT 'relation:' || n.nspname || '.' || c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)'
    AND pg_get_userbyid(c.relowner) <> 'uwplan_app'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    )
  UNION ALL
  SELECT 'function:' || n.nspname || '.' || p.oid::regprocedure::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)'
    AND pg_get_userbyid(p.proowner) <> 'uwplan_app'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    )
)
SELECT COALESCE(json_agg(encode(convert_to(identity, 'UTF8'), 'base64') ORDER BY identity)::text, '[]')
FROM violations;")"

stage="application-role"
app_role_json="$(snapshot_query "
SELECT COALESCE((
  SELECT json_build_object(
    'login', rolcanlogin,
    'superuser', rolsuper,
    'createdb', rolcreatedb,
    'createrole', rolcreaterole,
    'replication', rolreplication,
    'bypassRls', rolbypassrls
  )::text
  FROM pg_roles
  WHERE rolname = 'uwplan_app'
), '{\"login\":false,\"superuser\":false,\"createdb\":false,\"createrole\":false,\"replication\":false,\"bypassRls\":false}');")"

stage="evidence"
printf '{"schemaVersion":1,"runId":"%s","utilityImage":"%s","utilityVersionNum":"160014","database":%s,"schemaSha256":"%s","extensions":%s,"tablespaces":%s,"ledger":%s,"tables":%s,"sequences":%s,"unvalidatedConstraints":%s,"invalidIndexes":%s,"ownershipViolations":%s,"appRole":%s}\n' \
  "$RUN_ID" "$UTILITY_IMAGE" "$database_json" "$schema_sha256" \
  "$extensions_json" "$tablespaces_json" "$ledger_json" "$tables_json" \
  "$sequences_json" "$unvalidated_constraints_json" "$invalid_indexes_json" \
  "$ownership_violations_json" "$app_role_json"

if [[ -n "$snapshot_pid" ]]; then
  printf 'COMMIT;\n\\q\n' >&3
  exec 3>&- 4<&-
  wait "$snapshot_pid"
  snapshot_pid=""
fi
trap - EXIT
