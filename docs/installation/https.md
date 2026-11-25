# HTTPS and reverse proxies

The dashboard (port `3000`) also serves the API under `/api`, so one HTTPS endpoint covers the browser and the Minecraft plugins. MySQL, Redis and the backend are never exposed.

After HTTPS works, set `COOKIE_SECURE=true` and redeploy. Use the `https://` address as *Dashboard URL* in **Settings → General** and as `backend-url` in the plugin configurations.

## Your own reverse proxy

Point the proxy at `http://<docker-host>:3000`. If the proxy runs on the same host, set `DASHBOARD_BIND=127.0.0.1` so that plain HTTP is no longer reachable from outside.

Requirements for every proxy:

- Terminate TLS and send `X-Forwarded-Proto: https`.
- **Overwrite** (do not append to) `X-Forwarded-For` with the real client address – the dashboard forwards only the right-most hop to the backend.
- The proxy must reach the dashboard from an address listed in `TRUST_PROXY` (default: loopback, link-local and private networks – this covers proxies on the same host or in a Docker network). Otherwise the backend logs the proxy's address instead of the client's.
- No special WebSocket settings are needed; the live updates use Server-Sent Events (long-lived HTTP responses), so do not buffer `/api/events` (most proxies stream by default).

**Nginx Proxy Manager:** add a *Proxy Host* for your domain → scheme `http`, forward host = the Docker host's IP (or the dashboard container's name if NPM is in the same Docker network), port `3000` → *SSL*: request a Let's Encrypt certificate, enable *Force SSL* and *HTTP/2*. NPM sets `X-Forwarded-For` and `X-Forwarded-Proto` itself.

**Traefik** (labels on the `dashboard` service, Traefik in the same Docker network):

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.nexora.rule=Host(`admin.example.net`)
      - traefik.http.routers.nexora.entrypoints=websecure
      - traefik.http.routers.nexora.tls.certresolver=letsencrypt
      - traefik.http.services.nexora.loadbalancer.server.port=3000
```

(Add the Traefik network to the `dashboard` service; the entry point and resolver names depend on your Traefik configuration.)

**Caddy (your own):**

```caddyfile
admin.example.net {
	reverse_proxy 127.0.0.1:3000
}
```

**nginx:**

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;   # live updates (Server-Sent Events)
}
```

## Built-in Caddy

If nothing else on the host uses ports 80 and 443, the stack can obtain and renew Let's Encrypt certificates itself. Its configuration is generated at start-up from two variables – no Caddyfile on the host.

1. Point a DNS record (e.g. `admin.example.net`) at the host; ports 80 and 443 must be reachable from the internet.
2. Set the variables:

   ```dotenv
   DASHBOARD_DOMAIN=admin.example.net
   ACME_EMAIL=you@example.net     # optional, for expiry notices from Let's Encrypt
   DASHBOARD_BIND=127.0.0.1        # stop exposing plain HTTP on :3000
   COOKIE_SECURE=true
   ```

3. Enable the `caddy` service, which is behind the Compose profile `https`:
   - Command line: `docker compose --profile https up -d`, or add `COMPOSE_PROFILES=https` to `.env` and use `docker compose up -d` as usual.
   - Portainer / Arcane: delete the line `profiles: [https]` from the `caddy` service in the stack editor ([Portainer](portainer.md#https), [Arcane](arcane.md#https)).

Caddy adds HSTS, compresses responses and replaces client-supplied `X-Forwarded-For` headers. Certificates are stored in the `…_caddy-data` volume. If `DASHBOARD_DOMAIN` is missing, the Caddy container stops with an explanation in its log. The built-in HTTPS is tested in CI with a local certificate (`DASHBOARD_DOMAIN=localhost`); obtaining a real Let's Encrypt certificate needs a public domain and is not part of the automated tests.
