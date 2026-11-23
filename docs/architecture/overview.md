# Architecture overview

```
 Minecraft players
        │
 ┌──────▼──────┐  plugin API (Phase 2)   ┌────────────────────────── Docker Compose ─────────────────────────┐
 │  Velocity   │────────────────────────▶│  [caddy :443]* ─▶ dashboard :3000 ──/api/*──▶ backend :4000       │
 │  + plugin   │                         │                    (Next.js)                 (NestJS)              │
 └──────┬──────┘                         │                                              │        │            │
        │                                │                                         MySQL 8.4   Redis 7.4      │
 ┌──────▼──────┐                         │                                        (internal)  (internal)      │
 │ Paper + plg │────────────────────────▶└───────────────────────────────────────────────────────────────────┘
 └─────────────┘                                                         * optional "https" profile
```

## Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| `apps/backend` | Node.js 22, TypeScript, NestJS 12, Prisma 7 (MariaDB driver adapter), ioredis, Zod | All business logic, authentication, RBAC, persistence, audit log, plugin API |
| `apps/dashboard` | Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI, next-intl 4 | Administration UI; same-origin `/api/*` proxy to the backend |
| `packages/shared-types` | TypeScript | Permission catalogue, default roles, locales, punishment enums – shared by backend and dashboard |
| `packages/translations` | JSON/YAML + TypeScript | Dashboard catalogues, Minecraft plugin messages, validation tooling |
| `apps/velocity-plugin`, `apps/paper-plugin` | Java 21, Gradle | Phase 2 |

## Key decisions

1. **Single public entry point.** Only the dashboard (or Caddy) is published. Its route handler `app/api/[...path]` proxies to the backend at runtime (`BACKEND_INTERNAL_URL`), which keeps session cookies first-party and lets MySQL, Redis and the backend stay on the internal network. Plugins will use the same public URL.
2. **Business logic only in the backend.** The dashboard is a client of the REST API; permission checks in the UI are cosmetic. Every route is protected by global guards (`SessionGuard` → `PermissionsGuard`), and public routes must opt out explicitly with `@Public()`.
3. **Validation with Zod.** Request bodies and queries are validated by Zod schemas, which also generate the OpenAPI request schemas (`@ZodBody`, `@ZodQuery`).
4. **Idempotent startup.** On boot the backend synchronises the permission catalogue, default roles and bundled languages (`BootstrapService`). Customised roles are never overwritten.
5. **Migrations at container start.** The backend entrypoint runs `prisma migrate deploy` before starting. Migrations are forward-only.
6. **Never invent data.** Statistics are stored only when collected; a missing row means "not recorded" and the UI says so. Server metrics are shown only when reported.
7. **i18n from the start.** All UI strings are translation keys, typed against the English catalogue (unknown keys fail the TypeScript build).

## Request flow (dashboard)

1. Browser → `GET /api/auth/me` (same origin) → Next.js route handler → backend.
2. `SessionGuard` reads the `mnm_access` cookie, verifies the JWT (HS256, audience `mnm-dashboard`), loads the session row (revocation check) and the user's role permissions.
3. For non-GET requests the `X-MNM-CSRF: 1` header is required.
4. `PermissionsGuard` enforces `@RequirePermissions(...)`.
5. On `401` the dashboard calls `/api/auth/refresh` once (single-flight) and retries.

## Phase roadmap

See the [README](../../README.md#roadmap). Each phase ships working vertical slices.
