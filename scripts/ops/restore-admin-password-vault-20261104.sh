#!/usr/bin/env bash
# VOLTEX owner decision 2026-11-04: restore the owner-only Admin -> Users
# password column on the live API exactly as before #668. Only four compiled
# route modules are replaced, by their versions from the retained pre-#668
# image. Container configuration is unchanged. Backups are kept and the
# change rolls back by itself if the API does not come back healthy.
set -euo pipefail
OLD_IMAGE=sha256:362eb750a7a0d7db207c6a3818eaba8006e96b96e829218783550fec05cdd44b
EXPECTED_COMMIT=41a755a9e163d278e786202be61627697149eb2a
FILES="auth account adminUsers adminPagedReads"
ROUTES=/app/dist/api/routes
DIR=/opt/voltex-releases/password-restore-20261104-$(date -u +%H%M%S)
stop() { echo "STOP (nothing changed): $*"; exit 2; }
health() { curl -fsS --max-time 10 https://api.voltextech.net/health; }

echo "== 1. live API"
before=$(health) || stop "health is unreachable"
echo "$before"
echo "$before" | grep -q "\"commit\":\"$EXPECTED_COMMIT\"" || stop "live commit is not $EXPECTED_COMMIT"

echo "== 2. API container"
API=""
for c in $(docker ps --format '{{.Names}}'); do
  if docker exec "$c" test -f "$ROUTES/adminUsers.js" 2>/dev/null; then API="$API $c"; fi
done
API=$(echo $API)
[ -n "$API" ] && [ "$(echo "$API" | wc -w)" = 1 ] || stop "expected exactly one API container, found: '$API'"
echo "container $API, image $(docker inspect -f '{{.Image}}' "$API")"

echo "== 3. checks"
docker image inspect "$OLD_IMAGE" >/dev/null 2>&1 || stop "retained pre-#668 image is missing"
cur=$(docker exec "$API" grep -c decryptAdminPassword "$ROUTES/adminUsers.js" || true)
[ "$cur" = 0 ] || stop "live adminUsers.js already reads the password vault ($cur)"
old=$(docker run --rm --network none --entrypoint grep "$OLD_IMAGE" -c decryptAdminPassword "$ROUTES/adminUsers.js" || true)
[ "${old:-0}" -ge 1 ] || stop "old image adminUsers.js has no password vault read"
docker exec "$API" test -f /app/dist/services/AdminPasswordVault.js || stop "AdminPasswordVault.js is missing in the live container"
echo "live: no vault read; old image: vault read present; vault service present"

echo "== 4. backup and old modules"
mkdir -p "$DIR"; chmod 700 "$DIR"; cd "$DIR"
for f in $FILES; do docker cp "$API:$ROUTES/$f.js" "./current-$f.js"; done
tmp=pw-old-$$
docker create --name "$tmp" --network none "$OLD_IMAGE" >/dev/null
for f in $FILES; do docker cp "$tmp:$ROUTES/$f.js" "./$f.js"; done
docker rm "$tmp" >/dev/null
sha256sum ./*.js
for f in $FILES; do echo "$f.js: $(diff "current-$f.js" "$f.js" | grep -c '^[<>]' || true) changed lines"; done

echo "== 5. install and restart"
rollback() {
  trap - ERR
  echo "ROLLBACK: putting the previous four modules back"
  for f in $FILES; do docker cp "./current-$f.js" "$API:$ROUTES/$f.js"; done
  docker restart "$API" >/dev/null
  sleep 20
  health || true
  echo
  echo "ROLLED BACK. Backups in $DIR"
  exit 1
}
trap rollback ERR
for f in $FILES; do docker cp "./$f.js" "$API:$ROUTES/$f.js"; done
docker restart "$API" >/dev/null
ok=""
for i in $(seq 1 24); do
  sleep 5
  now=$(health 2>/dev/null || true)
  if echo "$now" | grep -q '"status":"ok"' && [ "$now" != "$before" ]; then ok=1; break; fi
done
[ -n "$ok" ] || { echo "health did not come back within 2 minutes"; false; }
trap - ERR
echo "$now"
for f in $FILES; do docker exec "$API" sha256sum "$ROUTES/$f.js"; done
echo "DONE: owner-only admin password view restored on the API. Backups in $DIR"
echo "Rollback if ever needed: for f in $FILES; do docker cp $DIR/current-\$f.js $API:$ROUTES/\$f.js; done; docker restart $API"
