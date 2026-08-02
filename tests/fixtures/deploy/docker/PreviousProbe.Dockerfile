ARG PREVIOUS_IMAGE
FROM ${PREVIOUS_IMAGE}

USER root
COPY --chown=node:node docker/previous-schema-probe.mjs /app/previous-schema-probe.mjs
USER node
CMD ["node", "/app/previous-schema-probe.mjs"]
