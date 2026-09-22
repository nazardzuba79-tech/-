#!/usr/bin/env python3
"""Mandatory data checks: lag_check, sources_check, coverage, missing core metrics, gaps.
Writes reports/*.csv and reports/data_validation.json. Reads only; never modifies series."""
from __future__ import annotations
import csv, datetime as dt, json, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = [  # (source, metric, asset, lag) exactly as in the owner's spec / lag_rules_contract.csv
    *[('coinmetrics', m, a, 1) for m in 'PriceUSD CapMrktCurUSD CapRealUSD CapMVRVCur SplyCur SplyAct1yr SplyActEver AdrActCnt TxCnt TxTfrValAdjUSD FeeTotUSD RevUSD IssTotUSD HashRate DiffMean NVTAdj90 VtyDayRet30d'.split() for a in ('btc', 'eth')],
    *[('binance_spot', m, a, 0) for m in ('spot_close', 'spot_volume') for a in ('btcusdt', 'ethusdt')],
    *[('binance_futures', m, a, 0) for m in ('funding_rate_daily', 'perp_spot_basis', 'open_interest', 'open_interest_usd', 'taker_buy_sell_ratio', 'long_short_ratio') for a in ('btcusdt', 'ethusdt')],
    *[('defillama', m, '', 1) for m in ('stablecoin_mcap', 'stablecoin_mcap_ethereum', 'stablecoin_mcap_tron', 'stablecoin_mcap_solana', 'stablecoin_mcap_arbitrum', 'stablecoin_mcap_base', 'stablecoin_mcap_bsc', 'total_tvl')],
    ('farside', 'etf_flow_musd', 'btc', 1), ('farside', 'etf_flow_musd', 'eth', 1),
    *[('fred', m, '', {'WALCL': 8, 'WTREGEN': 8, 'WRESBAL': 8, 'M2SL': 30}.get(m, 1)) for m in 'WALCL WTREGEN RRPONTSYD WRESBAL M2SL DTWEXBGS DFII10 BAMLH0A0HYM2 VIXCLS SP500'.split()],
    ('alternative_me', 'fng', '', 0),
    ('coingecko', 'share_top100_above_sma50', '', 1), ('coingecko', 'share_top100_beating_btc_30d', '', 1),
]
FALLBACK_SOURCES = {'binance_spot': ['okx'], 'binance_futures': ['okx'], 'coinmetrics': ['blockchain_info']}


def main() -> int:
    db = sqlite3.connect(ROOT / 'data/csi.db')
    rep = ROOT / 'reports'
    rows = db.execute('''SELECT metric, source, COUNT(*) AS rows,
       SUM(CASE WHEN available_at <= date THEN 1 ELSE 0 END) AS bad_rows,
       MIN(julianday(available_at) - julianday(date)) AS min_lag,
       MAX(julianday(available_at) - julianday(date)) AS max_lag
       FROM series GROUP BY metric, source''').fetchall()
    with (rep / 'lag_check.csv').open('w', newline='') as f:
        w = csv.writer(f); w.writerow(['metric', 'source', 'rows', 'bad_rows', 'min_lag', 'max_lag']); w.writerows(rows)
    lag_fail = []
    for metric, source, n, bad, mn, mx in rows:
        req = 0
        if source in ('coinmetrics', 'defillama', 'fred', 'blockchain_info', 'farside'):
            req = {'WALCL': 8, 'WTREGEN': 8, 'WRESBAL': 8, 'M2SL': 30}.get(metric, 1)
        if source == 'okx' and metric.startswith('okx_'):
            req = 1
        if req >= 1 and bad != 0:
            lag_fail.append(f'{source}/{metric}: bad_rows={bad}')
        if mn != req or mx != req:
            lag_fail.append(f'{source}/{metric}: lag range {mn}..{mx} != required {req}')
    with (rep / 'sources_check.csv').open('w', newline='') as f:
        w = csv.writer(f); w.writerow(['source']); w.writerows(db.execute('SELECT DISTINCT source FROM series ORDER BY source'))
    cov = db.execute('SELECT metric, asset, source, MIN(date), MAX(date), COUNT(*) FROM series GROUP BY metric, asset, source ORDER BY source, metric, asset').fetchall()
    with (rep / 'coverage.csv').open('w', newline='') as f:
        w = csv.writer(f); w.writerow(['metric', 'asset', 'source', 'first_date', 'last_date', 'rows']); w.writerows(cov)
    have = {(s, m, a): (fd, ld, n) for m, a, s, fd, ld, n in cov}
    missing = []; obtained = []
    for source, metric, asset, lag in CANONICAL:
        if (source, metric, asset) in have:
            fd, ld, n = have[(source, metric, asset)]; obtained.append([source, metric, asset, lag, 'primary', fd, ld, n]); continue
        fb = [s for s in FALLBACK_SOURCES.get(source, []) if (s, metric, asset) in have]
        if fb:
            fd, ld, n = have[(fb[0], metric, asset)]; obtained.append([fb[0], metric, asset, lag, 'fallback_for_' + source, fd, ld, n]); continue
        log = db.execute('SELECT status, message FROM collection_log WHERE source=? AND metric=? AND asset=? ORDER BY run_at DESC LIMIT 1', (source, metric, asset)).fetchone()
        missing.append([source, metric, asset, lag, log[0] if log else 'NOT_ATTEMPTED', (log[1] if log else '')[:300]])
    with (rep / 'missing_core_metrics.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['source', 'metric', 'asset', 'lag_days', 'status', 'error_or_reason']); w.writerows(missing)
    with (rep / 'obtained_core_metrics.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['source', 'metric', 'asset', 'lag_days', 'role', 'first_date', 'last_date', 'rows']); w.writerows(obtained)
    # gap audit for daily series: count missing calendar days between first and last (no filling performed)
    gaps = []
    for m, a, s, fd, ld, n in cov:
        span = (dt.date.fromisoformat(ld) - dt.date.fromisoformat(fd)).days + 1
        gaps.append([s, m, a, fd, ld, n, span, span - n])
    with (rep / 'gap_audit.csv').open('w', newline='') as f:
        w = csv.writer(f); w.writerow(['source', 'metric', 'asset', 'first_date', 'last_date', 'rows', 'calendar_days', 'missing_days']); w.writerows(gaps)
    total, dmin, dmax = db.execute('SELECT COUNT(*), MIN(date), MAX(date) FROM series').fetchone()
    out = dict(checked_at_utc=dt.datetime.now(dt.timezone.utc).isoformat(), total_rows=total, date_min=dmin, date_max=dmax,
               series_count=len(cov), sources=[r[0] for r in db.execute('SELECT DISTINCT source FROM series')],
               lag_check='PASS' if not lag_fail else 'FAIL', lag_failures=lag_fail,
               canonical_pairs=len(CANONICAL), canonical_obtained_primary=sum(1 for o in obtained if o[4] == 'primary'),
               canonical_obtained_fallback=sum(1 for o in obtained if o[4] != 'primary'), canonical_missing=len(missing))
    (rep / 'data_validation.json').write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if not lag_fail else 1


if __name__ == '__main__':
    sys.exit(main())
