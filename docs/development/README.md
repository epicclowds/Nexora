# Development

## Prerequisites

- Node.js 22 LTS and npm 12 (`npm install -g npm@12`)
- MySQL 8.4 and Redis 7 for running the backend (e.g. `docker compose up -d mysql redis` with temporary published ports, or local installations)
- Java 21 + Gradle (from Phase 2, for the plugins)

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
| `E2E_DATABASE_URL=… E2E_REDIS_URL=… npx vitest run test/e2e.spec.ts` (in `apps/backend`) | End-to-end tests against an **empty, migrated** database |

CI (`.github/workflows/ci.yml`) runs all of the above plus migration drift detection, Docker image builds, Compose validation, Gitleaks and `npm audit`.

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
