# Moving an existing installation to the standalone stack

Installations made with an earlier `docker-compose.yml` – from the release package (`nexora-deploy-<version>.tar.gz`) or a Git checkout – can switch to the standalone file, to Portainer or to Arcane **without losing data**. Nothing is converted or copied: the new stack simply uses the existing Docker volumes.

## Why the data is found

Earlier versions used the Compose project name `minecraft-network-manager`, so Docker created the volumes `minecraft-network-manager_mysql-data` and `minecraft-network-manager_redis-data`. The standalone file gives its volumes exactly these names explicitly – whatever the stack is called. This is tested in CI: an installation created with the v1.1.0 `docker-compose.yml` is switched to the standalone file and redeployed under another stack name, and all data is verified each time.

Check your volume names first:

```sh
docker volume ls | grep mysql-data
```

- `minecraft-network-manager_mysql-data` → nothing to configure.
- Another name such as `myproject_mysql-data` (you used `-p myproject` or `COMPOSE_PROJECT_NAME`) → set `NEXORA_VOLUME_PREFIX=myproject` in the new stack's variables.

## Steps

1. **Back up** the database (in the old folder): `sh infrastructure/scripts/backup.sh` ([Backup & restore](backup-restore.md)). Keep a copy of the old `.env`.
2. **Stop the old stack without deleting volumes** (in the old folder):

   ```sh
   docker compose down        # never add -v
   ```

3. **Deploy the standalone stack on the same Docker host with the same values** as the old `.env`:
   - **Command line:** replace `docker-compose.yml` in the old folder with the [new one](https://raw.githubusercontent.com/epicclowds/Nexora/main/docker-compose.yml) and keep `.env` – then `docker compose pull && docker compose up -d`. (Or use a new folder with the new file and a copy of the old `.env`.)
   - **Portainer / Arcane:** create a stack/project with the pasted file and copy the old `.env` content into its environment variables ([Portainer](portainer.md), [Arcane](arcane.md)).

   At least `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, and – if you changed them – `MYSQL_DATABASE` and `MYSQL_USER` must be the old values.
4. **Check:** sign in to the dashboard with your existing account. Your players, punishments and servers are there; the Minecraft plugins reconnect by themselves.

When the stack starts on volumes created by an earlier installation, Docker Compose prints a warning such as `volume "minecraft-network-manager_mysql-data" already exists but was created for project "minecraft-network-manager" (expected "nexora")`. This is expected and harmless: it confirms that the existing data volume is used.

### Changes to note

| Before | Standalone file |
| --- | --- |
| `NEXORA_VERSION` pinned in `.env` (e.g. `1.1.0`) | Your `.env` keeps that pin. Without `NEXORA_VERSION` the default is `latest` ([stable or pinned](updating.md#stable-or-pinned)) |
| GeoIP files in `./geoip` next to `docker-compose.yml` | Set `GEOIP_DIR=./geoip` (command line, same folder) or the absolute path of that folder. Without it, geolocation is off (Nexora works normally) |
| HTTPS with `infrastructure/docker/Caddyfile` | No file needed: the Caddy configuration is generated from `DASHBOARD_DOMAIN`/`ACME_EMAIL`; certificates stay in the same volume |
| Helper scripts in `infrastructure/scripts/` | Still usable from the release package; every task also has a plain Docker command ([Backup & restore](backup-restore.md)) |

## If the setup wizard appears again

If the dashboard shows the setup wizard although Nexora was set up before, the stack started with a **new, empty** database volume (different volume names). **Do not run the wizard.** Your data is still in the old volume:

1. Stop the new stack (without deleting volumes).
2. `docker volume ls | grep mysql-data` – find the old volume (`<prefix>_mysql-data`).
3. Set `NEXORA_VOLUME_PREFIX=<prefix>` in the stack's variables and deploy again.
4. Once everything works, the unused empty volume can be removed by hand (`docker volume rm <name>` – check the name twice).

## If the backend reports P1000

The secret values differ from the ones the existing database was created with. Use the values from the old `.env` – see [Database password mismatch](README.md#database-password-mismatch-p1000). Never delete the volume to "fix" this.
