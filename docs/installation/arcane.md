# Installing with Arcane

[Arcane](https://github.com/getarcaneapp/arcane) manages Docker Compose *projects* (called *stacks* in older versions): a `compose.yaml` plus an `.env` file that you edit in its web interface. Nexora's `docker-compose.yml` is used unchanged.

> **Tested:** the stack is tested in CI exactly as a Compose project with an environment file and no other files – which is how Arcane runs it. Arcane's own interface was not part of these tests, and its menu names change between versions; the steps below describe the workflow, not exact button labels.

## Install

1. **Create the secrets.** You need values for `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD` and `JWT_SECRET` – random letters and digits, at least 32 characters for `JWT_SECRET` (e.g. `openssl rand -hex 32` or a password manager). **Save them in a password manager** – the MySQL passwords can not be changed later by editing the project ([why](environment.md#required)).
2. In Arcane, open **Projects** (or **Stacks**) and create a new project, e.g. `nexora`.
3. Paste the complete content of [`docker-compose.yml`](https://raw.githubusercontent.com/epicclowds/Nexora/main/docker-compose.yml) into the compose editor.
4. In the project's **`.env` editor**, enter:

   ```dotenv
   MYSQL_PASSWORD=your-database-password
   MYSQL_ROOT_PASSWORD=your-root-password
   REDIS_PASSWORD=your-redis-password
   JWT_SECRET=your-64-character-random-secret
   ```

   Optional settings go here as well – see [Environment variables](environment.md).
5. Save and **deploy / start** the project. The first start downloads the images and takes one to two minutes; all four containers become *healthy*.
6. Open the logs of the **backend** container and look for `Setup code:`.
7. Open `http://<docker-host>:3000` and complete the [setup wizard](README.md#4-setup-wizard).

## Update

With `NEXORA_VERSION=latest` (default): use the project's **pull / update images** action, then **redeploy** (Arcane runs the equivalent of `docker compose pull` and `docker compose up -d`). Containers whose image changed are recreated; volumes and data are kept, and the backend applies database migrations on start.

With a pinned version: change `NEXORA_VERSION` in the project's `.env`, then pull and redeploy.

Arcane can show that newer images are available. Update deliberately: back up the database first ([Backup & restore](backup-restore.md)), read the [release notes](https://github.com/epicclowds/Nexora/releases), and update the Minecraft plugins to the same release ([Updating](updating.md)).

**Never** delete the project's volumes or replace the `.env` with new passwords – see [P1000](README.md#database-password-mismatch-p1000).

## HTTPS

Point your existing reverse proxy at `http://<docker-host>:3000` ([HTTPS](https.md#your-own-reverse-proxy)). For the built-in Caddy service, set `DASHBOARD_DOMAIN` (and `ACME_EMAIL`) in the `.env` and either add `COMPOSE_PROFILES=https` there or delete the line `profiles: [https]` from the `caddy` service – whether `COMPOSE_PROFILES` in the project's `.env` is honoured depends on how your Arcane version invokes Compose; deleting the line always works.

## Moving an existing installation to Arcane

Stop the old installation with `docker compose down` (**without** `-v`) in its folder, then create the Arcane project on the **same Docker host** with the **same four secret values** from the old `.env` (or copy the whole old `.env` into Arcane's `.env` editor). The data volumes have the same names, so Nexora starts with all existing data. Details: [Moving an existing installation](migration.md).
