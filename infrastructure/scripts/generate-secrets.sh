#!/bin/sh
# Creates .env from .env.example with freshly generated secrets.
# Requires: openssl (or run inside Docker: docker run --rm -v "$PWD:/w" -w /w alpine/openssl ...).
#
# Only for NEW installations: MySQL keeps the passwords it was first created
# with inside its data volume. If a Nexora database volume already exists, new
# passwords would lock the backend out of it (Prisma P1000), so this script
# refuses – reuse the previous .env instead (or see repair-db-credentials.sh).
# Override with --force only if you really want new secrets for an existing
# volume and will run repair-db-credentials.sh afterwards.
set -eu

cd "$(dirname "$0")/../.."

if [ -f .env ]; then
  echo ".env already exists – refusing to overwrite it." >&2
  exit 1
fi

volume="${NEXORA_VOLUME_PREFIX:-minecraft-network-manager}_mysql-data"
if [ "${1:-}" != "--force" ] && command -v docker >/dev/null 2>&1 && docker volume inspect "$volume" >/dev/null 2>&1; then
  cat >&2 <<EOF
An existing Nexora database volume was found: $volume
Its MySQL passwords were set when it was created. New random passwords would
not match them and the backend would fail with "P1000 Authentication failed".

Keep your data and reuse the previous configuration instead:
  cp /path/to/your/previous/installation/.env .env
then set NEXORA_VERSION in .env and run: docker compose pull && docker compose up -d

If the previous .env is lost, generate new secrets with --force and then run
  sh infrastructure/scripts/repair-db-credentials.sh
(no data is deleted). Details: docs/installation/README.md#database-password-mismatch-p1000
EOF
  exit 1
fi

hex() { openssl rand -hex "$1"; }

sed \
  -e "s/^MYSQL_PASSWORD=CHANGE_ME$/MYSQL_PASSWORD=$(hex 24)/" \
  -e "s/^MYSQL_ROOT_PASSWORD=CHANGE_ME$/MYSQL_ROOT_PASSWORD=$(hex 24)/" \
  -e "s/^REDIS_PASSWORD=CHANGE_ME$/REDIS_PASSWORD=$(hex 24)/" \
  -e "s/^JWT_SECRET=CHANGE_ME$/JWT_SECRET=$(hex 48)/" \
  .env.example > .env
chmod 600 .env

echo "Created .env with generated secrets. Keep a copy in a safe place: the database volume"
echo "only works with these passwords. Next: docker compose pull && docker compose up -d"
