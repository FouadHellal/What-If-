#!/usr/bin/env sh
# Creates a compressed, timestamped PostgreSQL backup of the What-If database.
#   ./deploy/backup.sh [output-dir]          (default: ./backups)
# Keeps the 14 most recent backups. Schedule it with cron, e.g. daily at 03:15:
#   15 3 * * * cd /opt/what-if && ./deploy/backup.sh >> backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
OUT_DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
mkdir -p "$OUT_DIR"
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
DB="${POSTGRES_DB:-whatif}"
USER="${POSTGRES_USER:-whatif}"
FILE="$OUT_DIR/what-if-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T db pg_dump --clean --if-exists --no-owner -U "$USER" -d "$DB" | gzip -9 > "$FILE.partial"
mv "$FILE.partial" "$FILE"
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
ls -1t "$OUT_DIR"/what-if-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
