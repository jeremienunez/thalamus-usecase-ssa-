# syntax=docker/dockerfile:1.7

# --- base -------------------------------------------------------------------
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# --- deps -------------------------------------------------------------------
# Fetches every workspace dep into the pnpm store, keyed on the lockfile only.
# The typecheck layer below reuses this store via the BuildKit cache mount.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY apps/console-api/package.json   apps/console-api/
COPY packages/cli/package.json       packages/cli/
COPY packages/db-schema/package.json packages/db-schema/
COPY packages/shared/package.json    packages/shared/
COPY packages/sweep/package.json     packages/sweep/
COPY packages/thalamus/package.json  packages/thalamus/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm fetch

# --- build (install + typecheck) -------------------------------------------
FROM deps AS build
COPY packages/cli       packages/cli
COPY packages/db-schema packages/db-schema
COPY packages/shared    packages/shared
COPY packages/sweep     packages/sweep
COPY packages/thalamus  packages/thalamus
COPY apps/console-api   apps/console-api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline
RUN pnpm --filter @interview/console-api typecheck

# --- runtime ---------------------------------------------------------------
# Clean node:20-alpine (no pnpm, no corepack) + only what the server needs.
# tsx is declared in console-api's devDependencies, so we keep the install as-is
# rather than pruning it out; trade-off is ~20 MB of extra layers for simplicity.
# A future optimization: switch to `esbuild --bundle --packages=external` to
# emit a single dist/server.js and drop tsx entirely.
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules        ./node_modules
COPY --from=build --chown=node:node /app/package.json        ./package.json
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /app/tsconfig.base.json  ./tsconfig.base.json
COPY --from=build --chown=node:node /app/packages            ./packages
COPY --from=build --chown=node:node /app/apps/console-api    ./apps/console-api

EXPOSE 4000
USER node
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

WORKDIR /app/apps/console-api
CMD ["node", "--import", "tsx", "src/server.ts"]
