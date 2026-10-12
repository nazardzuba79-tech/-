FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node services/stocks ./services/stocks
COPY --chown=node:node services/stocks-global ./services/stocks-global
COPY --chown=node:node services/stocks-simulator ./services/stocks-simulator
USER node
ENV NODE_OPTIONS="--max-old-space-size=144"
ENV STOCK_REALISTIC_FIXTURE=true
WORKDIR /app/services/stocks
CMD ["node", "realistic-global-fixture.mjs"]
