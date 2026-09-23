#!/usr/bin/env python3
"""v3: FROZEN v1/v2 component sets re-evaluated with corrected backtest mechanics and realistic publication lags.
No reselection. IC point estimates for the 'registered' lag mode must equal v2 (reproducibility check).

Lag modes (docs/PREREGISTRATION_v3.md D):
  registered           - lags exactly as in v2
  realistic            - FRED H.10 series (DTWEXBGS in M106, DEXKOUS in R106) usable only after the weekly Monday release
  realistic_no_bitmex  - realistic + BitMEX components removed (XBTUSD/ETHUSD settled 2026-09-16: no live data)
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from .v3util import load_data, expanding_pct_fast, h10_available, known_var, sanitize
from .features import build_panel
from .features_v2 import registry
from .dataset import forward_log_return
from .backtest import exposure, run, trend_exposure
from .evaluate import PRIMARY, SECONDARY, DEV_END, HOLDOUT_START, slice_mask, log_experiment

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'systems_v3'
REBAL = {'cycle': 7, 'regime': 7, 'tactical': 1}
SMOOTH = {s: min(h, 30) for s, h in PRIMARY.items()}
BASE = {'cycle': 'M057', 'regime': 'M001', 'tactical': 'M017'}
BITMEX = {'R101', 'T102', 'C102'}
FROZEN = {'cycle': {'confirmed': ['M066']},
          'regime': {'confirmed': ['O080', 'M106', 'M015', 'N004', 'R101', 'R105', 'R106', 'R108'], 'confirmed_pruned': ['O080', 'R101', 'R105', 'R106']},
          'tactical': {'confirmed': ['T102', 'T108', 'T110']}}


def target_close(d, system):
    return d.raw('binance_vision', 'spot_close', 'btcusdt') if system == 'tactical' else d.raw('coinmetrics', 'PriceUSD', 'btc')


def exec_close(d, system):
    return d.raw('binance_vision', 'spot_close', 'btcusdt') if system == 'tactical' else d.raw('bitstamp', 'spot_close', 'btcusd')


def realistic_columns(d, feats) -> dict[str, pd.Series]:
    """Replacement columns for the realistic lag mode (same formulas, publication-aware availability)."""
    f = {x.fid: x for x in feats}; cal = d.calendar; out = {}
    # M106: 21-observation change of DTWEXBGS, known after the H.10 weekly release
    v = d.raw('fred', 'DTWEXBGS').pct_change(21).dropna()
    out['M106'] = known_var(v, h10_available(v.index), cal, max_stale=f['M106'].max_stale)
    # R106: Kimchi premium with the latest DEXKOUS value actually released at each date (H.10), then the registered 30d mean and lag
    out['R106'] = d.known(kimchi_realistic(d, 'krw-btc', 'btcusd').rolling(30).mean(), f['R106'].lag, f['R106'].max_stale)
    return out


def kimchi_realistic(d, market: str, cb_asset: str) -> pd.Series:
    up = d.raw('upbit', 'spot_close', market); cb = d.raw('coinbase', 'spot_close', cb_asset).reindex(up.index)
    fx = d.raw('fred', 'DEXKOUS')
    fx_known = known_var(fx, h10_available(fx.index), pd.date_range(fx.index.min(), up.index.max()), max_stale=10).reindex(up.index)
    return (up / fx_known / cb - 1).dropna()


def parts_for(panel: pd.DataFrame, comps: list[tuple[str, int]]) -> pd.DataFrame:
    return pd.DataFrame({fid: (expanding_pct_fast(panel[fid], 365) if s > 0 else 1 - expanding_pct_fast(panel[fid], 365)).reindex(panel.index) for fid, s in comps})


def score_of(parts: pd.DataFrame) -> pd.Series:
    need = max(1, int(np.ceil(0.5 * parts.shape[1])))
    return parts.mean(axis=1).where(parts.notna().sum(axis=1) >= need)


def ic_ci(x: pd.Series, y: pd.Series, block: int, reps: int = 300, seed: int = 7) -> dict:
    df = pd.concat([x, y], axis=1, keys=['x', 'y']).dropna()
    if len(df) < max(60, 2 * block):
        return dict(ic=None, lo=None, hi=None, n=len(df))
    ic = spearmanr(df.x, df.y).correlation; rng = np.random.default_rng(seed); n = len(df); nb = int(np.ceil(n / block)); b = np.empty(reps)
    xv, yv = df.x.values, df.y.values
    for i in range(reps):
        idx = np.concatenate([(np.arange(block) + s) % n for s in rng.integers(0, n, nb)])[:n]
        b[i] = spearmanr(xv[idx], yv[idx]).correlation
    return dict(ic=round(float(ic), 4), lo=round(float(np.nanpercentile(b, 5)), 4), hi=round(float(np.nanpercentile(b, 95)), 4), n=n, n_eff=round(n / block, 1))


def evaluate_set(system, comps, panel, d, feats) -> dict:
    h = PRIMARY[system]; y = forward_log_return(target_close(d, system), h); px = exec_close(d, system)
    parts = parts_for(panel, comps); sc = score_of(parts)
    dev = sc[sc.index + pd.Timedelta(days=h) <= DEV_END]; hold = sc[sc.index >= HOLDOUT_START]
    res = dict(components=[c[0] for c in comps], dev=ic_ci(dev, y, max(h, 20)), holdout=ic_ci(hold, y, max(h, 20)),
               dev_slices={sl: ic_ci(dev[slice_mask(dev.index, h, sl)], y, max(h, 20), reps=0)['ic'] for sl in ('full', 'ex_2020-03_2022-01', 'ex_2017', 'since_2022')})
    bt = {}
    fmap = {f.fid: f for f in feats}; b = BASE[system]
    base_score = panel[b] * fmap[b].sign
    for mapping, e, eb in (('registered_rebalance', exposure(sc, REBAL[system]), exposure(base_score, REBAL[system])),
                           (f'smoothed_{SMOOTH[system]}d', exposure(sc, REBAL[system], SMOOTH[system]), exposure(base_score, REBAL[system], SMOOTH[system]))):
        for win, start, end in (('dev', None, DEV_END), ('holdout', HOLDOUT_START, None)):
            dfb, st = run(e, px, start, end)
            if st:
                dates = dfb.index
                st['baseline_price_only_' + b] = run(eb, px, start, end)[1].get('strategy')
                _, stt = run(trend_exposure(px), px, start, end)
                st['baseline_trend200'] = stt.get('strategy'); st['baseline_trend200_avg_exposure'] = stt.get('avg_exposure')
            bt[f'{mapping}:{win}'] = st
    res['backtests'] = bt
    return res, sc


def main() -> None:
    d = load_data(); feats = registry()
    panel, _ = build_panel(d, feats)
    panel, nonfinite = sanitize(panel)
    ref = pd.read_pickle(ROOT / 'data/panel_v2.pkl')
    same = {c: bool(np.allclose(panel[c].dropna().values, ref[c].dropna().values, equal_nan=True)) if len(panel[c].dropna()) == len(ref[c].dropna()) else False for c in ref.columns}
    repro = dict(columns=len(same), identical=sum(same.values()), differing=[c for c, v in same.items() if not v], nonfinite_replaced_by_nan=nonfinite,
                 dq_excluded_rows=int(pd.read_csv(ROOT / 'reports/dq_exclusions_v3.csv').shape[0]))
    real = panel.copy()
    for k, v in realistic_columns(d, feats).items():
        real[k] = v.replace([np.inf, -np.inf], np.nan)
    fmap = {f.fid: f for f in feats}
    explo = {s: json.load(open(ROOT / f'systems_v2/{s}/results.json'))['exploratory_components'] for s in FROZEN}
    OUT.mkdir(exist_ok=True); allres = dict(reproducibility_vs_v2_panel=repro, cutoff=str(d.calendar.max().date()))
    for system, sets in FROZEN.items():
        sets = dict(sets); sets['exploratory'] = explo[system]
        allres[system] = {}
        for variant, ids in sets.items():
            for mode, pnl in (('registered', panel), ('realistic', real), ('realistic_no_bitmex', real)):
                use = [i for i in ids if not (mode == 'realistic_no_bitmex' and i in BITMEX)]
                if mode == 'realistic_no_bitmex' and use == ids:
                    continue
                if not use:
                    allres[system][f'{variant}|{mode}'] = dict(status='empty'); continue
                res, sc = evaluate_set(system, [(i, fmap[i].sign) for i in use], pnl, d, feats)
                allres[system][f'{variant}|{mode}'] = res
                sc.rename('score').to_csv(OUT / f'{system}_{variant}_{mode}_score.csv')
                print(system, variant, mode, 'dev', res['dev']['ic'], 'hold', res['holdout']['ic'], res['holdout']['lo'], res['holdout']['hi'])
    (OUT / 'results.json').write_text(json.dumps(allres, indent=2, default=str))
    n = log_experiment('systems_v3_frozen_sets_corrected', dict(reproducibility=repro, note='frozen v1/v2 sets; corrected backtest mechanics; realistic lags; holdout re-read for backtest numbers only (IC unchanged by the fix)'))
    print('attempt', n, 'repro', repro)


if __name__ == '__main__':
    main()
