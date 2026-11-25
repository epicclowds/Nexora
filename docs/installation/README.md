# Installing Nexora

This guide takes you from a server with Docker to a running Nexora dashboard with your Minecraft servers connected.

Nexora is installed from **one file**: [`docker-compose.yml`](https://github.com/epicclowds/Nexora/blob/main/docker-compose.yml). It starts four containers – MySQL 8.4, Redis, the Nexora backend and the Nexora dashboard – from ready-made images. You do **not** clone the repository, download archives, install Node.js, compile anything or run scripts. The Minecraft plugins are ready-made `.jar` files from the [Releases page](https://github.com/epicclowds/Nexora/releases).

**Contents:** [Requirements](#1-requirements) · [Install Docker](#2-install-docker) · [Choose how to deploy](#3-deploy-the-stack) · [Setup wizard](#4-setup-wizard) · [Minecraft plugins](#5-connect-your-minecraft-servers) · [HTTPS](#6-https-and-a-domain) · [Everyday tasks](#7-everyday-tasks) · [Troubleshooting](#8-troubleshooting)

## 1. Requirements

| | Minimum | Notes |
| --- | --- | --- |
| Server | Linux, 64-bit (`x86_64`/`amd64` or `arm64`) | Any current distribution (Debian, Ubuntu, Rocky, …) |
| Memory | 2 GB RAM (4 GB for large networks) | MySQL, Redis, backend and dashboard |
| Disk | 10 GB free | Database grows with players and statistics |
| Software | Docker Engine 24+ with the Compose plugin (v2.20 or newer), or Portainer / Arcane on top of Docker | Standalone Docker – not Docker Swarm |
| Network | Port 3000 (or 80/443 with HTTPS) reachable by your staff **and** by your Minecraft servers | MySQL and Redis are never exposed |
| Minecraft | Velocity proxy + Paper servers, Java 25 | See [compatibility](minecraft-plugins.md#compatibility) |

Nexora can run on the same machine as your Minecraft servers or on a separate one. Run **one** Nexora per Docker host (for a second instance see [`NEXORA_VOLUME_PREFIX`](environment.md#data-volumes)).

## 2. Install Docker

If `docker compose version` already prints a version (or you use Portainer/Arcane), skip this step. Otherwise:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # then log out and in again
docker compose version              # must print "Docker Compose version v2…"
```

## 3. Deploy the stack

You need four secret values. Generate each one with `openssl rand -hex 32` (any Linux/macOS terminal), or use a password manager (letters and digits only is simplest):

| Variable | What it is |
| --- | --- |
| `MYSQL_PASSWORD` | Password of the Nexora database user |
| `MYSQL_ROOT_PASSWORD` | Password of the MySQL administrator |
| `REDIS_PASSWORD` | Password of the Redis cache |
| `JWT_SECRET` | Signs dashboard logins (at least 32 characters) |

> **Store these values safely and never change them later.** MySQL saves its passwords inside its data volume when it starts for the first time. Changing `MYSQL_PASSWORD` afterwards does **not** change the database – the backend would then be locked out (see [P1000](#database-password-mismatch-p1000)). `JWT_SECRET` also encrypts two-factor secrets.

Everything else is optional – see the [environment variable reference](environment.md). Then pick one way:

- **[Docker Compose on the command line](#docker-compose-cli)** – below
- **[Portainer](portainer.md)** – paste the file as a stack
- **[Arcane](arcane.md)** – paste the file as a project

Already running Nexora from the release package or a Git checkout? See [Moving an existing installation](migration.md) – your data is kept.

### Docker Compose (CLI)

```sh
sudo mkdir -p /opt/nexora && sudo chown "$USER" /opt/nexora && cd /opt/nexora
curl -fsSLO https://raw.githubusercontent.com/epicclowds/Nexora/main/docker-compose.yml

# Create .env with random secrets – only for a NEW installation:
if docker volume inspect minecraft-network-manager_mysql-data >/dev/null 2>&1; then
  echo "An existing Nexora database was found: reuse your previous .env instead (see migration.md)."
else
  umask 077
  cat > .env <<EOF
MYSQL_PASSWORD=$(openssl rand -hex 24)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
EOF
fi

docker compose pull           # downloads Nexora, MySQL and Redis
docker compose up -d --wait   # starts everything; returns when all services are healthy (1–2 minutes)
docker compose ps             # all services "healthy"
```

Keep a copy of `.env` somewhere safe (password manager, backup). Add optional settings to `.env` as `NAME=value` lines (e.g. `DASHBOARD_PORT=8080`) and apply them with `docker compose up -d`.

Get the one-time **setup code**:

```sh
docker compose logs backend | grep "Setup code"
```

(If you set `SETUP_TOKEN`, that value is the code.)

## 4. Setup wizard

Open `http://<your-server-ip>:3000` in a browser. The setup wizard guides you through:

1. **Welcome** – shows that backend, database and Redis are running
2. **Database** – connection, MySQL version and migration status (nothing to do)
3. **Owner account** – the setup code from the backend log, your username, email and password
4. **Network** – name, description, Minecraft domain, dashboard URL, language (English preselected), time zone, theme
5. **Velocity** – optionally creates a registration token for your proxy right away
6. **Finish** – summary

The wizard never shows or asks for infrastructure secrets (database passwords, `JWT_SECRET`); those stay in the stack configuration. After completion the wizard is locked: nobody can create another owner or re-initialise the installation. Enable two-factor authentication under **Settings → General**.

## 5. Connect your Minecraft servers

Download `Nexora-Velocity-<version>.jar` and `Nexora-Paper-<version>.jar` from the [latest release](https://github.com/epicclowds/Nexora/releases/latest) (with a pinned `NEXORA_VERSION`, take the same version), then follow the [Minecraft plugin guide](minecraft-plugins.md). In short: **Settings → Minecraft integration → Add a server** generates a ready-to-use `config.properties` with a registration token for each server. The dashboard shows which version the backend runs and warns about plugins of another release.

## 6. HTTPS and a domain

Serve the dashboard over HTTPS in production – either with your existing reverse proxy (Nginx Proxy Manager, Traefik, Caddy, …) or with the built-in Caddy service. See [HTTPS and reverse proxies](https.md).

## 7. Everyday tasks

| Task | Command line | Portainer / Arcane |
| --- | --- | --- |
| Status | `docker compose ps` | Stack / project page |
| Logs | `docker compose logs -f backend` (or `dashboard`, `mysql`) | Container → Logs |
| Stop / start | `docker compose stop` / `docker compose up -d` | Stop / Start buttons |
| Update (you are notified under Settings → Updates) | `docker compose pull && docker compose up -d` – see [Updating](updating.md) | Re-pull images and redeploy – see the platform guide |
| Back up the database | see [Backup & restore](backup-restore.md) | see [Backup & restore](backup-restore.md) |

**Never** use `docker compose down -v` or delete the stack's volumes: that deletes the database. `docker compose down` (without `-v`), stopping or removing a stack, and updates keep all data.

## 8. Troubleshooting

| Problem | Solution |
| --- | --- |
| `required variable MYSQL_PASSWORD is missing a value: MYSQL_PASSWORD is required …` (or `REDIS_PASSWORD`, `JWT_SECRET`, …) | Set the named variable in `.env` or in the stack's environment variables. |
| Backend log: `JWT_SECRET must be at least 32 characters` (or another `Invalid environment configuration` line) | Fix the named variable; the message says what is expected. |
| `pull` fails with "manifest unknown" | `NEXORA_VERSION` names a version that does not exist. Use `latest` or a version from the [releases page](https://github.com/epicclowds/Nexora/releases). |
| `pull` fails with "denied" | Run `docker logout ghcr.io` – the images are public and need no login. |
| Backend log shows `P1000` / "MySQL rejected the credentials" | The database passwords do not match the existing database volume – see [below](#database-password-mismatch-p1000). |
| Backend log: "Migrations failed … Refusing to start" | A database migration failed; nothing is half-applied. Keep the volume, save the log and restore a backup if needed ([Updating](updating.md#if-something-goes-wrong)). |
| A service stays `unhealthy` / "dependency failed to start" | Look at that service's logs. The backend is only healthy when MySQL **and** Redis answer; the dashboard waits for a healthy backend. |
| Dashboard shows "The backend could not be reached" | The backend is starting or unhealthy: check its logs. |
| "Setup code" not in the logs | The installation is already initialised, or the backend is not running yet. |
| Port 3000 already in use | Set `DASHBOARD_PORT` (e.g. `8080`) and redeploy. |
| Empty dashboard / setup wizard after moving to Portainer or Arcane, although Nexora was set up before | The stack uses other volumes than before – see [Moving an existing installation](migration.md#if-the-setup-wizard-appears-again). Do not run the wizard. |
| A Minecraft server does not appear | See [plugin troubleshooting](minecraft-plugins.md#troubleshooting). |

### Database password mismatch (P1000)

**Symptom:** the backend restarts again and again; its log shows `MySQL rejected the credentials of database user "mnm" (Prisma P1000)` while MySQL is healthy.

**Cause:** MySQL created its accounts with the passwords from its **first** start and keeps them in the data volume. Later values of `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD` are only what Nexora *uses*, not what MySQL *expects*. This happens when the variables were regenerated or retyped while the volume was kept.

**Your data is not affected.** Do not delete volumes, do not remove the stack with its volumes, and do not run the setup wizard again.

**Fix A – put the previous values back (preferred).** Take `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD` and `JWT_SECRET` from your old `.env`, password manager or previous stack configuration, set them again and redeploy. The backend becomes healthy within about a minute.

**Fix B – the root password still works, only the Nexora user's password is lost.** Set the database user's password to the value now configured in `MYSQL_PASSWORD`:

```sh
docker compose exec mysql mysql -u root -p
# enter MYSQL_ROOT_PASSWORD, then (replace the password; keep the quotes):
#   ALTER USER 'mnm'@'%' IDENTIFIED BY 'the-value-of-MYSQL_PASSWORD';
#   exit
docker compose up -d
```

In Portainer/Arcane, open a console (`/bin/sh`) in the MySQL container and run `mysql -u root -p` there.

**Fix C – both passwords are lost.** Use [`repair-db-credentials.sh`](https://github.com/epicclowds/Nexora/blob/main/infrastructure/scripts/repair-db-credentials.sh) from the release package or a repository checkout on the Docker host. It never deletes data: it takes a full backup, starts MySQL once in maintenance mode and sets both passwords to the configured values (it needs the command line, a `.env` file and the `docker-compose.yml` in the same folder).

If `JWT_SECRET` also changed and the old value is lost, everybody signs in again, and authenticator codes stop working because the two-factor secrets are encrypted with it: users sign in with a **recovery code** and set up two-factor authentication again (an administrator can reset it under User Management).

## Optional: IP geolocation

To show approximate player locations, add the free MaxMind GeoLite2 databases as described in [Player profiles](../architecture/player-profiles.md#ip-geolocation-optional). Nexora works normally without them.

## Ports and exposure

| Service | Published | Notes |
| --- | --- | --- |
| dashboard | `DASHBOARD_BIND:DASHBOARD_PORT` (default `0.0.0.0:3000`) | Also serves the API under `/api` |
| caddy (optional, profile `https`) | 80, 443 | See [HTTPS](https.md) |
| backend, mysql, redis | none | Internal Docker network only |

API documentation (OpenAPI) is available at `http://<host>:3000/api/docs` unless `API_DOCS_ENABLED=false`.

## Other installation methods

- **Release package** (`nexora-deploy-<version>.tar.gz` on each release): the same `docker-compose.yml` plus helper scripts (`generate-secrets.sh`, `backup.sh`, `restore.sh`, `repair-db-credentials.sh`). Extract it, run `sh infrastructure/scripts/generate-secrets.sh`, then `docker compose pull && docker compose up -d`.
- **Building from source** (development only): `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` in a repository checkout. See [Development](../development/README.md).

More: [Environment variables](environment.md) · [Portainer](portainer.md) · [Arcane](arcane.md) · [Updating](updating.md) · [Backup & restore](backup-restore.md) · [HTTPS](https.md) · [Moving an existing installation](migration.md) · [Production checklist](deployment.md)
