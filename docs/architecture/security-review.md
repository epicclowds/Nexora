# Security review – release 1.0.0

Review of the complete code base before the first stable release (Phase 9). Method: manual review of every trust boundary listed below, automated checks added where a rule can be enforced permanently, and verification in CI against a real Docker deployment.

## Trust boundaries reviewed

| Boundary | What was checked | Result |
| --- | --- | --- |
| Browser → dashboard → backend | Session cookies, CSRF header, proxy header forwarding, security headers | OK; CSP added (see findings) |
| Authentication | Password hashing, lockout, rate limits, session revocation, setup code entropy | OK; optional TOTP 2FA added |
| Authorization | Every route's protection, role priority and permission escalation, in-handler checks | OK; enforced by a test |
| Minecraft plugins → backend | HMAC signatures, nonce replay protection, registration tokens, credential storage, server-type restrictions | OK |
| Backend → third parties | Skin download (allow-listed host, redirects refused, timeouts) | OK |
| Input validation | Zod on every body/query, strict update schemas, translation and plugin-message validation, ZIP/config generation | OK |
| Data at rest | Secrets hashed (tokens, refresh tokens, plugin secrets, recovery codes) or sealed (TOTP secrets); backups | OK |
| Deployment | Container users and capabilities, exposed ports, secrets handling, dependency vulnerabilities | Hardened (see findings) |

## Findings and fixes

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | Medium | The dashboard sent no Content-Security-Policy; injected markup could have loaded external resources. | Same-origin CSP (`default-src 'self'`, no third-party origins, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) plus COOP. Verified against the production build (3D skin viewer, charts, downloads). `'unsafe-inline'` remains for Next.js bootstrap scripts and inline styles. |
| 2 | High (not exploitable here) | `effect` ≤ 3.22.0 (ReDoS, GHSA-7589-6fvf-x4pw) via the Prisma CLI config loader. Not reachable from requests. | Pinned to 3.22.5 via `overrides`; CI now fails on high findings instead of only critical ones. |
| 3 | Medium | Two-factor authentication was missing although required by the specification. | Optional TOTP 2FA with encrypted secrets, replay protection, recovery codes, login challenge and administrator reset. |
| 4 | Low | Backend and dashboard containers kept the default Linux capabilities. | `cap_drop: [ALL]` and `no-new-privileges` (verified by the CI deployment). |
| 5 | Low | Route protection relied on reviews only. | `route-permissions.spec.ts` fails when a route is public or session-only without being allow-listed; the [permission matrix](permission-matrix.md) is generated from the code. |
| 6 | Info | Backup and restore were documented but never tested. | `backup.sh` / `restore.sh` verified on every CI run including complete data loss. |

## Accepted risks

- **`'unsafe-inline'` scripts** in the CSP: required by Next.js without per-request nonces. Mitigated by validating all imported texts (no markup) and the absence of third-party origins.
- **Client IPs without a reverse proxy**: when the dashboard is exposed directly, the right-most `X-Forwarded-For` value can be chosen by the client, weakening IP-based rate limits. The per-account lockout does not depend on IPs. Use the Caddy profile or another proxy in production.
- **2FA secrets depend on `JWT_SECRET`**: rotating `JWT_SECRET` invalidates enrolled authenticators (administrators can reset 2FA).
- **Plain HTTP between plugins and dashboard** is allowed for private networks; requests are signed and replay-protected but not encrypted. The configuration generator warns for public addresses.

## Verification

- Unit, permission-audit and e2e tests (MySQL 8.4 + Redis) – CI jobs *Lint, typecheck & unit tests* and *Backend e2e & migrations*.
- Deployment verification against the real Compose stack: headers, setup protection, forged plugin signatures, single-use tokens – CI job *Deployment*.
- Gitleaks over the complete Git history and `npm audit --audit-level=high` – CI job *Secret & dependency scanning*.
