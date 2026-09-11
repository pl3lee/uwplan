ARG WEB_IMAGE
FROM ${WEB_IMAGE}
ARG RELEASE_REVISION
LABEL org.opencontainers.image.revision=${RELEASE_REVISION}
COPY bad-web.mjs /app/bad-web.mjs
CMD ["node", "--import", "/app/bad-web.mjs", "server.mjs"]
