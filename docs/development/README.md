# Development

## Prerequisites

- Node.js 22 LTS and npm 12 (`npm install -g npm@12`)
- MySQL 8.4 and Redis 7 for running the backend (e.g. `docker compose up -d mysql redis` with temporary published ports, or local installations)
- JDK 25 for the plugins (Gradle is provided by the wrapper: `./gradlew build`)
- Docker with Compose v2 only if you want to run the whole stack from source (see below)

npm 12 only runs install scripts for packages approved in `package.json → allowScripts` (argon2, prisma, @swc/core, …). Approve new ones with `npm install-scripts approve <pkg>`.

## Setup

```sh
npm install
npm run build:packages            # shared-types + translations
```

Backend (`apps/backend`):

```sh
export DATABASE_URL=mysql://mnm:password@localhost:3306/mnm REDIS_URL=redis://localhost:6379 JWT_SECRET=<32+ chars> NODE_ENV=development
npx prisma migrate deploy
npm run start:dev -w @mnm/backend      # http://localhost:4000/api/docs
```

Dashboard (`apps/dashboard`):

```sh
BACKEND_INTERNAL_URL=http://localhost:4000 npm run dev -w @mnm/dashboard   # http://localhost:3000
```

## Quality gates

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint (flat config, typescript-eslint) for all workspaces |
| `npm run typecheck` | `tsc --noEmit` for all workspaces (includes translation-key checking in the dashboard) |
| `npm test` | Vitest unit tests (backend, dashboard) + translation validation |
| `npm run translations:validate` | Catalogue safety/structure checks |
| `./gradlew build` | Compile (warnings as errors in common/Velocity), JUnit tests and plugin jars |
| `E2E_DATABASE_URL=… E2E_REDIS_URL=… npx vitest run test/e2e.spec.ts` (in `apps/backend`) | End-to-end tests against an **empty, migrated** database |

CI (`.github/workflows/ci.yml`) runs all of the above plus migration drift detection, Docker image builds, Compose validation, Gitleaks and `npm audit`.

## Test layers

| Layer | Where | Covers |
| --- | --- | --- |
| Unit | `apps/*/test`, `apps/dashboard/src/lib/*.test.ts`, JUnit in `apps/*/src/test` | Business rules (punishments, statistics, AntiCheat rules, inventory compare-and-set, TOTP, config generator, plugin caches, signing) |
| Permission audit | `apps/backend/test/route-permissions.spec.ts` | Every route is public, plugin-signed or session-protected on purpose; regenerates [permission-matrix.md](../architecture/permission-matrix.md) with `UPDATE_PERMISSION_MATRIX=1` |
| Integration (e2e) | `apps/backend/test/e2e.spec.ts` | Whole backend against MySQL 8.4 + Redis: setup, auth, 2FA, RBAC, plugin API, punishments, statistics, AntiCheat, inventories, configuration |
| Deployment | CI job *Deployment* + `infrastructure/scripts/verify-deployment.mjs` | Real Docker Compose stack: setup through the dashboard proxy, server registration, signed plugin traffic, 2000 seeded players, load test with latency thresholds, restart, backup, data loss, restore |

Run the deployment verification against a local stack (never against production – it creates an owner account and test data):

```sh
SETUP_TOKEN=<value from .env> node infrastructure/scripts/verify-deployment.mjs http://127.0.0.1:3000 setup
node infrastructure/scripts/verify-deployment.mjs http://127.0.0.1:3000 load
```

## Database changes

1. Edit `apps/backend/prisma/schema.prisma`.
2. `npx prisma migrate dev --name <change>` (in `apps/backend`, against a development database).
3. Commit the schema and the generated migration together. CI fails if they drift apart.

## Conventions

- English for code, comments, docs, commits and default messages.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`).
- Branches: `main` (stable), `develop` (integration), `feature/*`, `fix/*`.
- Every user-facing string is a translation key in `packages/translations` – add it to **all** catalogues.
- Every administrative action writes an audit entry, inside the same transaction as the change where possible.
- Never show invented data: render "not recorded" when a value has not been collected.

### Load test baseline (CI, release 1.0.0)

Docker Compose stack on a standard GitHub-hosted runner, 2000 seeded players, 60 s at ~18.5 requests/s (limited by the per-IP rate limits, since all traffic comes from one machine), all requests through the dashboard proxy. Threshold: p95 ≤ 500 ms, no errors.

| Endpoint | Requests | Errors | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plugin heartbeat | 361 | 0 | 15 ms | 24 ms | 34 ms |
| Plugin events (join, switch, leave) | 361 | 0 | 32 ms | 50 ms | 60 ms |
| Punishment feed | 180 | 0 | 13 ms | 30 ms | 46 ms |
| Player search | 91 | 0 | 33 ms | 46 ms | 85 ms |
| Player profile | 60 | 0 | 23 ms | 43 ms | 59 ms |
| Dashboard summary | 60 | 0 | 22 ms | 43 ms | 64 ms |

These numbers show headroom, not a capacity limit; the current results of every CI run are in the job summary of the *Deployment* job.

## Building from source with Docker

The default `docker-compose.yml` pulls the published release images. To run the stack from your working copy, add the development override (images are tagged `nexora-local/*`):

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Plugins: `./gradlew build` → `apps/velocity-plugin/build/libs/Nexora-Velocity-<version>.jar` and `apps/paper-plugin/build/libs/Nexora-Paper-<version>.jar`. Check them with `node infrastructure/scripts/verify-plugin-jars.mjs <version>`. Every push to `main` and every pull request touching plugin code also builds them (workflow *Build plugins*, artifacts `nexora-plugins-<version>`).

## Releasing

All components share one version. To release `X.Y.Z`:

1. Set the version everywhere and add the changelog entry: the five `package.json` files (and their `@mnm/*` dependency ranges), `gradle.properties` (`pluginVersion`), the default tag in `docker-compose.yml`, `NEXORA_VERSION` in `.env.example`, a `## [X.Y.Z]` section at the top of `CHANGELOG.md`, and the versions in the README quick start. `node infrastructure/scripts/check-versions.mjs X.Y.Z` must pass; run `npm install --package-lock-only` afterwards.
2. Update `infrastructure/compatibility.json` if the tested server versions change (it drives the smoke tests and the release notes).
3. Merge to `main`, wait for CI, then tag the merge commit and push the tag:

   ```sh
   git tag -a vX.Y.Z -m "Release X.Y.Z" && git push origin vX.Y.Z
   ```

The *Release* workflow then validates everything again, builds and smoke-tests the plugins, publishes multi-arch images with the version tags, scans them, performs a clean install from the published images with real Velocity/Paper servers, creates the GitHub Release with jars, packages, checksums and notes, verifies the downloads and finally moves `latest`. It refuses to overwrite a published release or images built from another commit; a failed run leaves at most a draft release and version tags of images built from the same commit, so it can be re-run for that commit; changes to the code need a new patch version.
