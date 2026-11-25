# Backup & restore

Backup and restore are tested end to end in CI on every push (job *Deployment*): a populated installation is backed up with `backup.sh`, all Docker volumes are deleted, the stack is recreated, the backup is restored with `restore.sh`, and the data (users, servers, plugin credentials, 2000 players) is verified.

## What to back up

| What | Where | Critical |
| --- | --- | --- |
| Database | Docker volume `minecraft-network-manager_mysql-data` → `backup.sh` or the commands below | Yes – all application data, including inventory snapshots and revisions |
| `.env` / stack environment variables | Next to `docker-compose.yml`, or in Portainer/Arcane | Yes – database credentials and `JWT_SECRET` (also the key for stored 2FA secrets) |
| GeoIP files | `GEOIP_DIR` | Optional – can be downloaded again |
| Redis | Docker volume `minecraft-network-manager_redis-data` | No – rate limits, caches, nonces; rebuilt automatically |
| Plugin folders on Minecraft servers | `plugins/networkmanager/`, `plugins/NetworkManager/` | Yes, for those servers – `credentials.properties`, `punishments-cache.json`, `managed-settings.json` |

Store `.env` separately from the database backups: together they give full access. Backups contain personal data (IP addresses): encrypt them and restrict access.

## Database backup

The helper scripts below come with the release package or a repository checkout. Without them (standalone stack, Portainer, Arcane), use the [plain Docker commands](#without-the-helper-scripts).


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

## Without the helper scripts

These commands need nothing but Docker and the running stack. Run them in the folder with `docker-compose.yml` (command line), or replace `docker compose exec -T mysql` with `docker exec -i <mysql-container>` (the container name is shown in Portainer/Arcane, e.g. `nexora-mysql-1`).

**Back up** (online, consistent, no table locks):

```sh
docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip > "nexora-$(date +%Y%m%d-%H%M%S).sql.gz"
f=$(ls nexora-*.sql.gz | tail -n 1); gunzip -t "$f" && zcat "$f" | tail -n 1   # must print "-- Dump completed …"
```

The passwords are read from the MySQL container's own environment, so they never appear on the host's command line.

**Restore** (replaces the whole database with the backup):

```sh
docker compose stop dashboard backend
docker compose exec -T mysql sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO \`$MYSQL_USER\`@\`%\`;"'
gunzip -c nexora-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T mysql sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
docker compose up -d --wait
```

These are the same commands `backup.sh` and `restore.sh` use. Schedule backups with cron on the Docker host and copy them to another machine. Portainer and Arcane have no built-in database backup; run the backup command from a host cron job (with `docker exec -i <mysql-container>`).

## Disaster recovery

1. Provision a new host with Docker and deploy `docker-compose.yml` with the **saved secret values** and `NEXORA_VERSION` pinned to the version that created the backup.
2. Wait until all services are healthy – this is an empty installation (do **not** run the setup wizard).
3. Restore the backup (`sh infrastructure/scripts/restore.sh <backup> --yes`, or the [commands above](#without-the-helper-scripts)), then `docker compose up -d --wait`. Afterwards you may switch back to `latest`.
4. Point DNS / the Minecraft servers' `backend-url` to the new host if it changed. Plugins keep their credentials, so no re-registration is needed.

## Inventory recovery

Inventory snapshots and every edit are stored in the database, so they are part of every backup. To undo a single bad edit, use **Roll back** in the player's inventory history instead of restoring a backup – it creates an inverse revision protected by the same compare-and-set checks ([details](../architecture/inventory.md#rollback-and-history)).
