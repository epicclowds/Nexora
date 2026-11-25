# Installing with Portainer

[Portainer](https://www.portainer.io/) deploys Nexora as a *stack* from the pasted `docker-compose.yml`. No files on the Docker host are needed.

> **Tested:** the stack is tested in CI the way Portainer deploys it (`docker compose` with a separate project name and an environment file, no other files). Portainer's own interface was not part of these tests; menu names below refer to Portainer CE 2.x and may differ slightly in other versions.

Requirements: a **Docker Standalone** environment in Portainer (not Docker Swarm – Swarm ignores the start-up order and health conditions the stack relies on).

## Install

1. **Create the secrets.** You need values for `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD` and `JWT_SECRET` – random letters and digits, at least 32 characters for `JWT_SECRET` (e.g. `openssl rand -hex 32` or a password manager). **Save them in a password manager** – the MySQL passwords can not be changed later by editing the stack ([why](environment.md#required)).
2. In Portainer, select your environment → **Stacks** → **Add stack**.
3. **Name:** e.g. `nexora` (any name; the data volumes have fixed names).
4. **Build method:** *Web editor*. Paste the complete content of [`docker-compose.yml`](https://raw.githubusercontent.com/epicclowds/Nexora/main/docker-compose.yml).
   (Alternatively *Repository*: URL `https://github.com/epicclowds/Nexora`, reference `refs/heads/main`, compose path `docker-compose.yml`.)
5. **Environment variables:** switch to *Advanced mode* and enter (with your values):

   ```dotenv
   MYSQL_PASSWORD=your-database-password
   MYSQL_ROOT_PASSWORD=your-root-password
   REDIS_PASSWORD=your-redis-password
   JWT_SECRET=your-64-character-random-secret
   ```

   Optional settings go here as well, e.g. `DASHBOARD_PORT=8080` or `NEXORA_VERSION=1.1.0` – see [Environment variables](environment.md).
6. Click **Deploy the stack**. The first deployment downloads the images and starts MySQL, Redis, the backend (which applies the database migrations) and the dashboard; it takes one to two minutes. If a required variable is missing, Portainer shows the error `… is required - set it in the stack environment variables …`.
7. Open **Containers**: all four containers should become *healthy*. Open the logs of the **backend** container and look for `Setup code:`.
8. Open `http://<docker-host>:3000` (or your `DASHBOARD_PORT`) and complete the [setup wizard](README.md#4-setup-wizard) with the setup code.

## Update

With `NEXORA_VERSION=latest` (default): **Stacks** → your stack → **Editor** → **Update the stack** with **Re-pull image and redeploy** enabled. Portainer downloads newer images and recreates only the containers whose image changed. Volumes and data are kept; the backend applies database migrations on start.

With a pinned version: change `NEXORA_VERSION` in the stack's environment variables to the new version, then **Update the stack** (with re-pull enabled).

Before updating, back up the database ([Backup & restore](backup-restore.md)) and read the [release notes](https://github.com/epicclowds/Nexora/releases). Update the Minecraft plugins to the same release ([Updating](updating.md)).

To take a newer version of `docker-compose.yml` itself (only when the release notes say so), paste it into the editor, keep your environment variables and update the stack.

**Never** remove the stack's volumes, and do not use "remove stack" followed by a new stack with new passwords: the new MySQL passwords would not match the existing database ([P1000](README.md#database-password-mismatch-p1000)).

## HTTPS

Most Portainer users already run a reverse proxy (Nginx Proxy Manager, Traefik, Caddy): point it at `http://<docker-host>:3000` – see [HTTPS](https.md#your-own-reverse-proxy).

The built-in Caddy service is behind the Compose profile `https`, which Portainer does not activate. To use it, set `DASHBOARD_DOMAIN` (and `ACME_EMAIL`) in the environment variables and delete the line `profiles: [https]` from the `caddy` service in the editor before deploying. Ports 80 and 443 of the host must be free.

## Logs, console and backups

- **Logs:** Containers → `…-backend-1` → Logs.
- **Console:** Containers → `…-mysql-1` → Console → `/bin/sh` – used for [backups](backup-restore.md#without-the-helper-scripts) and the [P1000 fix B](README.md#database-password-mismatch-p1000).
- **Volumes:** listed under Volumes as `minecraft-network-manager_mysql-data` etc. Do not delete them.

## Moving an existing installation to Portainer

Stop the old stack with `docker compose down` (**without** `-v`) in its folder, then create the Portainer stack on the **same Docker host** with the **same four secret values** from the old `.env`. The data volumes have the same names, so Nexora starts with all existing data. Details: [Moving an existing installation](migration.md).
