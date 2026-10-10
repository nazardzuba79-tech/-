FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node services/stocks/ ./
USER node
ENV NODE_OPTIONS="--max-old-space-size=144"
CMD ["node", "runtime.mjs"]
