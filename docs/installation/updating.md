# Updating

Nexora is released as one version for all components: backend image, dashboard image and both Minecraft plugins carry the same number (e.g. `1.0.2`). Always update them together. Release notes (new features, breaking changes, migration notes) are on the [Releases page](https://github.com/epicclowds/Nexora/releases).

## 1. Back up

```sh
sh infrastructure/scripts/backup.sh
```

Database migrations are forward-only and cannot be undone automatically ([Backup & restore](backup-restore.md)).

## 2. Update the server (Docker)

Your installation is **pinned** to the version in `.env` – it never switches to a new release by itself:

```dotenv
NEXORA_VERSION=1.0.2
```

To update:

1. Read the release notes of every version between yours and the new one.
2. Set `NEXORA_VERSION` in `.env` to the new version.
3. Pull and restart:

   ```sh
   docker compose pull
   docker compose up -d
   docker compose ps        # all services healthy again
   ```

If a release changes `docker-compose.yml` or `.env.example` (the release notes say so), take the new files from the release's `nexora-deploy-<version>.tar.gz` (or `git checkout v<version>` in a Git checkout) before step 3, keeping your own `.env`.

`docker compose pull` alone only refreshes images of the version that is already configured; it never upgrades you to another release.

## 3. Update the Minecraft plugins

Download `Nexora-Velocity-<version>.jar` and `Nexora-Paper-<version>.jar` of the same release, replace the old jars in `plugins/` and restart the servers ([details](minecraft-plugins.md#5-updating-the-plugins)). Until then the dashboard marks the servers with *Update recommended* or *Update required*.

## What happens during an update

1. Containers are recreated; the volumes `mysql-data` and `redis-data` are kept.
2. The backend applies pending database migrations before it starts serving requests. If a migration fails, the backend refuses to start (nothing is half-applied silently) – restore the backup and report the problem. To run migrations manually instead, set `RUN_MIGRATIONS=false` on the backend service.
3. Startup synchronisation adds new permissions and languages without overwriting customised roles.
4. Plugins keep working during the update: they buffer events and keep enforcing punishments from their local cache until the backend is back.

## Upgrading from 1.0.0

1.0.2 changes how the images are referenced: `.env` uses `NEXORA_VERSION` (and optionally `NEXORA_IMAGE_PREFIX`) instead of `MNM_VERSION`/`MNM_IMAGE_PREFIX`, and `docker-compose.yml` pulls the published images instead of building them locally. Replace `docker-compose.yml` with the one from the 1.0.2 release, add `NEXORA_VERSION=1.0.2` to your `.env` and remove the `MNM_*` lines. The Compose project name and volumes are unchanged, so your data is kept. The plugin files are now called `Nexora-*.jar`: delete the old `NetworkManager-*.jar` files when installing the new ones (configuration folders stay the same).

## Using images from another registry

Set `NEXORA_IMAGE_PREFIX` in `.env` (default `ghcr.io/epicclowds/nexora`) to pull mirrored images, e.g. from a private registry.
