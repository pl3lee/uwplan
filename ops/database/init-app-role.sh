#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly PASSWORD_FILE="/run/secrets/postgres_password"
app_password="$(cat "$PASSWORD_FILE")"
admin_password="$(cat /run/secrets/postgres_admin_password)"
if [[ "$app_password" == "$admin_password" ]]; then
  echo "PostgreSQL app and administrator credentials must differ" >&2
  exit 1
fi
escaped_password="${app_password//\'/\'\'}"

psql --no-psqlrc --username postgres --dbname postgres \
  --set ON_ERROR_STOP=1 --quiet <<SQL
DO \$role\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'uwplan_app') THEN
    CREATE ROLE uwplan_app LOGIN;
  END IF;
END
\$role\$;
ALTER ROLE uwplan_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${escaped_password}';
ALTER DATABASE uwplan OWNER TO uwplan_app;
SQL

unset app_password admin_password escaped_password
