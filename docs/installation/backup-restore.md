# Backup & restore

Backup and restore are tested end to end in CI on every push (job *Deployment*): a populated installation is backed up with `backup.sh`, all Docker volumes are deleted, the stack is recreated, the backup is restored with `restore.sh`, and the data (users, servers, plugin credentials, 2000 players) is verified.

## What to back up

| What | Where | Critical |
| --- | --- | --- |
| Database | Docker volume `<project>_mysql-data` → use `backup.sh` | Yes – all application data, including inventory snapshots and revisions |
| `.env` | Repository directory | Yes – database credentials and `JWT_SECRET` (also the key for stored 2FA secrets) |
| `geoip/` | Repository directory | Optional – can be downloaded again |
| Redis | Docker volume `<project>_redis-data` | No – rate limits, caches, nonces; rebuilt automatically |
| Plugin folders on Minecraft servers | `plugins/networkmanager/`, `plugins/NetworkManager/` | Yes, for those servers – `credentials.properties`, `punishments-cache.json`, `managed-settings.json` |

Store `.env` separately from the database backups: together they give full access. Backups contain personal data (IP addresses): encrypt them and restrict access.

## Database backup

```sh
sh infrastructure/scripts/backup.sh [backup-dir] [retention-days]   # defaults: backups 14
```

- Online and consistent (`mysqldump --single-transaction`, no table locks).
- The archive is checked (gzip integrity and the dump's completion marker); an incomplete dump is deleted and the script fails.
- Files are created with mode `600`; backups older than the retention period are removed.

Schedule it with cron on the Docker host, e.g. daily at 03:30:

```sh
30 3 * * * cd /opt/minecraft-network-manager && sh infrastructure/scripts/backup.sh >> backups/backup.log 2>&1
```

Copy the backup directory to another machine or object storage (e.g. with `rclone` or `restic`).

## Restore

```sh
sh infrastructure/scripts/restore.sh backups/mnm-YYYYMMDD-HHMMSS.sql.gz --yes
docker compose up -d --wait
```

The script stops backend and dashboard, **drops and recreates the database**, imports the backup and starts the services again. Restore into the same application version that created the backup; a newer version applies its pending migrations on start (migrations are forward-only – an older version cannot run on a newer schema).

Dashboard sessions from before the restore stay valid only if they existed at backup time; users may have to sign in again.

## Disaster recovery

1. Provision a new host with Docker, clone the repository **at the same version** (`git checkout v<version>`) and restore `.env`.
2. `docker compose up -d --wait` – starts an empty installation (do **not** run the setup wizard).
3. `sh infrastructure/scripts/restore.sh <latest backup> --yes`, then `docker compose up -d --wait`.
4. Point DNS / the Minecraft servers' `backend-url` to the new host if it changed. Plugins keep their credentials, so no re-registration is needed.

## Inventory recovery

Inventory snapshots and every edit are stored in the database, so they are part of every backup. To undo a single bad edit, use **Roll back** in the player's inventory history instead of restoring a backup – it creates an inverse revision protected by the same compare-and-set checks ([details](../architecture/inventory.md#rollback-and-history)).
