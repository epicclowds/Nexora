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

Deploy the standalone [`docker-compose.yml`](https://github.com/epicclowds/Nexora/blob/main/docker-compose.yml) with the Compose CLI, [Portainer](portainer.md) or [Arcane](arcane.md) as described in the [installation guide](README.md#3-deploy-the-stack). All settings are environment variables – see the [environment variable reference](environment.md). Production decisions:

- **Secrets:** four random values (`MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`), stored outside the host (password manager). A `.env` file must be readable only by the operator (`chmod 600 .env`) and never committed.
- **Version:** `latest` follows verified stable releases when you pull; pin `NEXORA_VERSION` (e.g. `1.1.0`) if updates must be planned and tested first ([Updating](updating.md#stable-or-pinned)).
- **Exposure:** `DASHBOARD_BIND=127.0.0.1` behind a reverse proxy on the same host; `COOKIE_SECURE=true` with HTTPS.

## 3. Start and secure

- Wait until all services are *healthy* (`docker compose up -d --wait`, or the stack page in Portainer/Arcane). The backend is healthy only after migrations ran and MySQL and Redis answer; the dashboard starts after the backend.
- Open the dashboard and run the [setup wizard](README.md#4-setup-wizard) with the setup code from the backend log. English is preselected; the wizard locks itself after completion.
- Firewall: allow only 80/443 (HTTPS) or the dashboard port from the networks that need it. MySQL, Redis and the backend have no published ports.
- Serve the dashboard over [HTTPS](https.md), then set `COOKIE_SECURE=true` and redeploy.

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
- **Monitoring:** container health states (`docker compose ps`, Portainer/Arcane); `GET /api/health/ready` for external monitors; Servers page for plugin heartbeats.
- **Credential hygiene:** rotate a server's credentials on its page when a server is reinstalled or compromised; revoke unused registration tokens.

## Checklist

- [ ] Secrets generated randomly, stored in a password manager; `.env` (if used) not committed, `chmod 600`
- [ ] HTTPS active, `COOKIE_SECURE=true`
- [ ] Setup completed, owner password stored in a password manager
- [ ] Only required ports reachable
- [ ] All servers show *Online*; Paper names match `velocity.toml`
- [ ] Backups scheduled and a restore tested
