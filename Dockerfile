# syntax=docker/dockerfile:1.7
#
# What-If — production image.
# Stage 1 installs everything and builds the web app and the server bundle.
# Stage 2 installs production dependencies only.
# Stage 3 is a small runtime image running as the unprivileged `node` user.

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build

FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Workspace packages are bundled into the server build, so only third-party
# runtime dependencies are needed here.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && rm -rf node_modules/@whatif \
  && npm cache clean --force

FROM node:${NODE_VERSION} AS runtime
ARG APP_VERSION=1.0.0
LABEL org.opencontainers.image.title="What-If" \
      org.opencontainers.image.description="Self-hosted decision planning and future simulation" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/FouadHellal/What-If-"
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/drizzle \
    APP_VERSION=${APP_VERSION} \
    NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
COPY --from=prod-deps --chown=node:node /src/node_modules ./node_modules
COPY --from=build --chown=node:node /src/apps/server/package.json ./package.json
COPY --from=build --chown=node:node /src/apps/server/dist ./dist
COPY --from=build --chown=node:node /src/apps/server/drizzle ./drizzle
COPY --from=build --chown=node:node /src/apps/web/dist ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
