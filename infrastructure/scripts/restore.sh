#!/bin/sh
# Restores a database backup created by backup.sh.
#
#   sh infrastructure/scripts/restore.sh backups/mnm-YYYYMMDD-HHMMSS.sql.gz --yes
#
# Run from the repository directory. The current database content is REPLACED:
# the database is dropped and recreated before the backup is imported. Restore
# into the same application version that created the backup; newer versions
# apply their migrations forward on start.
set -eu

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: sh infrastructure/scripts/restore.sh <backup.sql.gz> --yes" >&2
  exit 2
fi
if [ "${2:-}" != "--yes" ]; then
  echo "This replaces ALL data in the database with $file." >&2
  echo "Re-run with --yes to continue." >&2
  exit 2
fi
gzip -t "$file"

echo "[restore] Stopping backend and dashboard"
docker compose stop backend dashboard

echo "[restore] Recreating the database"
docker compose exec -T mysql sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO \`$MYSQL_USER\`@\`%\`;"'

echo "[restore] Importing $file"
gzip -dc "$file" | docker compose exec -T mysql sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'

echo "[restore] Starting backend and dashboard (pending migrations are applied on start)"
docker compose start backend dashboard
echo "[restore] Done. Check: docker compose ps"
