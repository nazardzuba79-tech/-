# Inactive release image ONLY; build/switch require their separate owner gates.
# Keep the current production OS, Node, dependencies and generated Prisma client.
# No npm install, network download, schema copy, migration or container startup.
# Builder must verify this existing LOCAL tag resolves to immutable image ID
# sha256:b81b093eb9529db8b68a9aa3c668eb4f3282764741cd03efb431cdfe5b96d012.
# BuildKit interprets a bare sha256:... FROM as a Docker Hub repository name.
ARG BASE_IMAGE=voltex-tyvn:6f082a98d0c97c28215e6c5c8056b786d6fa6c99
FROM ${BASE_IMAGE}
ARG RELEASE_SHA
ENV DEMO_SPOT_ENABLED=false \
    DEMO_LIQUIDITY_ENABLED=false \
    DEMO_WITHDRAWAL_GUARD_ENABLED=false \
    VOLTEX_RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.revision=${RELEASE_SHA} \
      voltex.release.scope="demo-spot-liquidity-only" \
      voltex.release.migrations="none"
COPY overlay/ /app/dist/
# Never inherit the repository's migration-running Dockerfile CMD.
CMD ["node", "dist/index.js"]
