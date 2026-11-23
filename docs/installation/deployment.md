# Production deployment

This guide takes a fresh Linux host to a production installation. The short version is in the [installation guide](README.md); this page adds the decisions and checks that matter in production.

## 1. Plan

| Topic | Recommendation |
| --- | --- |
| Host | Linux x86_64/arm64, Docker Engine 24+ with Compose, 2 GB RAM (4 GB for large networks), SSD |
| Network | The dashboard must be reachable by staff (browser) **and** by every Minecraft server (plugins). Database and Redis are never exposed. |
| Domain & TLS | A domain such as `admin.example.net` with HTTPS (bundled Caddy profile or your own reverse proxy) |
| Same host as Minecraft? | Possible. Plugins can then use the private address (`http://10.0.0.5:3000`); staff should still use HTTPS. |

## 2. Configure the environment

```sh
git clone <repository-url> minecraft-network-manager
cd minecraft-network-manager
sh infrastructure/scripts/generate-secrets.sh   # creates .env with random secrets
```

### Environment reference (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `MYSQL_DATABASE`, `MYSQL_USER` | `mnm` | Database and user |
| `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` | – (required) | Database passwords, letters and digits only |
| `REDIS_PASSWORD` | – (required) | Redis password, letters and digits only |
| `JWT_SECRET` | – (required) | Signs session tokens, ≥ 32 random characters |
| `SETUP_TOKEN` | empty | Fixed setup code (≥ 16 chars); empty = random code in the backend log |
| `DASHBOARD_BIND`, `DASHBOARD_PORT` | `0.0.0.0`, `3000` | Published address of the dashboard. Use `127.0.0.1` behind a reverse proxy on the same host. |
| `COOKIE_SECURE` | `auto` | `true` behind HTTPS |
| `TRUST_PROXY` | private ranges | Proxies whose `X-Forwarded-For` is trusted ([HTTPS](https.md)) |
| `GEOIP_CITY_DB`, `GEOIP_ASN_DB` | empty | Optional GeoLite2 databases in `./geoip` |
| `API_DOCS_ENABLED` | `true` | OpenAPI docs at `/api/docs` |
| `LOG_LEVEL` | `log` | `error`, `warn`, `log`, `debug`, `verbose` |
| `DASHBOARD_DOMAIN`, `ACME_EMAIL` | – | Caddy HTTPS profile |
| `MNM_IMAGE_PREFIX`, `MNM_VERSION` | `mnm`, `latest` | Prebuilt images from a registry instead of local builds |

`.env` contains secrets: keep it out of version control and readable only by the operator (`chmod 600 .env`).

## 3. Start and secure

```sh
docker compose up -d --build                 # or: docker compose --profile https up -d --build
docker compose ps                            # all services healthy
docker compose logs backend | grep "Setup code"
```

- Open the dashboard and run the [setup wizard](README.md#steps). English is preselected; the wizard locks itself after completion.
- Firewall: allow only 80/443 (HTTPS profile) or the dashboard port from the networks that need it. MySQL and Redis have no published ports.
- Set `COOKIE_SECURE=true` once HTTPS works and restart: `docker compose up -d`.

## 4. Configure the network

In the dashboard, as owner:

1. **Settings → General** – network details and the dashboard URL (used as the default backend URL for plugin configurations).
2. **User Management** – invite staff with the least privileged role that fits; review role permissions.
3. **Settings → Minecraft integration** – add the Velocity proxy and every Paper server with the generator ([details](../architecture/configuration.md#adding-a-server-registration-workflow)). Install the plugins as described in [Minecraft plugins](minecraft-plugins.md).
4. **Settings → Plugin settings** – network-wide plugin language, statistics and inventory options, message texts.
5. **Settings → Moderation** – punishment templates; **AntiCheat** – rules (nothing is punished automatically until you add rules).
6. **Settings → Languages / Privacy** – languages offered to staff, IP retention period.

## 5. Operate

- **Backups:** schedule the database and configuration backups with cron and test a restore – see [Backup & restore](backup-restore.md). Plugin data folders (`credentials.properties`, `punishments-cache.json`, `managed-settings.json`) belong into the Minecraft servers' own backups.
- **Updates:** [Updating](updating.md). Database migrations run automatically on start; take a backup first.
- **Monitoring:** `docker compose ps` health states; `GET /api/health/ready` for external monitors; Servers page for plugin heartbeats.
- **Credential hygiene:** rotate a server's credentials on its page when a server is reinstalled or compromised; revoke unused registration tokens.

## Checklist

- [ ] `.env` generated, not committed, `chmod 600`
- [ ] HTTPS active, `COOKIE_SECURE=true`
- [ ] Setup completed, owner password stored in a password manager
- [ ] Only required ports reachable
- [ ] All servers show *Online*; Paper names match `velocity.toml`
- [ ] Backups scheduled and a restore tested
