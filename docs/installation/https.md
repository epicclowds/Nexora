# HTTPS

## Built-in Caddy (recommended)

1. Point a DNS record (e.g. `admin.example.net`) at the host. Ports 80 and 443 must be reachable.
2. In `.env`:

   ```dotenv
   DASHBOARD_DOMAIN=admin.example.net
   ACME_EMAIL=you@example.net
   DASHBOARD_BIND=127.0.0.1   # stop exposing plain HTTP on :3000
   COOKIE_SECURE=true
   ```

3. Start with the profile:

   ```sh
   docker compose --profile https up -d
   ```

Caddy obtains and renews Let's Encrypt certificates automatically and adds HSTS.

## Your own reverse proxy

Forward all traffic to the dashboard (`:3000`). Requirements:

- Terminate TLS and set `X-Forwarded-Proto: https`.
- **Overwrite** (do not append to) `X-Forwarded-For` with the real client address – the dashboard forwards only the right-most hop to the backend.
- Set `COOKIE_SECURE=true`.

Example (nginx):

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```
