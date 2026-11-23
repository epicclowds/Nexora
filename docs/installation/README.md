# Installation

## Requirements

- Linux host (x86_64 or arm64) with Docker Engine 24+ and the Docker Compose plugin
- 2 GB RAM minimum (MySQL, Redis, backend, dashboard)
- A domain name if you want HTTPS (recommended for production)

Node.js, MySQL and Redis do **not** need to be installed on the host.

## Steps

1. **Clone the repository**

   ```sh
   git clone <repository-url> minecraft-network-manager
   cd minecraft-network-manager
   ```

2. **Create the environment file with secrets**

   ```sh
   sh infrastructure/scripts/generate-secrets.sh
   ```

   This copies `.env.example` to `.env` and fills `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD` and `JWT_SECRET` with random hex values (requires `openssl`). You can also edit `.env` by hand – use only letters and digits in passwords because they are embedded in connection URLs.

3. **Start the stack**

   ```sh
   docker compose up -d --build
   ```

   The first start builds the images, initialises MySQL and applies all database migrations automatically. Check progress with `docker compose ps` – all services should become `healthy`.

4. **Get the setup code**

   ```sh
   docker compose logs backend | grep "Setup code"
   ```

   The code is regenerated on every backend start until setup is complete. Alternatively set `SETUP_TOKEN` in `.env` (min. 16 characters).

5. **Run the setup wizard** at `http://<host>:3000`:
   1. Welcome – backend, database and Redis status
   2. Database – connectivity, server version, migration status
   3. Owner account – setup code, username, email, password
   4. Network – name, description, Minecraft domain, dashboard URL, default language (English preselected), time zone, theme
   5. Velocity – generate a single-use registration token (valid 30 minutes) or skip
   6. Finish – summary

   After completion the wizard is locked; the setup endpoint returns `409`.

6. **Connect the Minecraft servers** – install the Velocity and Paper plugins: see [Minecraft plugins](minecraft-plugins.md).

## Optional: IP geolocation

To show approximate player locations, add the free MaxMind GeoLite2 databases as described in [Player profiles](../architecture/player-profiles.md#ip-geolocation-optional).

## Ports and exposure

| Service | Exposed | Notes |
| --- | --- | --- |
| dashboard | `DASHBOARD_BIND:DASHBOARD_PORT` (default `0.0.0.0:3000`) | Also proxies the API under `/api` |
| caddy (profile `https`) | 80, 443 | See [HTTPS](https.md) |
| backend | internal only | Reachable through the dashboard at `/api` |
| mysql, redis | internal only | Never published by default |

API documentation (OpenAPI) is available at `http://<host>:3000/api/docs` unless `API_DOCS_ENABLED=false`.

## Troubleshooting

- `docker compose logs backend` – startup, migrations and setup code.
- Backend `unhealthy`: check that MySQL is healthy and that `.env` passwords contain no special characters.
- Dashboard shows "The backend could not be reached": the backend container is not healthy yet.

More: [Updating](updating.md) · [Backup & restore](backup-restore.md) · [HTTPS](https.md)
