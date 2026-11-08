#!/usr/bin/env sh
# Restores a backup created by backup.sh. THIS REPLACES THE CURRENT DATA.
#   ./deploy/restore.sh backups/what-if-20270101T031500Z.sql.gz
set -eu
cd "$(dirname "$0")/.."
FILE="${1:?Usage: restore.sh <backup.sql.gz>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
DB="${POSTGRES_DB:-whatif}"
USER="${POSTGRES_USER:-whatif}"
printf 'This replaces all data in database "%s" with %s. Type RESTORE to continue: ' "$DB" "$FILE"
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Aborted."; exit 1; }
docker compose stop app
gunzip -c "$FILE" | docker compose exec -T db psql -v ON_ERROR_STOP=1 -q -U "$USER" -d "$DB"
docker compose start app
echo "Restore complete. The app will apply any newer migrations on start."
