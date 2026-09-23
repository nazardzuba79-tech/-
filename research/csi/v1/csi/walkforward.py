#!/usr/bin/env python3
"""Nested walk-forward of the pre-registered selection pipeline (PREREGISTRATION.md §4, specified in v1, implemented in v3).

For each test year Y the confirmation rule, family dedupe and rule-6 pruning are applied ONLY to rows whose targets end by
31.12.(Y-1); the resulting equal-weight composite is evaluated on year Y. Nothing is fitted or tuned.
Years <= 2022 were never a holdout; years >= 2023 are the holdout period that was viewed before in aggregate.
Success criterion (PREREGISTRATION_v3.md B): pooled OOS IC over years <= 2022 has a 90% CI above 0 AND the mean yearly IC over 2023-2026 is > 0.
"""
from __future__ import annotations
import json, zlib
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from .v3util import load_data, expanding_pct_fast, sanitize
from .features import build_panel
from .features_v2 import registry
from .dataset import forward_log_return
from .backtest import exposure, run, trend_exposure
from .evaluate import PRIMARY, slice_mask, log_experiment
from .systems_v3 import target_close, exec_close, REBAL, SMOOTH, BASE, ic_ci

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'walkforward'
YEARS = {'cycle': range(2013, 2026), 'regime': range(2012, 2027), 'tactical': range(2019, 2027)}
SLICES = ('full', 'ex_2020-03_2022-01', 'ex_2017', 'since_2022')


def valid(n: int, h: int) -> bool:
    return n >= 30 and n / max(h, 1) >= (8 if h >= 180 else 30)


def confirm(x: pd.Series, y: pd.Series, sign: int, h: int, train_end: pd.Timestamp, seed: int, reps: int = 200) -> dict:
    df = pd.concat([x, y], axis=1, keys=['x', 'y']).dropna()
    df = df[df.index + pd.Timedelta(days=h) <= train_end]
    res = []
    for sl in SLICES:
        d2 = df[slice_mask(df.index, h, sl)]
        if valid(len(d2), h):
            res.append((sl, spearmanr(d2.x, d2.y).correlation))
    full = [r for r in res if r[0] == 'full']
    if not full:
        return dict(status='insufficient')
    worst = min(r[1] * sign for r in res)
    if not all(np.sign(r[1]) == sign for r in res):
        return dict(status='not_confirmed', worst=worst)
    n = len(df); block = max(h, 20); nb = int(np.ceil(n / block)); rng = np.random.default_rng(seed); b = np.empty(reps)
    xv, yv = df.x.values, df.y.values
    for i in range(reps):
        idx = np.concatenate([(np.arange(block) + s) % n for s in rng.integers(0, n, nb)])[:n]
        b[i] = spearmanr(xv[idx], yv[idx]).correlation
    lo, hi = np.nanpercentile(b, 5), np.nanpercentile(b, 95)
    return dict(status='confirmed' if (lo > 0 or hi < 0) else 'not_confirmed', worst=worst, lo=lo, hi=hi)


def score_from(parts: pd.DataFrame, comps: list[str]) -> pd.Series:
    P = parts[comps]; need = max(1, int(np.ceil(0.5 * len(comps))))
    return P.mean(axis=1).where(P.notna().sum(axis=1) >= need)


def ic_rows(score: pd.Series, y: pd.Series, mask_index) -> float:
    df = pd.concat([score, y], axis=1).dropna(); df = df[df.index.isin(mask_index)]
    return spearmanr(df.iloc[:, 0], df.iloc[:, 1]).correlation if len(df) > 30 else np.nan


def run_system(system: str, panel: pd.DataFrame, feats, d) -> dict:
    h = PRIMARY[system]; y = forward_log_return(target_close(d, system), h); px = exec_close(d, system)
    cands = [f for f in feats if f.system == system and f.sign != 0]
    parts = pd.DataFrame({f.fid: (expanding_pct_fast(panel[f.fid], 365) if f.sign > 0 else 1 - expanding_pct_fast(panel[f.fid], 365)).reindex(panel.index) for f in cands})
    folds = []; oos = {v: [] for v in ('confirmed', 'pruned')}; expo = {(v, m): [] for v in ('confirmed', 'pruned') for m in ('rebal', 'smooth')}
    for Y in YEARS[system]:
        train_end = pd.Timestamp(f'{Y - 1}-12-31'); ystart, yend = pd.Timestamp(f'{Y}-01-01'), pd.Timestamp(f'{Y}-12-31')
        stat = {f.fid: confirm(panel[f.fid], y, f.sign, h, train_end, zlib.crc32(f'{f.fid}|{Y}'.encode())) for f in cands}
        conf = [f.fid for f in cands if stat[f.fid]['status'] == 'confirmed']
        # dedupe among confirmed only, on training dates
        tr = parts.loc[parts.index <= train_end, conf]
        corr = tr.corr(method='spearman', min_periods=365) if conf else pd.DataFrame()
        pairs = sorted(((abs(corr.loc[a, b]), a, b) for i, a in enumerate(conf) for b in conf[i + 1:] if pd.notna(corr.loc[a, b]) and abs(corr.loc[a, b]) > 0.8), reverse=True)
        drop = set()
        for _, a, b in pairs:
            if a in drop or b in drop:
                continue
            wa, wb = stat[a]['worst'], stat[b]['worst']
            drop.add(b if (wa, b) > (wb, a) else a)
        comps = [c for c in conf if c not in drop]
        pruned = []
        if comps:
            sc = score_from(parts, comps)
            tr_idx = sc.index[sc.index + pd.Timedelta(days=h) <= train_end]
            base = ic_rows(sc, y, tr_idx)
            if len(comps) > 1:
                pruned = [c for c in comps if not (ic_rows(score_from(parts, [x for x in comps if x != c]), y, tr_idx) - base > 0.01)]
            else:
                pruned = list(comps)
        row = dict(year=Y, train_end=str(train_end.date()), candidates_valid=sum(1 for v in stat.values() if v['status'] != 'insufficient'),
                   confirmed=conf, dedupe_dropped=sorted(drop), components=comps, pruned=pruned)
        for v, cl in (('confirmed', comps), ('pruned', pruned)):
            if not cl:
                row[f'test_ic_{v}'] = None; row[f'test_n_{v}'] = 0; continue
            sc = score_from(parts, cl)
            test = pd.concat([sc.rename('score'), y.rename('y')], axis=1).dropna()
            test = test[(test.index >= ystart) & (test.index <= yend)]
            row[f'test_n_{v}'] = len(test); row[f'test_ic_{v}'] = round(float(spearmanr(test.score, test.y).correlation), 4) if len(test) > 30 else None
            if len(test):
                oos[v].append(test.assign(year=Y))
            for m, k in (('rebal', 1), ('smooth', SMOOTH[system])):
                e = exposure(sc, REBAL[system], k)
                expo[(v, m)].append(e[(e.index >= ystart) & (e.index <= yend)])
        folds.append(row)
        print(system, Y, 'confirmed', comps, 'pruned', pruned, 'test_ic', row.get('test_ic_confirmed'), row.get('test_ic_pruned'), flush=True)
    sysdir = OUT / system; sysdir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(folds).to_csv(sysdir / 'folds.csv', index=False)
    summary = dict(system=system, horizon=h, folds=folds)
    b = BASE[system]; fb = {f.fid: f for f in feats}[b]
    for v in ('confirmed', 'pruned'):
        if not oos[v]:
            summary[v] = dict(status='no fold produced a model'); continue
        O = pd.concat(oos[v]); O.to_csv(sysdir / f'oos_scores_{v}.csv')
        devO, holdO = O[O.year <= 2022], O[O.year >= 2023]
        yearly = O.groupby('year').apply(lambda g: spearmanr(g.score, g.y).correlation if len(g) > 30 else np.nan, include_groups=False)
        s = dict(years_with_model=sorted(int(x) for x in O.year.unique()),
                 pooled_dev_years=ic_ci(devO.score, devO.y, max(h, 20)) if len(devO) else None,
                 pooled_holdout_years=ic_ci(holdO.score, holdO.y, max(h, 20)) if len(holdO) else None,
                 yearly_ic={int(k): (round(float(val), 4) if pd.notna(val) else None) for k, val in yearly.items()})
        dv = [val for k, val in yearly.items() if k <= 2022 and pd.notna(val)]; hv = [val for k, val in yearly.items() if k >= 2023 and pd.notna(val)]
        s['share_positive_years_dev'] = round(float(np.mean([x > 0 for x in dv])), 3) if dv else None
        s['mean_yearly_ic_holdout_years'] = round(float(np.mean(hv)), 4) if hv else None
        lo = (s['pooled_dev_years'] or {}).get('lo')
        s['success_criterion'] = bool(lo is not None and lo > 0 and s['mean_yearly_ic_holdout_years'] is not None and s['mean_yearly_ic_holdout_years'] > 0)
        bts = {}
        for m in ('rebal', 'smooth'):
            e = pd.concat(expo[(v, m)]).sort_index(); e = e[~e.index.duplicated()]
            for win, a, z in (('dev_years', None, pd.Timestamp('2022-12-31')), ('holdout_years', pd.Timestamp('2023-01-01'), None), ('all_years', None, None)):
                dfb, st = run(e, px, a, z)
                if not st:
                    continue
                dates = dfb.index
                eb = exposure(panel[b] * fb.sign, REBAL[system], 1 if m == 'rebal' else SMOOTH[system]).reindex(dates)
                et = trend_exposure(px).reindex(dates)
                st['baseline_price_only_' + b] = run(eb.dropna(), px, a, z)[1].get('strategy')
                st['baseline_trend200'] = run(et.dropna(), px, a, z)[1].get('strategy')
                bts[f'{m}:{win}'] = st
                dfb.to_csv(sysdir / f'oos_backtest_{v}_{m}_{win}.csv')
        s['backtests'] = bts
        summary[v] = s
    return summary


def main() -> None:
    d = load_data(); feats = registry(); panel, _ = build_panel(d, feats); panel, _ = sanitize(panel)
    OUT.mkdir(exist_ok=True); allres = {}
    for system in ('regime', 'tactical', 'cycle'):
        allres[system] = run_system(system, panel, feats, d)
    (OUT / 'summary.json').write_text(json.dumps(allres, indent=2, default=str))
    n = log_experiment('walkforward_v3', {s: {v: (allres[s][v].get('success_criterion') if isinstance(allres[s].get(v), dict) else None) for v in ('confirmed', 'pruned')} for s in allres})
    print('attempt', n)


if __name__ == '__main__':
    main()
