#!/bin/sh
set -eu
: "${PGDATABASE:?Set PGDATABASE}" "${PGUSER:?Set PGUSER}"
if [ "$#" -ne 1 ]; then echo 'Usage: restore.sh /path/backup.dump' >&2; exit 2; fi
if [ "${RESTORE_TARGET_CONFIRM:-}" != "$PGDATABASE" ]; then
  echo 'Set RESTORE_TARGET_CONFIRM to the exact disposable, empty target database name.' >&2; exit 2
fi
case "$PGDATABASE" in postgres|template0|template1) echo 'Refusing system database.' >&2; exit 2;; esac
pg_restore --list "$1" >/dev/null
existing=$(psql -X -At --set=ON_ERROR_STOP=1 --command="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'")
if [ "$existing" != 0 ]; then echo 'Target contains objects; restore requires an empty database.' >&2; exit 2; fi
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$PGDATABASE" "$1"
echo 'Restore completed. Validate data and reapply application role grants before switching traffic.'
