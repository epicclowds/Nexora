# syntax=docker/dockerfile:1.7
# Backend API (NestJS). Build context: repository root.

ARG NODE_IMAGE=node:22-bookworm-slim

# ── Base: matching npm major (lockfile + allowScripts) ───────────────
FROM ${NODE_IMAGE} AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g npm@12 --no-audit --no-fund
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# ── Dependencies (cached on manifest changes only) ───────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/translations/package.json packages/translations/
COPY apps/backend/package.json apps/backend/
RUN npm ci --no-audit --no-fund --workspace @mnm/backend --workspace @mnm/shared-types --workspace @mnm/translations --include-workspace-root

# ── Build ────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types packages/shared-types
COPY packages/translations packages/translations
COPY apps/backend apps/backend
RUN npm run build -w @mnm/shared-types -w @mnm/translations \
 && npm run build -w @mnm/backend \
 && npm prune --omit=dev --no-audit --no-fund --workspace @mnm/backend --workspace @mnm/shared-types --workspace @mnm/translations --include-workspace-root

# ── Runtime ──────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared-types/package.json /app/packages/shared-types/package.json
COPY --from=build --chown=node:node /app/packages/shared-types/dist /app/packages/shared-types/dist
COPY --from=build --chown=node:node /app/packages/translations/package.json /app/packages/translations/package.json
COPY --from=build --chown=node:node /app/packages/translations/dist /app/packages/translations/dist
COPY --from=build --chown=node:node /app/packages/translations/locales /app/packages/translations/locales
COPY --from=build --chown=node:node /app/packages/translations/minecraft /app/packages/translations/minecraft
COPY --from=build --chown=node:node /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=build --chown=node:node /app/apps/backend/dist /app/apps/backend/dist
COPY --from=build --chown=node:node /app/apps/backend/prisma /app/apps/backend/prisma
COPY --from=build --chown=node:node /app/apps/backend/prisma.config.ts /app/apps/backend/prisma.config.ts
COPY --chown=node:node infrastructure/docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
RUN chmod 0755 /usr/local/bin/backend-entrypoint.sh

WORKDIR /app/apps/backend
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "backend-entrypoint.sh"]
CMD ["node", "dist/main.js"]
