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

# 4. Image checks through a stand-in `docker image inspect` (everything else goes to the real CLI):
#    the new image must start exactly like the running one, release SHA / revision aside.
real_docker="$(command -v docker)"
mkdir -p "$tmp/bin" "$tmp/images"
printf '#!/usr/bin/env bash\nif [ "$1" = image ] && [ "$2" = inspect ]; then\n  f="%s/$(printf %%s "$3" | tr /: __).json"\n  [ -f "$f" ] && exec cat "$f"\n  echo "Error: No such image" >&2; exit 1\nfi\nexec %q "$@"\n' "$tmp/images" "$real_docker" >"$tmp/bin/docker"
chmod +x "$tmp/bin/docker"
running="sha256:$(printf 'synthetic-running-image' | sha256sum | cut -c1-64)"
fixture() { printf '%s' "$1" | tr '/:' '__'; }
image() { # id user node_env sha
  printf '[{"Id":"%s","Config":{"User":"%s","Entrypoint":["node","/opt/operations/runtime-bootstrap.cjs"],"Cmd":[],"WorkingDir":"/app","ExposedPorts":{"3000/tcp":{}},"Env":["PATH=/usr/local/bin:/usr/bin","NODE_ENV=%s","VOLTEX_RELEASE_SHA=%s"],"Labels":{"org.opencontainers.image.revision":"%s"}}}]' "$1" "$2" "$3" "$4" "$4"
}
image "$running" 1000 production "$old" >"$tmp/images/$(fixture voltex-api:kyc).json"
withimages() { PATH="$tmp/bin:$PATH" python3 "$tool" check --running-image "$running" --compose-files "$files" --project voltex-cutover --project-dir "$tmp" --env-file "$tmp/.env" --overlay "$tmp/r1/compose.tyvn-api.yaml" --sha "$new"; }
image "$id" 1000 production "$new" >"$tmp/images/$(fixture "$id").json"
out="$(withimages)" || fail "identical runtime blocked: $out"
grep -Fq 'New image runs like the old one' <<<"$out" || fail 'runtime equality not reported'
grep -Fq "rollback image $running present" <<<"$out" || fail 'rollback image not confirmed'
image "$id" 0 production "$new" >"$tmp/images/$(fixture "$id").json"
out="$(withimages)" && fail 'root user accepted'
grep -Fq 'start differently from the running one: User' <<<"$out" || fail "user change not named: $out"
image "$id" 1000 development "$new" >"$tmp/images/$(fixture "$id").json"
out="$(withimages)" && fail 'ENV change accepted'
grep -Fq 'env.NODE_ENV' <<<"$out" || fail "ENV change not named: $out"
! grep -Fq development <<<"$out" || fail 'ENV value printed'
image "$id" 1000 production "$old" >"$tmp/images/$(fixture "$id").json"
withimages >/dev/null && fail 'image with the old revision accepted'
echo 'SELFTEST PASS: overlay = image + VOLTEX_RELEASE_SHA only; extra port / other service / wrong SHA / bad input BLOCKED; the new image must start like the running one (user / ENV change BLOCKED, values not printed); no secret printed.'
