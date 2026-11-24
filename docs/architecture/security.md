# Security model

## Dashboard authentication

| Mechanism | Implementation |
| --- | --- |
| Password hashing | Argon2id (m=19 MiB, t=2, p=1); minimum length 12; constant-time path for unknown users |
| Sessions | `dashboard_sessions` row per login. Access token: HS256 JWT (15 min, audience `mnm-dashboard`) in `mnm_access`. Refresh token: 48 random bytes, stored as SHA-256, rotated on every use, cookie `mnm_refresh` scoped to `/api/auth` |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` when served over HTTPS (`COOKIE_SECURE=auto`) |
| Revocation | Every request checks the session row, so logout, disabling a user, password or role changes take effect immediately |
| CSRF | All state-changing requests must send `X-MNM-CSRF: 1` (cannot be set cross-site without a CORS preflight; CORS is not enabled) in addition to `SameSite=Strict` |
| Brute force | Per-IP limits in Redis (login: 5/min, 5 min block) **and** per-account lockout after 10 failures for 15 minutes |
| 2FA | Optional TOTP (RFC 6238, authenticator apps) per account: enrolment with password + first code, secret sealed with AES-256-GCM (key derived from `JWT_SECRET`), replay protection per time step, 10 single-use recovery codes (stored hashed). Login returns a 5-minute challenge instead of a session until a valid code is entered; failures count towards the account lockout. Enabling 2FA ends all other sessions; administrators can reset 2FA for lower-priority users. |

## Authorization

The generated [permission matrix](permission-matrix.md) lists what every route requires; a test fails when a route is added without a deliberate protection.


- Global guards: every route requires a session unless marked `@Public()`.
- Permissions are checked on the server (`@RequirePermissions`). Wildcards: `*` (Owner) and `namespace.*`.
- Users can only manage users/roles with a **lower priority** than their own role and can only grant permissions they hold themselves. The Owner role cannot be edited, and the last active Owner cannot be demoted or disabled.

## First-time setup

- While uninitialised, the backend prints a random one-time **setup code** to its log (or uses `SETUP_TOKEN`). Only someone with access to the server logs/environment can create the Owner.
- Completion inserts the `setup.completed` row (primary key), so concurrent or repeated initialisation fails with `409`.

## Plugin registration

- Registration tokens: 24 random bytes, stored hashed, single-use, expire after 30 minutes (configurable), consumed with a conditional update so they can never be redeemed twice.
- Redemption returns a key id + secret; only the secret's SHA-256 is stored. Every plugin request is HMAC-signed with a timestamp and a single-use nonce ([protocol](plugin-protocol.md)).

## Transport & headers

- Use the `https` Compose profile (Caddy with automatic certificates) or your own TLS-terminating proxy in production.
- Helmet on the backend. The dashboard sends a same-origin **Content-Security-Policy** (no third-party origins, `frame-ancestors 'none'`, `object-src 'none'`), `Cross-Origin-Opener-Policy`, `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy. Caddy adds HSTS.
- Containers run as the unprivileged `node` user; backend and dashboard drop all Linux capabilities and set `no-new-privileges`.
- **Client IPs:** the dashboard forwards only the right-most `X-Forwarded-For` hop. When the dashboard is exposed directly (no reverse proxy) a client can choose that value, so IP-based rate limits are weaker; the per-account login lockout does not depend on IPs. Put Caddy (or another proxy that overwrites `X-Forwarded-For`) in front for accurate IPs.

## Input & output handling

- All bodies and queries are validated with Zod; unknown fields are rejected on update endpoints.
- Prisma uses parameterised queries; the only raw SQL uses tagged templates.
- Error responses never contain stack traces or SQL.
- Translation catalogues are rendered as text and validated to contain no markup, `javascript:` URLs or event-handler attributes.

## Personal data

- IP addresses and approximate locations are only returned to users with `players.view.ip` / `players.view.location`; the other connection fields need `players.view`.
- IP addresses are removed after the configurable retention period (default 180 days), see [Player profiles](player-profiles.md#privacy-and-retention).
- Skins are fetched by the backend from an allow-listed host only, so dashboard users' browsers never contact third parties.

## Secrets

- Never committed: `.env` is git-ignored; `.env.example` contains placeholders only.
- CI runs Gitleaks over the full history and `npm audit` on production dependencies (fails on high or critical findings).

The 1.0 security review is documented in [Security review](security-review.md).

## Reporting vulnerabilities

See [SECURITY.md](../../SECURITY.md).
