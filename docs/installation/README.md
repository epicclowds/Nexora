# Installing Nexora

This guide takes you from an empty Linux server to a running Nexora dashboard with your Minecraft servers connected. You do **not** need to compile anything: the backend and dashboard are downloaded as ready-made Docker images, and the Minecraft plugins are ready-made `.jar` files from the [GitHub Releases page](https://github.com/epicclowds/Nexora/releases).

**Contents:** [Requirements](#1-requirements) · [Install Docker](#2-install-docker) · [Download Nexora](#3-download-nexora) · [Configuration](#4-configuration-env) · [Start](#5-start-nexora) · [Setup wizard](#6-setup-wizard) · [Minecraft plugins](#7-connect-your-minecraft-servers) · [HTTPS](#8-https-and-a-domain) · [Everyday commands](#9-everyday-commands) · [Troubleshooting](#10-troubleshooting)

## 1. Requirements

| | Minimum | Notes |
| --- | --- | --- |
| Server | Linux, 64-bit (`x86_64`/`amd64` or `arm64`) | Any current distribution (Debian, Ubuntu, Rocky, …) |
| Memory | 2 GB RAM (4 GB for large networks) | MySQL, Redis, backend and dashboard |
| Disk | 10 GB free | Database grows with players and statistics |
| Software | Docker Engine 24+ with the Compose plugin, `openssl`, `curl` | Step 2 shows how to install them |
| Network | Port 3000 (or 80/443 with HTTPS) reachable by your staff **and** by your Minecraft servers | MySQL and Redis are never exposed |
| Minecraft | Velocity proxy + Paper servers, Java 25 | See [compatibility](minecraft-plugins.md#compatibility) |

Nexora can run on the same machine as your Minecraft servers or on a separate one.

## 2. Install Docker

If `docker compose version` already prints a version, skip this step. Otherwise install Docker with the official script and allow your user to run it:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # then log out and in again
docker compose version              # must print "Docker Compose version v2…"
```

## 3. Download Nexora

Pick **one** of the two ways. Both give you a folder with `docker-compose.yml`, `.env.example` and the helper scripts; neither contains anything you have to build.

**A) Release package (recommended)** – replace `1.0.2` with the [newest release](https://github.com/epicclowds/Nexora/releases/latest):

```sh
mkdir -p /opt && cd /opt
curl -fsSLO https://github.com/epicclowds/Nexora/releases/download/v1.0.2/nexora-deploy-1.0.2.tar.gz
tar -xzf nexora-deploy-1.0.2.tar.gz
cd nexora
```

**B) Git checkout of a release**

```sh
git clone --branch v1.0.2 --depth 1 https://github.com/epicclowds/Nexora.git /opt/nexora
cd /opt/nexora
```

All following commands are run inside this folder.

## 4. Configuration (`.env`)

All settings live in one file, `.env`. Create it with random passwords:

```sh
sh infrastructure/scripts/generate-secrets.sh
```

This copies `.env.example` to `.env` and fills in `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD` and `JWT_SECRET`. Keep `.env` private and back it up – it contains the keys to your data.

Settings you may want to change (open `.env` with any editor, e.g. `nano .env`):

| Setting | Default | Meaning |
| --- | --- | --- |
| `NEXORA_VERSION` | the release you downloaded | Which Nexora images to run. Changing it is how you update (see [Updating](updating.md)). |
| `DASHBOARD_PORT` | `3000` | Port of the dashboard |
| `DASHBOARD_BIND` | `0.0.0.0` | `127.0.0.1` if a reverse proxy on the same machine serves the dashboard |
| `SETUP_TOKEN` | empty | Fixed setup code (min. 16 characters) instead of a random one |
| `COOKIE_SECURE` | `auto` | Set to `true` once HTTPS works |
| `DASHBOARD_DOMAIN`, `ACME_EMAIL` | – | For the built-in HTTPS (step 8) |

The complete list is in [Production deployment](deployment.md#environment-reference-env).

**MySQL and Redis** are part of the stack: they are started automatically, store their data in Docker volumes and are only reachable by Nexora itself. You do not have to install or configure a database, and you never need to run SQL – migrations are applied automatically on every start.

## 5. Start Nexora

```sh
docker compose pull      # downloads Nexora, MySQL, Redis (only the first time and when updating)
docker compose up -d     # starts everything in the background
docker compose ps        # wait until all services show "healthy" (about one minute)
```

Get the one-time **setup code**:

```sh
docker compose logs backend | grep "Setup code"
```

(If you set `SETUP_TOKEN` in `.env`, that value is the code.)

## 6. Setup wizard

Open `http://<your-server-ip>:3000` in a browser. The setup wizard guides you through:

1. **Welcome** – shows that backend, database and Redis are running
2. **Database** – connection, MySQL version and migration status (nothing to do)
3. **Owner account** – the setup code, your username, email and password
4. **Network** – name, description, Minecraft domain, dashboard URL, language (English preselected), time zone, theme
5. **Velocity** – optionally creates a registration token for your proxy right away
6. **Finish** – summary

After this, the wizard is locked and nobody can create another owner. Enable two-factor authentication for your account under **Settings → General**.

## 7. Connect your Minecraft servers

Download `Nexora-Velocity-<version>.jar` and `Nexora-Paper-<version>.jar` from the [release](https://github.com/epicclowds/Nexora/releases/latest) that matches `NEXORA_VERSION`, then follow the step-by-step [Minecraft plugin guide](minecraft-plugins.md). In short: **Settings → Minecraft integration → Add a server** generates a ready-to-use `config.properties` with a registration token for each server.

## 8. HTTPS and a domain

For production, serve the dashboard over HTTPS:

1. Point a DNS record (e.g. `admin.example.net`) to your server and open ports 80 and 443.
2. In `.env` set `DASHBOARD_DOMAIN=admin.example.net`, `ACME_EMAIL=you@example.net`, `COOKIE_SECURE=true` and `DASHBOARD_BIND=127.0.0.1`.
3. Start with the HTTPS profile: `docker compose --profile https up -d`

Caddy obtains and renews certificates automatically. Use `https://admin.example.net` as backend URL in the plugin configurations. Details and other reverse proxies: [HTTPS](https.md).

## 9. Everyday commands

| Task | Command |
| --- | --- |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f backend` (or `dashboard`, `mysql`) |
| Stop / start | `docker compose stop` / `docker compose up -d` |
| Back up the database | `sh infrastructure/scripts/backup.sh` – see [Backup & restore](backup-restore.md) |
| Update | set `NEXORA_VERSION` in `.env`, then `docker compose pull && docker compose up -d` – see [Updating](updating.md) |

Never use `docker compose down -v`: `-v` deletes the database.

## 10. Troubleshooting

| Problem | Solution |
| --- | --- |
| `docker compose pull` fails with "manifest unknown" | `NEXORA_VERSION` names a version that does not exist. Use a version from the [releases page](https://github.com/epicclowds/Nexora/releases). |
| `docker compose pull` fails with "denied" | Run `docker logout ghcr.io` – the images are public and need no login. |
| A service stays `unhealthy` | `docker compose logs <service>`. For the backend, check that MySQL is healthy and that `.env` passwords contain only letters and digits. |
| "Setup code" not found in the logs | The installation is already initialised, or the backend is not running yet (`docker compose ps`). |
| Dashboard says "The backend could not be reached" | The backend is still starting or unhealthy: `docker compose logs backend`. |
| Port 3000 already in use | Change `DASHBOARD_PORT` in `.env`, then `docker compose up -d`. |
| A Minecraft server does not appear in the dashboard | See [plugin troubleshooting](minecraft-plugins.md#troubleshooting). |

## Optional: IP geolocation

To show approximate player locations, add the free MaxMind GeoLite2 databases as described in [Player profiles](../architecture/player-profiles.md#ip-geolocation-optional).

## Ports and exposure

| Service | Exposed | Notes |
| --- | --- | --- |
| dashboard | `DASHBOARD_BIND:DASHBOARD_PORT` (default `0.0.0.0:3000`) | Also serves the API under `/api` |
| caddy (profile `https`) | 80, 443 | See [HTTPS](https.md) |
| backend, mysql, redis | internal only | Never published |

API documentation (OpenAPI) is available at `http://<host>:3000/api/docs` unless `API_DOCS_ENABLED=false`.

## Building from source

Only needed for development: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` builds the images from your checkout. See [Development](../development/README.md).

More: [Production deployment checklist](deployment.md) · [Updating](updating.md) · [Backup & restore](backup-restore.md) · [HTTPS](https.md)
