FROM voltex-eclv-peak:754de3fc5bbe5b00b96dd0504ed0d5eabd6c5683
COPY dist/ /app/dist/
RUN node --check /app/dist/api/routes/withdrawals.js && node --check /app/dist/api/routes/adminWithdrawals.js && node --check /app/dist/services/WithdrawalService.js && node --check /app/dist/services/demoSpotAccess.js && node --check /app/dist/services/OrderService.js && node /opt/eclv-peak/probe.cjs
