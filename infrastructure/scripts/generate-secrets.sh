#!/bin/sh
# Creates .env from .env.example with freshly generated secrets.
# Requires: openssl (or run inside Docker: docker run --rm -v "$PWD:/w" -w /w alpine/openssl ...).
set -eu

cd "$(dirname "$0")/../.."

if [ -f .env ]; then
  echo ".env already exists – refusing to overwrite it." >&2
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

echo "Created .env with generated secrets. Review it, then run: docker compose up -d"
