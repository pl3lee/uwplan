# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3
ARG SOURCE_DATE_EPOCH=0

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ARG SOURCE_DATE_EPOCH
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG RELEASE_REVISION=unknown
ARG SOURCE_DATE_EPOCH
ENV NEXT_TELEMETRY_DISABLED=1
ENV RELEASE_REVISION=${RELEASE_REVISION}
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN SKIP_ENV_VALIDATION=1 npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ARG RELEASE_REVISION=unknown
ARG SOURCE_DATE_EPOCH
LABEL org.opencontainers.image.source="https://github.com/pl3lee/uwplan"
LABEL org.opencontainers.image.revision=${RELEASE_REVISION}
ENV HOSTNAME="0.0.0.0"
ENV NODE_ENV="production"
ENV NEXT_TELEMETRY_DISABLED="1"
ENV PORT="5000"
ENV RELEASE_REVISION=${RELEASE_REVISION}

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/ops/migrate.mjs ./ops/migrate.mjs
COPY --from=builder --chown=node:node /app/ops/deploy/check-migration-compatibility.mjs ./ops/deploy/check-migration-compatibility.mjs
COPY --from=builder --chown=node:node /app/ops/deploy/migrate-release.mjs ./ops/deploy/migrate-release.mjs
COPY --from=builder --chown=node:node /app/ops/deploy/migration-compatibility.json ./ops/deploy/migration-compatibility.json
# Next's standalone trace only includes modules reached by the web server. Keep
# the runtime migrator's two production dependencies in the same release image.
COPY --from=dependencies --chown=node:node /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=dependencies --chown=node:node /app/node_modules/postgres ./node_modules/postgres

USER node
EXPOSE 5000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5000/api/live').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
