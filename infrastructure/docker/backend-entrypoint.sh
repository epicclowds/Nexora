#!/bin/sh
# Applies pending database migrations, then starts the backend.
# Migrations are forward-only; take a backup before upgrading (docs/installation/backup-restore.md).
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations…"
  attempt=1
  until npx --no-install prisma migrate deploy; do
    if [ "$attempt" -ge "${MIGRATION_MAX_ATTEMPTS:-10}" ]; then
      echo "[entrypoint] Migrations failed after $attempt attempts. Refusing to start." >&2
      exit 1
    fi
    echo "[entrypoint] Database not ready (attempt $attempt). Retrying in 5s…" >&2
    attempt=$((attempt + 1))
    sleep 5
  done
fi

exec "$@"
