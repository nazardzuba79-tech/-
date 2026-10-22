# TYVN API-only offline overlay. LIVE_IMAGE must equal the currently running image ID.
ARG LIVE_IMAGE
FROM ${LIVE_IMAGE} AS builder
USER 0
WORKDIR /app
COPY src ./src
COPY tsconfig.json ./tsconfig.json
RUN node node_modules/typescript/bin/tsc --outDir /tmp/tyvn-dist

ARG LIVE_IMAGE
FROM ${LIVE_IMAGE}
USER 0
WORKDIR /app
COPY --from=builder --chown=1000:1000 /tmp/tyvn-dist ./dist
ARG RELEASE_COMMIT
RUN test -n "$RELEASE_COMMIT" && test "${#RELEASE_COMMIT}" -eq 40
ENV VOLTEX_RELEASE_SHA=$RELEASE_COMMIT
LABEL org.opencontainers.image.revision=$RELEASE_COMMIT
USER 1000
# Inherit the existing entrypoint, CMD, dependencies and secret mounts.
