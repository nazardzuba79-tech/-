# Inactive P0-fence hotfix image ONLY. Build and switch are separate operator steps (docs/API_P0_HOTFIX_20261027.md).
# Base = the image that runs production API 89c3ac003b44a6a0e7630d2ecbe5d7164e85b683 today. Resolve it on the host:
#   docker inspect --format '{{.Image}}' <api-production container>
# and verify its label org.opencontainers.image.revision == 89c3ac003b44a6a0e7630d2ecbe5d7164e85b683 before building.
# Keeps the production OS, Node, dependencies, generated Prisma client and every other module.
# No npm install, network download, schema copy, migration or container start.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_SHA
ENV DEMO_SPOT_ENABLED=false \
    DEMO_LIQUIDITY_ENABLED=false \
    DEMO_WITHDRAWAL_GUARD_ENABLED=false \
    SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED=false \
    VOLTEX_RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.revision=${RELEASE_SHA} \
      voltex.release.scope="p0-fences-620-625-only" \
      voltex.release.base-revision="89c3ac003b44a6a0e7630d2ecbe5d7164e85b683" \
      voltex.release.migrations="none"
# Per-file COPY with owner and mode set in the image (host extraction may use 0600/root).
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/withdrawals.js /app/dist/api/routes/withdrawals.js
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/withdrawals.js.map /app/dist/api/routes/withdrawals.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/adminWithdrawals.js /app/dist/api/routes/adminWithdrawals.js
COPY --chown=1000:1000 --chmod=0644 overlay/api/routes/adminWithdrawals.js.map /app/dist/api/routes/adminWithdrawals.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/WithdrawalService.js /app/dist/services/WithdrawalService.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/WithdrawalService.js.map /app/dist/services/WithdrawalService.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/demoSpotAccess.js /app/dist/services/demoSpotAccess.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/demoSpotAccess.js.map /app/dist/services/demoSpotAccess.js.map
COPY --chown=1000:1000 --chmod=0644 overlay/services/OrderService.js /app/dist/services/OrderService.js
COPY --chown=1000:1000 --chmod=0644 overlay/services/OrderService.js.map /app/dist/services/OrderService.js.map
# Never inherit the repository's migration-running Dockerfile CMD.
CMD ["node", "dist/index.js"]
