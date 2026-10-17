# Build only after approval, from a git-archived exact release. The installed
# dependency lock must still match this current production image (see runbook).
# No network, credentials, secret/config mounts or database during this build.
FROM sha256:594d20f45f48775be9698793c32de273744bb4c4d7c57f73c4a4087fb896aec1 AS build
USER 0
WORKDIR /app
# Preserve all 43 deployed migration files byte-for-byte, including historical
# CRLF checksums. Only the schema and the one approved new migration are copied.
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations/20261015090000_kyc_material_requests ./prisma/migrations/20261015090000_kyc_material_requests
COPY src ./src
COPY tsconfig.json ./tsconfig.json
RUN DATABASE_URL=postgresql://unused@127.0.0.1/unused DIRECT_URL=postgresql://unused@127.0.0.1/unused node node_modules/prisma/build/index.js generate && node node_modules/typescript/bin/tsc --outDir /tmp/kyc-dist

FROM sha256:594d20f45f48775be9698793c32de273744bb4c4d7c57f73c4a4087fb896aec1
USER 0
WORKDIR /app
COPY --from=build --chown=1000:1000 /tmp/kyc-dist ./dist
COPY --from=build --chown=1000:1000 /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=1000:1000 prisma/schema.prisma ./prisma/schema.prisma
COPY --chown=1000:1000 prisma/migrations/20261015090000_kyc_material_requests ./prisma/migrations/20261015090000_kyc_material_requests
COPY --chown=1000:1000 src ./src
COPY --chown=1000:1000 scripts/kyc-hetzner-prisma.cjs /opt/operations/kyc-hetzner-prisma.cjs
ARG RELEASE_COMMIT
RUN test -n "$RELEASE_COMMIT" && test ${#RELEASE_COMMIT} -eq 40
ENV VOLTEX_RELEASE_SHA=$RELEASE_COMMIT
LABEL org.opencontainers.image.revision=$RELEASE_COMMIT
USER 1000
ENTRYPOINT ["node", "/opt/operations/runtime-bootstrap.cjs"]
CMD []
