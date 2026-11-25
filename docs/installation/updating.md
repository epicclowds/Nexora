# Updating

Nexora is released as one version for all components: backend image, dashboard image and both Minecraft plugins carry the same number (e.g. `1.1.0`). Update them together. Release notes (new features, breaking changes, migration notes) are on the [Releases page](https://github.com/epicclowds/Nexora/releases).

## Stable or pinned

`NEXORA_VERSION` selects the image tag of the backend and dashboard:

| Mode | Setting | Behaviour |
| --- | --- | --- |
| **Stable** (default) | `NEXORA_VERSION=latest` or not set | Each *pull* fetches the newest stable release. `latest` is moved only after a release passed the complete release pipeline (tests, clean installation from the published images, image scans); development builds and pre-releases never become `latest`. Backend and dashboard of `latest` always belong to the same release. |
| **Pinned** | `NEXORA_VERSION=1.1.0` | Always this version. Nothing changes until you change the value. |

Nothing updates by itself in either mode: images are only downloaded when you pull them (or let Portainer/Arcane re-pull). To switch from stable to pinned, set the version you currently run (shown under the Nexora logo in the dashboard); to switch back, set `latest` or remove the variable.

## 1. Back up

Back up the database before every update ([Backup & restore](backup-restore.md)). Database migrations are forward-only: an older version cannot run on a database that a newer version has migrated.

## 2. Update the server

Read the release notes of every version between yours and the new one, then:

**Command line** (in the folder with `docker-compose.yml`):

```sh
# pinned only: set NEXORA_VERSION=<new version> in .env first
docker compose pull          # downloads the newer images (keeps the old ones until pruned)
docker compose up -d --wait  # recreates only containers whose image or configuration changed
docker compose ps            # all services healthy
```

`docker compose pull` downloads the images named by the current configuration; `docker compose up -d` replaces the running containers with new ones. Named volumes – the database – are never touched by these commands.

**Portainer:** Stack → Editor → *Update the stack* with *Re-pull image and redeploy* ([details](portainer.md#update)). **Arcane:** pull the project's images, then redeploy ([details](arcane.md#update)).

If a release note says that `docker-compose.yml` changed, replace it (or paste the new version into the stack editor) and keep your environment variables.

## If something goes wrong

- The backend refuses to start with `Migrations failed … Refusing to start`: nothing was half-applied. Keep the volume as it is, save the backend log and [open an issue](https://github.com/epicclowds/Nexora/issues). To go back, restore the backup taken before the update **and** pin `NEXORA_VERSION` to the previous version ([Restore](backup-restore.md#restore)). There is no automatic rollback.
- `P1000`: the secret values changed – see [Database password mismatch](README.md#database-password-mismatch-p1000).

## 3. Update the Minecraft plugins

Download `Nexora-Velocity-<version>.jar` and `Nexora-Paper-<version>.jar` of the same release, replace the old jars in `plugins/` and restart the servers ([details](minecraft-plugins.md#5-updating-the-plugins)). Until then the dashboard marks the servers with *Update recommended* or *Update required*.

## What happens during an update

1. Containers are recreated; the volumes (`…_mysql-data`, `…_redis-data`) are kept.
2. The backend applies pending database migrations before it starts serving requests. If a migration fails, the backend refuses to start (nothing is half-applied silently) – restore the backup and report the problem. To run migrations manually instead, set `RUN_MIGRATIONS=false` on the backend service.
3. Startup synchronisation adds new permissions and languages without overwriting customised roles.
4. Plugins keep working during the update: they buffer events and keep enforcing punishments from their local cache until the backend is back.

## Never generate a new `.env` for an existing installation

Whether you update in place, extract a newer release package into a new folder, or move to Portainer or Arcane: **keep your existing secret values** (copy the old `.env`). Do not run `generate-secrets.sh` again – MySQL keeps the passwords of its first start in the data volume, and new passwords make the backend fail with `P1000 Authentication failed` (since 1.0.3 the script refuses when it finds an existing database volume). If it already happened, follow [Database password mismatch](README.md#database-password-mismatch-p1000) – no data is lost.

## Upgrading from 1.0.3 to 1.1.0

1.1.0 adds punishment editing, evidence management and the change history. The database migration only adds columns, a table and permissions; existing punishments, evidence, players and statistics are kept, and every existing punishment receives a `CREATED` history entry. `docker-compose.yml` is unchanged apart from the default version.

1. Take a backup (`infrastructure/scripts/backup.sh`, see [Backup & restore](backup-restore.md)).
2. Set `NEXORA_VERSION=1.1.0` in `.env` (keep everything else), then `docker compose pull && docker compose up -d`.
3. Replace `Nexora-Velocity-1.0.3.jar` and `Nexora-Paper-1.0.3.jar` with the 1.1.0 jars and restart the servers. Configuration folders stay the same; `config.properties` gains an optional `appeal-url`. Until the plugins are updated, 1.0.x plugins keep enforcing punishments (including edits of active ones), but `/editban`, `/editmute`, the remaining time and the appeal link on ban screens are missing.
4. Grant the new permissions to custom roles if needed (system roles receive them automatically): `punishments.edit`, `punishments.edit.reason`, `punishments.edit.duration`, `punishments.edit.permanent`, `punishments.reactivate`, `punishments.evidence.view/add/edit/delete`, `punishments.history.view`; in-game `networkmanager.command.editban`, `networkmanager.command.editmute` and their `.permanent` variants.

## Upgrading from 1.0.2 to 1.0.3

`docker-compose.yml` passes the database and Redis credentials as separate variables, so passwords with special characters work. Take `docker-compose.yml` and `infrastructure/scripts/` from the 1.0.3 release package (keep your `.env`), set `NEXORA_VERSION=1.0.3`, then `docker compose pull && docker compose up -d`. The 1.0.3 backend image still accepts the `DATABASE_URL`/`REDIS_URL` settings of the 1.0.2 `docker-compose.yml`, so the order of these steps does not matter.

## Upgrading from 1.0.0

1.0.2 changes how the images are referenced: `.env` uses `NEXORA_VERSION` (and optionally `NEXORA_IMAGE_PREFIX`) instead of `MNM_VERSION`/`MNM_IMAGE_PREFIX`, and `docker-compose.yml` pulls the published images instead of building them locally. Replace `docker-compose.yml` with the one from the 1.0.2 release, add `NEXORA_VERSION=1.0.2` to your `.env` and remove the `MNM_*` lines. The Compose project name and volumes are unchanged, so your data is kept. The plugin files are now called `Nexora-*.jar`: delete the old `NetworkManager-*.jar` files when installing the new ones (configuration folders stay the same).

## Using images from another registry

Set `NEXORA_IMAGE_PREFIX` in `.env` (default `ghcr.io/epicclowds/nexora`) to pull mirrored images, e.g. from a private registry.
