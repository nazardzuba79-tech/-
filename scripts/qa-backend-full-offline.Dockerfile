ARG QA_BASE
FROM ${QA_BASE}
WORKDIR /app
# No repository startup command, migrations, seed or env files. npm lifecycle hooks
# are disabled; only the explicit Prisma engine acquisition below runs an installer.
COPY source/package.json source/package-lock.json ./
COPY source/frontend/package.json source/frontend/package-lock.json ./frontend/
RUN npm ci --ignore-scripts --no-audit --no-fund && npm --prefix frontend ci --ignore-scripts --no-audit --no-fund && node node_modules/@prisma/engines/scripts/postinstall.js
COPY source/ ./
# The engine binary is acquired above; generating this exact schema cannot use a network here.
RUN --network=none DATABASE_URL=postgresql://test:test@127.0.0.1:9/voltex_test DIRECT_URL=postgresql://test:test@127.0.0.1:9/voltex_test node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma
COPY harness.cjs manifest.json /qa/
RUN --network=none chmod -R a+rX /app /qa && node -e "require('bcrypt');require('@prisma/client');require('node:child_process').execFileSync('openssl',['version']);require('node:child_process').execFileSync('grep',['--version'])"
USER node
ENTRYPOINT ["/usr/local/bin/node", "/qa/harness.cjs", "--container-run"]
