# Build context: repo root (see docker-compose.yml).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
# Manifests first so the dependency layer is cached across source changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @career-intel/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @career-intel/api build

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production
# @career-intel/shared is consumed as TypeScript source; Node >= 22.18 strips
# the types natively, so no separate build step is needed for it.
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://localhost:3001/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Migrations are idempotent, so applying them on every start is safe.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
