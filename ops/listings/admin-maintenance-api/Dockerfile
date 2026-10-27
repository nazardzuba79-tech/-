FROM voltex-api-p0:291c875505c580dd2a13d8f1b3776a636d180f3b
COPY dist/ /app/dist/
RUN node --check /app/dist/api/routes/adminListings.js && node --check /app/dist/services/listings/store.js && node --check /app/dist/api/routes/depositAddressCopies.js && node --check /app/dist/services/TelegramNotifications.js && node /opt/eclv-peak/probe.cjs
