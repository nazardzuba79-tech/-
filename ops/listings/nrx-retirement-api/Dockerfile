FROM voltex-admin-maintenance:2823d4c22ce6715e2466b60807159be4b04435ba
COPY dist/ /app/dist/
RUN node --check /app/dist/services/testMarkets/nrxSpot.js && node --check /app/dist/api/routes/testMarkets.js && node --check /app/dist/shared/nrxRetirement.js && node /opt/eclv-peak/probe.cjs
