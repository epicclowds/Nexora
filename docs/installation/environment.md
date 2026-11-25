# Environment variables

`docker-compose.yml` is configured entirely through environment variables – in a `.env` file next to it (command line), or in the stack's *Environment variables* section in Portainer or Arcane. A template with comments is [`.env.example`](https://github.com/epicclowds/Nexora/blob/main/.env.example).

Format: one `NAME=value` per line, no spaces around `=`. Values with `#`, spaces or `"` must be wrapped in single quotes (`MYSQL_PASSWORD='p@ss#word'`). Avoid `$` and `'` in values – Docker Compose treats `$` as the start of a variable. Random hex values (`openssl rand -hex 32`) avoid all of this.

## Required

| Variable | Purpose |
| --- | --- |
| `MYSQL_PASSWORD` | Password of the Nexora database user. **Fixed after the first start** (see below). |
| `MYSQL_ROOT_PASSWORD` | Password of the MySQL `root` account. **Fixed after the first start.** |
| `REDIS_PASSWORD` | Password of Redis. Can be changed at any time (Redis reads it on every start). |
| `JWT_SECRET` | Signs dashboard sessions and encrypts two-factor secrets. At least 32 characters. Changing it signs everybody out and invalidates authenticator setups. |

If one is missing, `docker compose` (and Portainer/Arcane) refuses to deploy with `… is required - set it in the stack environment variables or in .env`. The backend additionally validates its configuration on start and stops with `Invalid environment configuration:` followed by the variable and the problem (e.g. `JWT_SECRET must be at least 32 characters`). No secret is ever printed.

**Special characters** in the three passwords are fine (`@ : / # % ? &` …): the backend builds its database and Redis connection URLs with every part percent-encoded.

**Why the MySQL passwords are fixed:** the MySQL image creates the `root` account and the Nexora user only when its data volume is empty, i.e. on the very first start. Afterwards the passwords live inside the database. Changing `MYSQL_PASSWORD` or `MYSQL_ROOT_PASSWORD` later does **not** change them – the backend would be rejected with `P1000`. To really change a password, change it inside MySQL first ([P1000 fixes](README.md#database-password-mismatch-p1000)), then update the variable.

## Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXORA_VERSION` | `latest` | Image tag of backend and dashboard. `latest` = newest verified stable release; `1.1.0` = pinned ([Updating](updating.md#stable-or-pinned)) |
| `MYSQL_DATABASE` | `mnm` | Database name (only applied when the volume is created) |
| `MYSQL_USER` | `mnm` | Database user (only applied when the volume is created) |
| `SETUP_TOKEN` | empty | Fixed setup code for the wizard (≥ 16 characters). Empty = a random code is printed to the backend log on every start until setup is complete |
| `DASHBOARD_PORT` | `3000` | Published port of the dashboard |
| `DASHBOARD_BIND` | `0.0.0.0` | Address the port is published on. `127.0.0.1` behind a reverse proxy on the same host |
| `COOKIE_SECURE` | `auto` | `true` once the dashboard is served over HTTPS |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Proxies whose `X-Forwarded-For` is trusted ([HTTPS](https.md)) |
| `API_DOCS_ENABLED` | `true` | OpenAPI docs at `/api/docs` |
| `LOG_LEVEL` | `log` | `error`, `warn`, `log`, `debug`, `verbose` |
| `RUN_MIGRATIONS` | `true` | Apply database migrations on backend start. Leave enabled |
| `GEOIP_DIR` | internal volume | Host folder with MaxMind GeoLite2 files, mounted read-only at `/geoip` (e.g. `/opt/nexora/geoip`) – [IP geolocation](../architecture/player-profiles.md#ip-geolocation-optional) |
| `GEOIP_CITY_DB`, `GEOIP_ASN_DB` | empty | Paths inside the container, e.g. `/geoip/GeoLite2-City.mmdb`. Empty = geolocation off |
| `DASHBOARD_DOMAIN`, `ACME_EMAIL` | empty | Built-in HTTPS (Caddy, profile `https`) – [HTTPS](https.md) |
| `NEXORA_IMAGE_PREFIX` | `ghcr.io/epicclowds/nexora` | Registry/namespace of the images (mirrors) |
| `NEXORA_VOLUME_PREFIX` | `minecraft-network-manager` | Prefix of the data volume names – see below |

## Data volumes

The stack stores its data in named Docker volumes with **fixed names**, independent of the stack or project name:

| Volume | Content | Important |
| --- | --- | --- |
| `minecraft-network-manager_mysql-data` | The database: everything Nexora stores | Yes – back it up ([Backup & restore](backup-restore.md)) |
| `minecraft-network-manager_redis-data` | Caches, rate limits | No – rebuilt automatically |
| `minecraft-network-manager_geoip` | Optional GeoLite2 files (when `GEOIP_DIR` is not set) | No |
| `minecraft-network-manager_caddy-data`, `…_caddy-config` | Certificates of the built-in HTTPS | Only with the `https` profile |

These are the same names that earlier Nexora versions created with `docker compose`, so an existing installation keeps its data when it is redeployed from Portainer, Arcane or another folder ([Moving an existing installation](migration.md)).

`NEXORA_VOLUME_PREFIX` changes the `minecraft-network-manager` part. Set it only if you deliberately run a **second, independent** Nexora on the same Docker host (e.g. `NEXORA_VOLUME_PREFIX=nexora-test`, plus another `DASHBOARD_PORT`) – two stacks with the same prefix would try to use the same database files, and the second MySQL refuses to start. It is also the way to point the stack at volumes of an installation that used a custom Compose project name.

## Where the variables are entered

| Platform | Where |
| --- | --- |
| Docker Compose CLI | `.env` in the same folder as `docker-compose.yml` (`chmod 600 .env`) |
| Portainer | Stack editor → *Environment variables* (*Advanced mode* accepts the `.env` format) – [Portainer](portainer.md) |
| Arcane | Project → `.env` editor – [Arcane](arcane.md) |

Keep a copy of the four required values outside the Docker host (password manager or backup). Without the MySQL passwords and `JWT_SECRET`, a restored database cannot be used as before.
