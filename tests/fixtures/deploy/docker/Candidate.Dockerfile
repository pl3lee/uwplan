ARG CANDIDATE_IMAGE
FROM ${CANDIDATE_IMAGE}

USER root
COPY expand/0010_expand_only.sql /app/drizzle/0010_expand_only.sql
COPY docker/prepare-candidate-fixture.mjs /tmp/prepare-candidate-fixture.mjs
RUN node /tmp/prepare-candidate-fixture.mjs && rm /tmp/prepare-candidate-fixture.mjs
USER node
