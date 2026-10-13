#!/usr/bin/env bash
set -euo pipefail
test "${CX23_DISPOSABLE:-}" = true
test ! -e /data/pg/PG_VERSION
# All processes, including disposable PostgreSQL and schema creation, share one cgroup.
initdb -D /data/pg -A trust --username=model_fixture >/data/initdb.log
pg_ctl -D /data/pg -l /data/postgres.log -o '-h 127.0.0.1 -p 15432 -c unix_socket_directories=/tmp' -w start
createdb -h 127.0.0.1 -p 15432 -U model_fixture cx23_disposable
node node_modules/prisma/build/index.js db push --skip-generate >/data/disposable-schema.log
exec node services/stocks/cx23-model/supervisor.mjs
