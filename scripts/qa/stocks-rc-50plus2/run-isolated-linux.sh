#!/usr/bin/env bash
set -euo pipefail
# No SSH, Docker, installation or service/configuration changes.
# The caller must already be inside an approved isolated non-production host.
if [ "$#" -ne 5 ]; then
  echo "usage: run-isolated-linux.sh RC_ROOT PG_BIN FRESH_OUTPUT ATTESTATION existing-node" >&2
  exit 64
fi
RC_ROOT=$1
PG_BIN=$2
OUT=$3
ATTESTATION=$4
NODE=$5
test "$(uname -s)" = Linux
test -x "$NODE"
test -x "$PG_BIN/postgres"
test -f "$ATTESTATION"
test ! -e "$OUT"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$NODE" --max-old-space-size=256 "$HERE/run.cjs" --root "$RC_ROOT" --pg-bin "$PG_BIN" --out "$OUT" --scope isolated-linux --ack SYNTHETIC_LOCAL_ONLY --attestation "$ATTESTATION" --run-local
