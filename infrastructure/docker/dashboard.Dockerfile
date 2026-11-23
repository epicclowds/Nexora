# syntax=docker/dockerfile:1.7
# Web dashboard (Next.js standalone). Build context: repository root.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN npm install -g npm@12 --no-audit --no-fund
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NEXT_TELEMETRY_DISABLED=1

# ── Dependencies ─────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/translations/package.json packages/translations/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --no-audit --no-fund --workspace @mnm/dashboard --workspace @mnm/shared-types --workspace @mnm/translations --include-workspace-root

# ── Build ────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types packages/shared-types
COPY packages/translations packages/translations
COPY apps/dashboard apps/dashboard
RUN npm run build -w @mnm/shared-types -w @mnm/translations \
 && npm run build -w @mnm/dashboard

# ── Runtime ──────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/dashboard/server.js"]
