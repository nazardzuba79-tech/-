#!/usr/bin/env bash
# Offline self-test of scripts/tyvn-api-switch.py on a synthetic Compose project.
# Needs only the `docker compose` CLI (config rendering works without a daemon).
# No container, image, network or database is touched; the temp project is removed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tool="$here/tyvn-api-switch.py"
tmp="$(mktemp -d)"
trap 'rm -rf -- "${tmp:?}"' EXIT
old=2e7acf158000404133db85723bac13695215e25c
new=6f082a98d0c97c28215e6c5c8056b786d6fa6c99
id="sha256:$(printf 'synthetic-tyvn-image' | sha256sum | cut -c1-64)"
secret='synthetic-secret-never-printed-7f3a'

cat >"$tmp/.env" <<EOF
DB_PASSWORD=$secret
EOF
cat >"$tmp/compose.yaml" <<'EOF'
services:
  api-production:
    image: voltex-api:kyc
    ports: ["127.0.0.1:13020:3000"]
    environment:
      DATABASE_URL: postgresql://voltex:${DB_PASSWORD}@db:5432/voltex_stage
    profiles: [cutover]
  db:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    profiles: [cutover]
EOF
cat >"$tmp/compose.runtime.yaml" <<EOF
services:
  api-production:
    environment:
      - VOLTEX_RELEASE_SHA=$old
EOF
files="$tmp/compose.yaml,$tmp/compose.runtime.yaml"
check() { python3 "$tool" check --no-docker --compose-files "$files" --project voltex-cutover --project-dir "$tmp" --env-file "$tmp/.env" "$@"; }
fail() { echo "SELFTEST FAIL: $*"; exit 1; }

# 1. A wrong image reference or SHA is refused before anything is written.
python3 "$tool" overlay --release-dir "$tmp/r0" --image voltex-tyvn:latest --sha "$new" >/dev/null && fail 'tag accepted as image ID'
python3 "$tool" overlay --release-dir "$tmp/r0" --image "$id" --sha 6f082a98 >/dev/null && fail 'short SHA accepted'
[ ! -e "$tmp/r0/compose.tyvn-api.yaml" ] || fail 'overlay written for refused input'

# 2. The real overlay: exactly the two keys differ; READY; the secret is never printed.
python3 "$tool" overlay --release-dir "$tmp/r1" --image "$id" --sha "$new" >/dev/null
python3 "$tool" overlay --release-dir "$tmp/r1" --image "$id" --sha "$new" >/dev/null && fail 'overlay overwritten'
out="$(check --overlay "$tmp/r1/compose.tyvn-api.yaml" --sha "$new")" || fail "good overlay blocked: $out"
grep -Fxq '  services.api-production.image' <<<"$out" || fail 'image path not reported'
grep -Fxq '  services.api-production.environment.VOLTEX_RELEASE_SHA' <<<"$out" || fail 'SHA path not reported'
[ "$(grep -c '^  services\.' <<<"$out")" = 2 ] || fail 'more than two changed paths'
grep -Fq "VOLTEX_RELEASE_SHA: $old -> $new" <<<"$out" || fail 'SHA change not shown'
grep -Fq 'READY TO SWITCH' <<<"$out" || fail 'not ready'
grep -Fq -- '--no-deps --no-build --pull never api-production' <<<"$out" || fail 'switch is not API-only'
! grep -Fq "$secret" <<<"$out" || fail 'secret printed'

# 3. Anything beyond the two keys is BLOCKED (a port, another service, a different SHA).
mkdir -p "$tmp/r2"
cat >"$tmp/r2/compose.tyvn-api.yaml" <<EOF
services:
  api-production:
    image: $id
    ports: ["127.0.0.1:13021:3000"]
    environment:
      VOLTEX_RELEASE_SHA: "$new"
EOF
out="$(check --overlay "$tmp/r2/compose.tyvn-api.yaml" --sha "$new")" && fail 'extra port accepted'
grep -Fq 'BLOCKED' <<<"$out" || fail 'no BLOCKED line for extra port'
! grep -Fq "$secret" <<<"$out" || fail 'secret printed on block'
mkdir -p "$tmp/r3"
cat >"$tmp/r3/compose.tyvn-api.yaml" <<EOF
services:
  api-production:
    image: $id
    environment:
      VOLTEX_RELEASE_SHA: "$new"
  db:
    image: postgres:18.1
EOF
check --overlay "$tmp/r3/compose.tyvn-api.yaml" --sha "$new" >/dev/null && fail 'db change accepted'
check --overlay "$tmp/r1/compose.tyvn-api.yaml" --sha "$old" >/dev/null && fail 'SHA mismatch accepted'
echo 'SELFTEST PASS: overlay = image + VOLTEX_RELEASE_SHA only; extra port / other service / wrong SHA / bad input BLOCKED; no secret printed.'
