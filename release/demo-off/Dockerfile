# Inactive release image ONLY; build/switch require their separate owner gates.
# Keep the current production OS, Node, dependencies and generated Prisma client.
# No npm install, network download, schema copy, migration or container startup.
ARG BASE_IMAGE=sha256:b81b093eb9529db8b68a9aa3c668eb4f3282764741cd03efb431cdfe5b96d012
FROM ${BASE_IMAGE}
ARG RELEASE_SHA
ENV DEMO_SPOT_ENABLED=false \
    DEMO_LIQUIDITY_ENABLED=false \
    VOLTEX_RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.revision=${RELEASE_SHA} \
      voltex.release.scope="demo-spot-liquidity-only" \
      voltex.release.migrations="none"
COPY overlay/ /app/dist/
# Never inherit the repository's migration-running Dockerfile CMD.
CMD ["node", "dist/index.js"]
