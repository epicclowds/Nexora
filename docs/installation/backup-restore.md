# Backup & restore

> **Status:** these are documented manual procedures for v0.1.0. They have **not yet been verified end-to-end** in CI; automated, scheduled backups with retention and tested restore are planned for the production-readiness phase.

All persistent state lives in two Docker volumes:

| Volume | Contents | Critical |
| --- | --- | --- |
| `minecraft-network-manager_mysql-data` | All application data | Yes |
| `minecraft-network-manager_redis-data` | Rate-limit counters, caches | No (can be lost) |

Also back up your `.env` file (it contains the database credentials and `JWT_SECRET`) and store it securely – it contains secrets.

## Database backup (consistent, online)

```sh
mkdir -p backups
docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction --routines --triggers --no-tablespaces -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip > "backups/mnm-$(date +%Y%m%d-%H%M%S).sql.gz"
```

`--single-transaction` produces a consistent snapshot without locking InnoDB tables. Backups contain personal data (e.g. IP addresses): store them encrypted and restrict access. Example retention (keep 14 days):

```sh
find backups -name 'mnm-*.sql.gz' -mtime +14 -delete
```

Schedule both commands with cron on the host, e.g. daily at 03:30.

## Restore

```sh
docker compose stop backend dashboard
gunzip -c backups/mnm-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose exec -T mysql sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
docker compose start backend dashboard
```

Restore into the same application version that created the backup (or older migrations will be re-applied forward on start).

## Disaster recovery

1. Provision a new host, clone the repository at the same version, restore `.env`.
2. `docker compose up -d mysql redis` and wait until healthy.
3. Restore the latest database backup (above).
4. `docker compose up -d`.

Inventory snapshot recovery will be documented with the inventory module (v0.6.0).
