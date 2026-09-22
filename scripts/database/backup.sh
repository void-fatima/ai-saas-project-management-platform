#!/bin/sh
set -eu
umask 077
: "${PGDATABASE:?Set PGDATABASE}" "${PGUSER:?Set PGUSER}"
if [ "$#" -ne 1 ]; then echo 'Usage: backup.sh /path/new-backup.dump' >&2; exit 2; fi
destination=$1
if [ -e "$destination" ]; then echo 'Backup already exists; refusing to overwrite.' >&2; exit 2; fi
temporary=$(mktemp "${destination}.partial.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
pg_dump --format=custom --compress=6 --no-owner --no-acl --file="$temporary"
# Atomic exclusive publication on the same filesystem. A concurrent backup cannot be overwritten.
ln -- "$temporary" "$destination"
echo 'Backup completed.'
