#!/usr/bin/env python3
"""Forward (paper) test ledger (PREREGISTRATION_v3.md F).

snapshot : compute today's score and exposure of every frozen system from the current database and APPEND one row per
           system to forward/ledger.csv. Rows are never edited; each row carries sha256(previous row) (hash chain), the code
           hash and the last date of every input, so later readers can verify nothing was rewritten or back-filled.
evaluate : for rows whose target horizon has elapsed, compare the logged score/exposure with realised returns. Only rows
           written in real time (computed_at <= asof_date + 2 days) count.
verify   : re-check the hash chain.
"""
from __future__ import annotations
import argparse, csv, datetime as dt, hashlib, json, sys
from pathlib import Path
import numpy as np, pandas as pd
from .v3util import load_data, expanding_pct_fast, sanitize
from .features import build_panel
from .features_v2 import registry
from .backtest import exposure, trend_exposure
from .evaluate import PRIMARY
from .dataset import forward_log_return

ROOT = Path(__file__).resolve().parents[1]
FWD = ROOT / 'forward'; LEDGER = FWD / 'ledger.csv'; SPEC = FWD / 'frozen_specs.json'
REBAL = {'cycle': 7, 'regime': 7, 'tactical': 1}; SMOOTH = {s: min(h, 30) for s, h in PRIMARY.items()}
FIELDS = ['row', 'computed_at_utc', 'asof_date', 'system_id', 'system', 'horizon_days', 'score', 'exposure', 'exposure_smoothed',
          'components_available', 'components_missing', 'components_stale', 'source_last_observation', 'code_sha256', 'spec_sha256', 'prev_row_sha256', 'row_sha256']
# A component is 'stale' when its latest SOURCE observation is older than its publication lag + 1 day at the decision date.
# Values are still carried for at most max_stale days (information-set rule); staleness is reported, never hidden.


def default_specs() -> dict:
    specs = {'CYCLE_v1': dict(system='cycle', components=['M066'], origin='v1 confirmed on 2011-2022'),
             'REGIME_v2_confirmed': dict(system='regime', components=['O080', 'M106', 'M015', 'N004', 'R101', 'R105', 'R106', 'R108'], origin='v2 confirmed on 2011-2022'),
             'REGIME_v2_pruned': dict(system='regime', components=['O080', 'R101', 'R105', 'R106'], origin='v2 rule-6 pruning (second holdout look)'),
             'TACTICAL_v2': dict(system='tactical', components=['T102', 'T108', 'T110'], origin='v2 confirmed on 2017-2022')}
    for system in ('cycle', 'regime', 'tactical'):
        p = ROOT / 'walkforward' / system / 'folds.csv'
        if p.exists():
            f = pd.read_csv(p); f = f[f['components'].astype(str) != '[]']
            if len(f):
                last = f.iloc[-1]
                for v, col in (('confirmed', 'components'), ('pruned', 'pruned')):
                    comps = json.loads(str(last[col]).replace("'", '"'))
                    if comps:
                        specs[f'{system.upper()}_wf{int(last.year)}_{v}'] = dict(system=system, components=comps, origin=f'walk-forward selection with training through {last.train_end}')
    specs['TREND200_BTC'] = dict(system='baseline', components=[], origin='binary: Bitstamp BTCUSD close above its 200-day SMA')
    return specs


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def code_hash() -> str:
    return sha(b''.join((ROOT / 'csi' / f).read_bytes() for f in ('features.py', 'features_v2.py', 'v3util.py', 'backtest.py', 'forward.py')))


def last_row_hash() -> str:
    if not LEDGER.exists():
        return 'GENESIS'
    rows = list(csv.DictReader(LEDGER.open()))
    return rows[-1]['row_sha256'] if rows else 'GENESIS'


def snapshot() -> int:
    FWD.mkdir(exist_ok=True)
    if not SPEC.exists():
        SPEC.write_text(json.dumps(default_specs(), indent=2))
    specs = json.loads(SPEC.read_text()); spec_hash = sha(SPEC.read_bytes())
    d = load_data(cutoff=None, write_report=False); feats = registry(); fmap = {f.fid: f for f in feats}
    panel, _ = build_panel(d, feats); panel, _ = sanitize(panel)
    asof = panel.index.max()
    existing = set()
    if LEDGER.exists():
        existing = {(r['system_id'], r['asof_date']) for r in csv.DictReader(LEDGER.open())}
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'); ch = code_hash(); prev = last_row_hash(); new = 0
    rows_out = []
    for sid, sp in specs.items():
        if (sid, str(asof.date())) in existing:
            continue
        if sp['system'] == 'baseline':
            px = d.raw('bitstamp', 'spot_close', 'btcusd'); e = trend_exposure(px)
            score = e; ex = float(e.dropna().iloc[-1]); exs = ex; avail = []; missing = []; stale = []; last_dates = {'bitstamp:btcusd': str(px.index.max().date())}; h = 0
            sc_val = ex
        else:
            comps = sp['components']; h = PRIMARY[sp['system']]
            parts = pd.DataFrame({c: (expanding_pct_fast(panel[c], 365) if fmap[c].sign > 0 else 1 - expanding_pct_fast(panel[c], 365)).reindex(panel.index) for c in comps})
            need = max(1, int(np.ceil(0.5 * len(comps))))
            score = parts.mean(axis=1).where(parts.notna().sum(axis=1) >= need)
            row_parts = parts.loc[asof]
            avail = [c for c in comps if pd.notna(row_parts[c])]; missing = [c for c in comps if c not in avail]
            src_last = {}
            for c in comps:
                raw = fmap[c].build(d).replace([np.inf, -np.inf], np.nan).dropna()
                src_last[c] = str(raw.index.max().date()) if len(raw) else None
            stale = [c for c in comps if src_last[c] is None or (asof - pd.Timestamp(src_last[c])).days > fmap[c].lag + 1]
            sc_val = float(score.loc[asof]) if pd.notna(score.loc[asof]) else None
            e1 = exposure(score, REBAL[sp['system']]); e2 = exposure(score, REBAL[sp['system']], SMOOTH[sp['system']])
            ex = float(e1.loc[asof]) if asof in e1.index and pd.notna(e1.loc[asof]) else None
            exs = float(e2.loc[asof]) if asof in e2.index and pd.notna(e2.loc[asof]) else None
            last_dates = src_last
        row = dict(row=None, computed_at_utc=now, asof_date=str(asof.date()), system_id=sid, system=sp['system'], horizon_days=h,
                   score=None if sc_val is None else round(sc_val, 6), exposure=None if ex is None else round(ex, 6), exposure_smoothed=None if exs is None else round(exs, 6),
                   components_available=json.dumps(avail), components_missing=json.dumps(missing), components_stale=json.dumps(stale), source_last_observation=json.dumps(last_dates),
                   code_sha256=ch, spec_sha256=spec_hash, prev_row_sha256=prev)
        payload = json.dumps({k: row[k] for k in FIELDS if k not in ('row', 'row_sha256')}, sort_keys=True).encode()
        row['row_sha256'] = sha(payload); prev = row['row_sha256']; rows_out.append(row); new += 1
    if rows_out:
        n0 = sum(1 for _ in csv.DictReader(LEDGER.open())) if LEDGER.exists() else 0
        with LEDGER.open('a', newline='') as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            if n0 == 0:
                w.writeheader()
            for i, r in enumerate(rows_out):
                r['row'] = n0 + i + 1; w.writerow(r)
    print(f'asof {asof.date()}: appended {new} rows; ledger {LEDGER}')
    return new


def verify() -> bool:
    rows = list(csv.DictReader(LEDGER.open())); prev = 'GENESIS'; ok = True
    for r in rows:
        payload = json.dumps({k: (None if r[k] == '' else r[k]) for k in FIELDS if k not in ('row', 'row_sha256')}, sort_keys=True)
        # numbers were serialised from floats; re-hash with the stored text form for fields that are numeric
        rr = {k: r[k] for k in FIELDS if k not in ('row', 'row_sha256')}
        for k in ('horizon_days',):
            rr[k] = int(rr[k])
        for k in ('score', 'exposure', 'exposure_smoothed'):
            rr[k] = None if rr[k] == '' else float(rr[k])
        h = sha(json.dumps(rr, sort_keys=True).encode())
        if r['prev_row_sha256'] != prev or h != r['row_sha256']:
            print('BROKEN at row', r['row']); ok = False
        prev = r['row_sha256']
    print('hash chain OK' if ok else 'hash chain BROKEN', len(rows), 'rows')
    return ok


def evaluate() -> None:
    rows = pd.read_csv(LEDGER, parse_dates=['asof_date'])
    rows['realtime'] = (pd.to_datetime(rows['computed_at_utc']).dt.tz_convert(None) - rows['asof_date']).dt.days <= 2
    d = load_data(cutoff=None, write_report=False); out = []
    for sid, g in rows[rows.realtime].groupby('system_id'):
        system = g.system.iloc[0]
        if system == 'baseline':
            continue
        h = int(g.horizon_days.iloc[0])
        px = d.raw('binance_vision', 'spot_close', 'btcusdt') if system == 'tactical' else d.raw('coinmetrics', 'PriceUSD', 'btc')
        y = forward_log_return(px, h).reindex(g.asof_date.values)
        m = pd.DataFrame({'score': g.score.values, 'y': y.values}).dropna()
        out.append(dict(system_id=sid, realtime_rows=len(g), matured_rows=len(m), ic=(m.score.corr(m.y, method='spearman') if len(m) >= 30 else None)))
    print(pd.DataFrame(out).to_string() if out else 'no matured real-time rows yet')


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('cmd', choices=['snapshot', 'verify', 'evaluate']); a = p.parse_args()
    sys.exit(0 if {'snapshot': lambda: snapshot() >= 0, 'verify': verify, 'evaluate': lambda: evaluate() or True}[a.cmd]() else 1)
