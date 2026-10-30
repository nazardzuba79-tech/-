# Ordinary VOLTEX API image. SQL execution is an explicitly separate operation.
# Build from the normal checkout: no staged migration package is required.
FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.json ./
# Schema generation is offline. Never copy prisma/migrations into the API image.
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY scripts/qa/stocks-root-image-gate.cjs /opt/voltex/stocks-root-image-gate.cjs
RUN node /opt/voltex/stocks-root-image-gate.cjs
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN node node_modules/prisma/build/index.js generate
COPY src ./src
COPY services/stocks-global ./services/stocks-global
COPY services/stocks-simulator/engine.mjs ./services/stocks-simulator/engine.mjs
COPY scripts/qa/stocks-runtime-closure.cjs ./scripts/qa/
COPY Dockerfile ./Dockerfile
COPY scripts/start-render-single-service.cjs ./scripts/start-render-single-service.cjs
RUN node -e "console.log(JSON.stringify(require('./scripts/qa/stocks-runtime-closure.cjs').verifyClosure(process.cwd(), require('node:fs').readFileSync('Dockerfile', 'utf8'))))" \
    && node node_modules/typescript/bin/tsc -p tsconfig.json

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ARG REVIEW_SOURCE_SHA=unattested
LABEL org.opencontainers.image.revision=${REVIEW_SOURCE_SHA}
WORKDIR /app
ENV NODE_ENV=production
# Preserve the API's existing IPv4 connection preference.
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && chown node:node /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build /app/services/stocks-global ./services/stocks-global
COPY --from=build /app/services/stocks-simulator/engine.mjs ./services/stocks-simulator/engine.mjs
COPY --from=build --chown=node:node /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build --chown=node:node /app/scripts/start-render-single-service.cjs ./scripts/start-render-single-service.cjs
COPY --from=build /opt/voltex/stocks-root-image-gate.cjs /opt/voltex/stocks-root-image-gate.cjs
RUN node /opt/voltex/stocks-root-image-gate.cjs
USER node
# Clear the base-image wrapper: startup is exactly the exec-form API command.
ENTRYPOINT []
EXPOSE 3000
# API only. Existing production bootstrap manages its existing collector.
CMD ["node", "dist/index.js"]
