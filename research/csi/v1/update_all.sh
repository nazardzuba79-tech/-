#!/usr/bin/env bash
# One-command INCREMENTAL refresh of every source that is actually reachable, then checks, dashboard and the
# forward-test ledger snapshot. Blocked or failing sources are logged in collection_log, never faked.
# Full re-download: add --full (e.g. ./update_all.sh --full).
set -u
cd "$(dirname "$0")"
PY="$(command -v python3 || command -v python)"
[ -n "$PY" ] || { echo "Python 3 not found"; exit 1; }
FULL="${1:-}"
[ -f data/csi.db ] || gunzip -k data/csi.db.gz
"$PY" -m csi.preflight
for s in alternative_me fred coinmetrics defillama farside okx blockchain_info derive binance; do "$PY" -m csi.collect --source "$s" $FULL; done
for s in binance_vision binance_vision_recent bitmex deribit bitfinex coinbase bitstamp upbit blockchain_info_extra; do "$PY" -m csi.collect_v2 --source "$s" $FULL; done
"$PY" -m csi.validate
"$PY" -m csi.dashboard
"$PY" -m csi.forward snapshot
"$PY" -m csi.forward verify
echo "Refresh finished. Research re-evaluation is NOT run automatically (it is a research step, not an update)."
