#!/usr/bin/env bash
# Disposable loopback PostgreSQL only: main migrations -> + copy migrations -> rollback
# -> schema identical to main -> re-apply. Usage: BASE_REF=origin/main PGURL_ADMIN=... script
set -euo pipefail
: "${PGURL_ADMIN:?admin URL to a disposable loopback server}"
DB=copy_demo_rollback_$$
case "$PGURL_ADMIN" in *127.0.0.1*|*localhost*) ;; *) echo "refuse non-loopback server"; exit 2;; esac
URL=$(printf %s "$PGURL_ADMIN" | sed -E "s#/postgres(\?|$)#/$DB\1#")
psql "$PGURL_ADMIN" -qc "CREATE DATABASE $DB"
trap 'psql "$PGURL_ADMIN" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null' EXIT
BASE=$(mktemp -d); git archive "${BASE_REF:-origin/main}" prisma | tar -x -C "$BASE"
dump() { pg_dump --schema-only --no-owner --no-privileges "$URL" | grep -v -E '^--|^SET |^SELECT pg_catalog|^\\(un)?restrict|^$' ; }
DATABASE_URL=$URL DIRECT_URL=$URL npx prisma migrate deploy --schema "$BASE/prisma/schema.prisma" >/dev/null
dump > "$BASE/main.sql"
DATABASE_URL=$URL DIRECT_URL=$URL npx prisma migrate deploy >/dev/null
echo "copy tables after apply: $(psql "$URL" -Atc "select count(*) from pg_tables where tablename like 'Copy%Demo%'")"
psql "$URL" -q -v ON_ERROR_STOP=1 -f prisma/rollback/copy-trading-658.sql
dump > "$BASE/rolled.sql"
diff -u "$BASE/main.sql" "$BASE/rolled.sql" && echo "rollback schema == ${BASE_REF:-origin/main} schema"
DATABASE_URL=$URL DIRECT_URL=$URL npx prisma migrate deploy >/dev/null
echo "re-apply OK: $(psql "$URL" -Atc "select count(*) from pg_tables where tablename like 'Copy%Demo%'") copy tables"
