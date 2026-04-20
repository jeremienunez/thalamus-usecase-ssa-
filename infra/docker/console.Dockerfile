# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./
COPY apps/console/package.json apps/console/
COPY packages/cli/package.json       packages/cli/
COPY packages/db-schema/package.json packages/db-schema/
COPY packages/shared/package.json    packages/shared/
COPY packages/sweep/package.json     packages/sweep/
COPY packages/thalamus/package.json  packages/thalamus/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

FROM deps AS build
COPY packages/cli       packages/cli
COPY packages/db-schema packages/db-schema
COPY packages/shared    packages/shared
COPY packages/sweep     packages/sweep
COPY packages/thalamus  packages/thalamus
COPY apps/console       apps/console
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN pnpm --filter @interview/console build

FROM nginx:1.27-alpine AS runtime
COPY infra/docker/console.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/console/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
