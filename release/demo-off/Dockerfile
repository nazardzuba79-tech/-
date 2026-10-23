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
# Set the file mode and owner in the image itself; host archive extraction may use 0600/root.
# Each COPY targets a regular file (not directories), so directories retain executable/traverse bits.
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/demoTrading.js /app/dist/api/routes/demoTrading.js
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/demoTrading.js.map /app/dist/api/routes/demoTrading.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/orders.js /app/dist/api/routes/orders.js
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/orders.js.map /app/dist/api/routes/orders.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/withdrawals.js /app/dist/api/routes/withdrawals.js
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/withdrawals.js.map /app/dist/api/routes/withdrawals.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/adminWithdrawals.js /app/dist/api/routes/adminWithdrawals.js
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/adminWithdrawals.js.map /app/dist/api/routes/adminWithdrawals.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/index.js /app/dist/index.js
COPY --chown=1000:1000 --chmod=0644 overlay/index.js.map /app/dist/index.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/AdminUserDeletionService.js /app/dist/services/AdminUserDeletionService.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/AdminUserDeletionService.js.map /app/dist/services/AdminUserDeletionService.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/DemoLiquidity.js /app/dist/services/DemoLiquidity.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/DemoLiquidity.js.map /app/dist/services/DemoLiquidity.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/DemoTradingService.js /app/dist/services/DemoTradingService.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/DemoTradingService.js.map /app/dist/services/DemoTradingService.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/OrderService.js /app/dist/services/OrderService.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/OrderService.js.map /app/dist/services/OrderService.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/SpotBookTransaction.js /app/dist/services/SpotBookTransaction.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/SpotBookTransaction.js.map /app/dist/services/SpotBookTransaction.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/demoSpotAccess.js /app/dist/services/demoSpotAccess.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/demoSpotAccess.js.map /app/dist/services/demoSpotAccess.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/WithdrawalService.js /app/dist/services/WithdrawalService.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/WithdrawalService.js.map /app/dist/services/WithdrawalService.js.map
# Never inherit the repository's migration-running Dockerfile CMD.
CMD ["node", "dist/index.js"]
