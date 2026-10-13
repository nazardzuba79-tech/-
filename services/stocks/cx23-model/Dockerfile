FROM node:24.21.0-bookworm-slim AS node_runtime
FROM postgres:16-bookworm
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
ARG SOURCE_SHA
RUN node -e "if(!/^[a-f0-9]{40}$/.test(process.env.SOURCE_SHA||''))throw Error('EXACT_SOURCE_SHA_REQUIRED')"
LABEL org.opencontainers.image.revision=$SOURCE_SHA
WORKDIR /app
COPY --chown=postgres:postgres node_modules ./node_modules
COPY --chown=postgres:postgres dist ./dist
COPY --chown=postgres:postgres prisma ./prisma
COPY --chown=postgres:postgres services/stocks ./services/stocks
COPY --chown=postgres:postgres services/stocks-global ./services/stocks-global
COPY --chown=postgres:postgres services/stocks-simulator ./services/stocks-simulator
USER postgres
ENV CX23_DISPOSABLE=true NODE_ENV=test
ENV DATABASE_URL=postgresql://model_fixture@127.0.0.1:15432/cx23_disposable?connection_limit=8
ENV DIRECT_URL=postgresql://model_fixture@127.0.0.1:15432/cx23_disposable?connection_limit=8
# No production entrypoint, migrate deploy, seed, collector, or external credentials.
ENTRYPOINT ["bash", "/app/services/stocks/cx23-model/start.sh"]
