#!/bin/sh
# Consistent online backup of the Network Manager database.
#
#   sh infrastructure/scripts/backup.sh [backup-dir] [retention-days]
#
# Run from the repository directory (where docker-compose.yml and .env are).
# Defaults: ./backups, keep 14 days. Writes mnm-YYYYMMDD-HHMMSS.sql.gz, verifies
# the archive and removes backups older than the retention period.
# Backups contain personal data (e.g. IP addresses): store them encrypted and
# restrict access. Schedule with cron, e.g.:
#   30 3 * * * cd /opt/minecraft-network-manager && sh infrastructure/scripts/backup.sh >> backups/backup.log 2>&1
set -eu

dir="${1:-backups}"
retention="${2:-14}"
mkdir -p "$dir"
umask 077

file="$dir/mnm-$(date +%Y%m%d-%H%M%S).sql.gz"
tmp="$file.partial"

echo "[backup] Dumping database to $file"
# --single-transaction: consistent InnoDB snapshot without locking tables.
docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip -9 > "$tmp"

# A dump that ends without the completion marker is truncated (e.g. the
# connection dropped): never keep it as a valid backup.
if ! gzip -t "$tmp" || ! gzip -dc "$tmp" | tail -n 1 | grep -q 'Dump completed'; then
  rm -f "$tmp"
  echo "[backup] ERROR: dump is incomplete" >&2
  exit 1
fi
mv "$tmp" "$file"
echo "[backup] OK ($(wc -c < "$file") bytes)"

find "$dir" -name 'mnm-*.sql.gz' -type f -mtime +"$retention" -print -delete | sed 's/^/[backup] Removed old backup /'
