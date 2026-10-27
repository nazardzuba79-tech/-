FROM voltex-nrx-retirement:85f6122b7ac0aa3ce72a2af9ac9aac13d814e44d
COPY dist/ /app/dist/
RUN node --check /app/dist/shared/nrxRetirement.js && node /opt/eclv-peak/probe.cjs
