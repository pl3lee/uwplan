# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3
FROM ${NODE_IMAGE} AS builder
WORKDIR /src
RUN npm install --global pnpm@10.34.5
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile --filter @uwplan/web...
COPY web/ ./web/
RUN pnpm build:web && pnpm --filter @uwplan/web deploy --prod /out

FROM ${NODE_IMAGE}
WORKDIR /app
ARG RELEASE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/pl3lee/uwplan"
LABEL org.opencontainers.image.revision=${RELEASE_REVISION}
ENV RELEASE_REVISION=${RELEASE_REVISION}
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=node:node /out/ ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/live').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
