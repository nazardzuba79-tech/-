#!/usr/bin/env python3
"""Static data-quality dashboard (platform/dashboard.html): freshness, coverage, missingness, status per series,
system scores if built. Reads csi.db and systems/*.csv only; shows staleness explicitly, never fakes freshness."""
from __future__ import annotations
import datetime as dt, html, json, sqlite3
from pathlib import Path
import pandas as pd
ROOT = Path(__file__).resolve().parents[1]
EXPECTED_CADENCE = {'fred:WALCL': 7, 'fred:WTREGEN': 7, 'fred:WRESBAL': 7, 'fred:M2SL': 31, 'fred:NFCI': 7, 'binance_vision:funding_rate_daily': 31, 'binance_vision:perp_close': 31}


def main() -> None:
    db = sqlite3.connect(ROOT / 'data/csi.db'); today = dt.date.today()
    cov = pd.read_sql_query('SELECT source, metric, asset, MIN(date) first_date, MAX(date) last_date, COUNT(*) rows, MIN(julianday(available_at)-julianday(date)) lag FROM series GROUP BY source, metric, asset', db)
    cov['calendar_days'] = (pd.to_datetime(cov.last_date) - pd.to_datetime(cov.first_date)).dt.days + 1
    cov['missing_pct'] = ((1 - cov.rows / cov.calendar_days) * 100).round(1)
    cov['days_since_last'] = (pd.Timestamp(today) - pd.to_datetime(cov.last_date)).dt.days
    def status(r):
        cad = EXPECTED_CADENCE.get(f'{r.source}:{r.metric}', 1)
        allowed = cad + int(r.lag) + 2
        if r.metric == 'HashRate' and r.asset == 'eth':
            return 'ENDED (PoW ended 2022-09-15)'
        if r.rows < 730:
            base = 'SHORT_HISTORY'
        else:
            base = 'OK'
        return base if r.days_since_last <= allowed else f'STALE ({r.days_since_last}d)'
    cov['status'] = cov.apply(status, axis=1)
    log = pd.read_sql_query("SELECT source, metric, asset, status, message, run_at FROM collection_log WHERE status IN ('FAIL','UNAVAILABLE') ORDER BY run_at DESC", db)
    sys_rows = []
    for name in ('cycle', 'regime', 'tactical'):
        p = ROOT / 'systems' / name / 'results.json'
        if p.exists():
            r = json.loads(p.read_text())
            for variant, v in r['results'].items():
                if 'status' in v:
                    sys_rows.append((name, variant, v['status'], '', '', '')); continue
                comp = pd.read_csv(ROOT / 'systems' / name / f'composite_{variant}.csv', index_col=0)
                last = comp['score'].dropna()
                sys_rows.append((name, variant, f"{len(v['components'])} components", f"dev IC {v['dev_ic']:.3f}", f"holdout IC {v['holdout_ic']:.3f}", f"last score {last.iloc[-1]:.3f} @ {last.index[-1]}" if len(last) else 'no score'))
    css = 'body{font-family:system-ui;margin:24px;background:#fff;color:#111}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccc;padding:3px 6px}.OK{background:#d8f5d8}.STALE{background:#ffe0b3}.SHORT_HISTORY{background:#fff3b0}.ENDED{background:#e0e0e0}h2{margin-top:32px}.warn{color:#a00}'
    h = [f'<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>CSI data quality</title><style>{css}</style></head><body>',
         f'<h1>CSI v1 — стан даних</h1><p>Згенеровано {dt.datetime.now(dt.timezone.utc).isoformat()} (UTC). Це статичний знімок; цифри не оновлюються без повторного запуску <code>python -m csi.collect --source all &amp;&amp; python -m csi.dashboard</code>.</p>',
         '<p class="warn">Research-only. Жодна серія не є торговим сигналом. Статуси STALE означають, що останнє спостереження старіше за очікувану каденцію + контрактний лаг; такі серії не слід показувати як актуальні.</p>',
         '<h2>Системи (score — не інструкція до угоди)</h2><table><tr><th>system</th><th>variant</th><th>state</th><th>dev</th><th>holdout</th><th>last</th></tr>']
    for r in sys_rows:
        h.append('<tr>' + ''.join(f'<td>{html.escape(str(x))}</td>' for x in r) + '</tr>')
    h.append('</table><h2>Покриття, свіжість, пропуски</h2><table><tr><th>source</th><th>metric</th><th>asset</th><th>first</th><th>last</th><th>rows</th><th>missing %</th><th>lag</th><th>days since last</th><th>status</th></tr>')
    for r in cov.sort_values(['source', 'metric', 'asset']).itertuples():
        cls = r.status.split(' ')[0]
        h.append(f'<tr class="{cls}"><td>{r.source}</td><td>{r.metric}</td><td>{r.asset}</td><td>{r.first_date}</td><td>{r.last_date}</td><td>{r.rows}</td><td>{r.missing_pct}</td><td>{int(r.lag)}</td><td>{r.days_since_last}</td><td>{html.escape(r.status)}</td></tr>')
    h.append('</table><h2>Невдалі / недоступні збори (останні записи)</h2><table><tr><th>source</th><th>metric</th><th>asset</th><th>status</th><th>message</th><th>run_at</th></tr>')
    for r in log.head(80).itertuples():
        h.append(f'<tr><td>{r.source}</td><td>{r.metric}</td><td>{r.asset}</td><td>{r.status}</td><td>{html.escape(str(r.message)[:220])}</td><td>{r.run_at}</td></tr>')
    h.append('</table></body></html>')
    (ROOT / 'platform/dashboard.html').write_text('\n'.join(h), encoding='utf-8')
    cov.to_csv(ROOT / 'platform/dashboard_coverage.csv', index=False)
    print('dashboard written', len(cov), 'series;', (cov.status.str.startswith('STALE')).sum(), 'stale')


if __name__ == '__main__':
    main()
