#!/usr/bin/env bash
# One-command refresh of everything that is actually reachable. Sources that are blocked are logged, not faked.
set -u
cd "$(dirname "$0")"
[ -f data/csi.db ] || gunzip -k data/csi.db.gz
python -m csi.preflight
for s in alternative_me fred coinmetrics defillama farside okx blockchain_info derive binance; do python -m csi.collect --source "$s"; done
for s in binance_vision binance_vision_recent bitmex deribit bitfinex coinbase bitstamp upbit blockchain_info_extra; do python -m csi.collect_v2 --source "$s"; done
python -m csi.validate
python -m csi.dashboard
echo "Refresh finished. Re-evaluation (python -m csi.evaluate_v2 && python -m csi.systems_v2) is NOT run automatically: it is a research step, not an update."
