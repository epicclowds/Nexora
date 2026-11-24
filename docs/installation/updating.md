# Updating

**Always take a backup first:** `sh infrastructure/scripts/backup.sh` ([Backup & restore](backup-restore.md)). Database migrations are forward-only and cannot be rolled back automatically.

## Using locally built images (default)

```sh
git fetch --tags
git checkout v<version>          # or: git pull for the latest main
docker compose up -d --build --wait
```

## Using published images

Once release images are published to GHCR (workflow `release.yml`, triggered by `vX.Y.Z` tags), set in `.env`:

```dotenv
MNM_IMAGE_PREFIX=ghcr.io/<owner>/<repository>
MNM_VERSION=1.0.0   # or "latest"
```

Then:

```sh
docker compose pull
docker compose up -d
```

## What happens during an update

1. Containers are recreated; the volumes `mysql-data` and `redis-data` are kept.
2. The backend entrypoint runs `prisma migrate deploy` and applies new migrations before accepting traffic. If a migration fails the backend refuses to start (data is not modified further) – restore the backup or fix the cause, then start again.
3. Startup synchronisation adds new permissions and languages without overwriting customised roles.

To skip automatic migrations (e.g. to run them manually) set `RUN_MIGRATIONS=false` on the backend service.
