FROM node:24.21.0-bookworm-slim
ARG SOURCE_SHA
ARG TREE_SHA
LABEL org.opencontainers.image.revision=$SOURCE_SHA voltex.targeted.tree=$TREE_SHA
WORKDIR /app
COPY --chown=node:node services/stocks ./services/stocks
COPY --chown=node:node services/stocks-global ./services/stocks-global
COPY --chown=node:node services/stocks-simulator ./services/stocks-simulator
USER node
ENV NODE_OPTIONS="--max-old-space-size=144"
CMD ["node","services/stocks/targeted-http-512/fixture.mjs"]
