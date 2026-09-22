#!/usr/bin/env python3
"""CYCLE / REGIME / TACTICAL composites under docs/PREREGISTRATION.md.

No weights are fitted. Component selection uses ONLY development-window results
(evaluation/ic_ranking_dev.csv, clusters_dev.csv). Composite = equal-weight mean of
(causal expanding percentile rank x pre-registered sign). Two variants are produced:
  confirmed      : components that passed the development confirmation rule (may be empty)
  exploratory    : all pre-registered signed components of the system (labelled exploratory)
Then: development yearly IC, leave-one-out ablation on development, ONE holdout evaluation,
cost-aware exposure backtests vs baselines, sensitivities, source dropout.
"""
from __future__ import annotations
import datetime as dt, json, sys
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from .dataset import Data, forward_log_return
from .features import registry, expanding_pct
from .evaluate import log_experiment, PRIMARY, SECONDARY, DEV_END, HOLDOUT_START, block_bootstrap_ic, slice_mask

ROOT = Path(__file__).resolve().parents[1]
COST = 0.0015  # per side: 0.10% fee + 0.05% slippage
PRICE_FOR = {'cycle': 'cm', 'regime': 'cm', 'tactical': 'okx'}   # regime confirmation window = CM (amendment, attempt 3); executable check on OKX below
REBAL = {'cycle': 7, 'regime': 7, 'tactical': 1}
BASELINES = {'cycle': {'price_only': 'M057', 'onchain_only': 'O003'}, 'regime': {'price_only': 'M001', 'onchain_only': 'O079'}, 'tactical': {'price_only': 'M017', 'onchain_only': None}}
SOURCE_OF = {}  # fid -> source family for dropout tests


def source_family(fid: str) -> str:
    if fid in ('M115', 'M106', 'M107', 'M109', 'M110', 'M108', 'M105'):
        return 'fred'
    if fid in ('O102', 'O103', 'O113', 'O115'):
        return 'defillama'
    if fid in ('M096', 'M096t'):
        return 'alternative_me'
    if fid in ('M117',):
        return 'farside'
    if fid in ('M017', 'M040', 'N005', 'N006', 'M018', 'M021', 'M044', 'M068', 'M053', 'M067', 'N007', 'N008', 'M032', 'C001'):
        return 'okx'
    return 'coinmetrics'


def composite(panel: pd.DataFrame, comps: list[tuple[str, int]], min_periods: int = 365) -> tuple[pd.Series, pd.DataFrame]:
    parts = {}
    for fid, sign in comps:
        pct = expanding_pct(panel[fid].dropna(), min_periods).reindex(panel.index)
        parts[fid] = pct if sign > 0 else 1.0 - pct   # both on [0,1]; 1 = favourable under the pre-registered sign
    P = pd.DataFrame(parts)
    need = max(1, int(np.ceil(0.5 * len(comps))))
    score = P.mean(axis=1).where(P.notna().sum(axis=1) >= need)
    return score, P


def ic(x: pd.Series, y: pd.Series) -> tuple[float, int]:
    df = pd.concat([x, y], axis=1).dropna()
    return (spearmanr(df.iloc[:, 0], df.iloc[:, 1]).correlation if len(df) > 30 else np.nan), len(df)


def yearly_ic(score: pd.Series, y: pd.Series, h: int, end: pd.Timestamp) -> pd.DataFrame:
    df = pd.concat([score, y], axis=1, keys=['s', 'y']).dropna()
    df = df[df.index + pd.Timedelta(days=h) <= end]
    out = []
    for yr, g in df.groupby(df.index.year):
        if len(g) >= 60:
            out.append(dict(year=int(yr), n=len(g), ic=round(spearmanr(g.s, g.y).correlation, 4)))
    return pd.DataFrame(out)


def backtest(score: pd.Series, close: pd.Series, mode: str, rebal: int, cost: float = COST, invert: bool = False) -> tuple[pd.DataFrame, dict]:
    """Long-only exposure in [0,1] from the causal percentile of the score. Position set at close D, applied to return D->D+1."""
    c = close.reindex(pd.date_range(close.index.min(), close.index.max(), freq='D'))
    r = np.log(c).diff().shift(-1)   # return earned from close D to close D+1
    pct = expanding_pct(score.dropna(), 365).reindex(c.index)
    expo = (1 - pct) if invert else pct
    expo = expo.where(expo.notna())
    # rebalance every `rebal` days: hold exposure between rebalances
    idx = np.arange(len(expo)); keep = (idx % rebal) == 0
    expo = expo.where(keep).ffill(limit=rebal)
    df = pd.DataFrame({'ret': r, 'expo': expo}).dropna()
    df['turnover'] = df['expo'].diff().abs().fillna(df['expo'].abs())
    df['strat'] = df['expo'] * df['ret'] - cost * df['turnover']
    return df, stats(df)


def stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}
    yrs = len(df) / 365.25
    s = df['strat']; bh = df['ret']
    def _m(x):
        eq = x.cumsum(); dd = (eq - eq.cummax()).min()
        return dict(cagr=round(float(np.expm1(x.sum() / yrs)), 4), vol=round(float(x.std() * np.sqrt(365)), 4),
                    sharpe=round(float(x.mean() / x.std() * np.sqrt(365)) if x.std() > 0 else np.nan, 3), max_dd_log=round(float(dd), 4))
    out = dict(start=str(df.index.min().date()), end=str(df.index.max().date()), years=round(yrs, 2), avg_exposure=round(float(df['expo'].mean()), 3),
               turnover_per_year=round(float(df['turnover'].sum() / yrs), 2), strategy=_m(s), buy_and_hold=_m(bh))
    # vol-matched comparison: scale B&H to the strategy's average exposure
    out['bh_scaled_to_avg_exposure'] = _m(bh * df['expo'].mean())
    return out


def run_system(name: str, panel: pd.DataFrame, feats, d: Data, rank: pd.DataFrame, clusters: pd.DataFrame) -> dict:
    h = PRIMARY[name]; h2 = SECONDARY[name]; pk = PRICE_FOR[name]
    close = d.close('btc', pk); y = forward_log_return(close, h); y2 = forward_log_return(close, h2)
    fmap = {f.fid: f for f in feats}
    signed = [f for f in feats if f.system == name and f.sign != 0]
    rk = rank[rank.system == name].set_index('fid')
    # ---- family dedupe on development clusters (|rho|>0.8): keep the better worst-slice member
    drop = set()
    for _, row in clusters.iterrows():
        a, b = row['a'], row['b']
        if a in rk.index and b in rk.index and a not in drop and b not in drop:
            wa, wb = rk.loc[a, 'worst_signed_ic'], rk.loc[b, 'worst_signed_ic']
            drop.add(b if (np.nan_to_num(wa, nan=-9) >= np.nan_to_num(wb, nan=-9)) else a)
    confirmed = [(f.fid, f.sign) for f in signed if f.fid in rk.index and rk.loc[f.fid, 'status'] == 'confirmed_dev' and f.fid not in drop]
    exploratory = [(f.fid, f.sign) for f in signed if f.fid in rk.index and rk.loc[f.fid, 'status'] != 'insufficient' and f.fid not in drop]
    out = dict(system=name, horizon=h, price=pk, dedupe_dropped=sorted(drop), confirmed_components=[c[0] for c in confirmed], exploratory_components=[c[0] for c in exploratory])
    outdir = ROOT / 'systems' / name; outdir.mkdir(parents=True, exist_ok=True)
    results = {}
    for variant, comps in (('confirmed', confirmed), ('exploratory', exploratory)):
        if not comps:
            results[variant] = dict(status='EMPTY: no component passed the pre-registered confirmation rule'); continue
        score, parts = composite(panel, comps)
        dev_mask = (score.index + pd.Timedelta(days=h) <= DEV_END)
        s_dev = score[dev_mask]; s_hold = score[score.index >= HOLDOUT_START]
        res = dict(components=[c[0] for c in comps], n_components=len(comps))
        # development: pooled IC with block bootstrap, yearly IC, slices
        df = pd.concat([s_dev, y], axis=1, keys=['s', 'y']).dropna()
        res['dev_ic'], res['dev_n'] = ic(s_dev, y)
        res['dev_ic_ci90'] = block_bootstrap_ic(df.s.values, df.y.values, max(h, 20)) if len(df) > 2 * h else (np.nan, np.nan)
        res['dev_ic_secondary_h'] = ic(s_dev, y2)[0]
        res['dev_yearly'] = yearly_ic(score, y, h, DEV_END).to_dict('records')
        res['dev_slices'] = {sl: round(ic(s_dev[slice_mask(s_dev.index, h, sl)], y)[0], 4) for sl in ('full', 'ex_2020-03_2022-01', 'ex_2017', 'since_2022')}
        # leave-one-out ablation on development
        abl = []
        for fid, sgn in comps:
            rest = [c for c in comps if c[0] != fid]
            if not rest:
                continue
            sc, _ = composite(panel, rest); v = ic(sc[dev_mask], y)[0]
            abl.append(dict(removed=fid, name=fmap[fid].name, dev_ic_without=round(v, 4), delta_vs_full=round(v - res['dev_ic'], 4), harmful=bool(v - res['dev_ic'] > 0.01)))
        res['ablation_dev'] = abl
        # single-component development IC for contribution comparison
        res['single_component_dev_ic'] = {fid: round(ic(parts[fid][dev_mask], y)[0], 4) for fid, _ in comps}
        # ---- ONE holdout evaluation (no changes after this)
        res['holdout_ic'], res['holdout_n'] = ic(s_hold, y)
        dfh = pd.concat([s_hold, y], axis=1, keys=['s', 'y']).dropna()
        res['holdout_ic_ci90'] = block_bootstrap_ic(dfh.s.values, dfh.y.values, max(h, 20)) if len(dfh) > 2 * h else (np.nan, np.nan)
        res['holdout_ic_secondary_h'] = ic(s_hold, y2)[0]
        res['holdout_yearly'] = yearly_ic(s_hold, y, h, score.index.max()).to_dict('records')
        # ---- backtests (exposure sizing, costs), development and holdout separately
        invert = (name == 'cycle')  # CYCLE: high score = expensive => lower exposure. REGIME/TACTICAL: high score = favourable.
        bt = {}
        for win, sc in (('dev', score[score.index <= DEV_END]), ('holdout', s_hold)):
            dfb, st = backtest(sc, close[close.index <= (DEV_END if win == 'dev' else close.index.max())] if win == 'dev' else close[close.index >= HOLDOUT_START], 'pct', REBAL[name], invert=invert)
            bt[win] = st; dfb.to_csv(outdir / f'backtest_{variant}_{win}.csv')
            for bname, bfid in BASELINES[name].items():
                if bfid is None:
                    continue
                bsc = panel[bfid] * fmap[bfid].sign * (-1 if invert else 1)
                bsc = bsc[bsc.index <= DEV_END] if win == 'dev' else bsc[bsc.index >= HOLDOUT_START]
                _, bst = backtest(bsc, close[close.index <= DEV_END] if win == 'dev' else close[close.index >= HOLDOUT_START], 'pct', REBAL[name], invert=invert)
                bt[f'{win}_baseline_{bname}_{bfid}'] = bst
        res['backtests'] = bt
        # ---- sensitivities
        sens = {}
        sc2, _ = composite(panel, comps, min_periods=730); sens['min_periods_730_dev_ic'] = round(ic(sc2[dev_mask], y)[0], 4); sens['min_periods_730_holdout_ic'] = round(ic(sc2[sc2.index >= HOLDOUT_START], y)[0], 4)
        _, st2 = backtest(score[score.index <= DEV_END], close[close.index <= DEV_END], 'pct', REBAL[name] * 4, invert=invert); sens['rebalance_x4_dev'] = st2.get('strategy')
        _, st3 = backtest(score[score.index <= DEV_END], close[close.index <= DEV_END], 'pct', REBAL[name], cost=COST * 2, invert=invert); sens['cost_x2_dev'] = st3.get('strategy')
        if name != 'tactical':  # executable-venue check for CM-priced systems
            okx = d.close('btc', 'okx'); yo = forward_log_return(okx, h)
            sens['okx_price_dev_ic'] = round(ic(s_dev[s_dev.index >= pd.Timestamp('2018-01-11')], yo)[0], 4); sens['okx_price_holdout_ic'] = round(ic(s_hold, yo)[0], 4)
        # source dropout
        drops = {}
        for src in sorted({source_family(c[0]) for c in comps}):
            rest = [c for c in comps if source_family(c[0]) != src]
            if rest:
                sc3, _ = composite(panel, rest); drops[src] = dict(dev_ic=round(ic(sc3[dev_mask], y)[0], 4), holdout_ic=round(ic(sc3[sc3.index >= HOLDOUT_START], y)[0], 4), remaining=len(rest))
            else:
                drops[src] = dict(status='composite empty without this source')
        sens['source_dropout'] = drops
        res['sensitivities'] = sens
        # ---- distribution change: score level by year (drift check) and the trend-conditioned check for TACTICAL
        res['score_mean_by_year'] = {int(k): round(float(v), 3) for k, v in score.groupby(score.index.year).mean().dropna().items()}
        if name == 'tactical':
            ctrl = panel['C001']
            for lbl, m in (('uptrend', ctrl == 1), ('downtrend', ctrl == 0)):
                res[f'dev_ic_{lbl}'] = round(ic(s_dev[m.reindex(s_dev.index).fillna(False)], y)[0], 4)
                res[f'holdout_ic_{lbl}'] = round(ic(s_hold[m.reindex(s_hold.index).fillna(False)], y)[0], 4)
        pd.concat([score.rename('score'), parts], axis=1).dropna(how='all').to_csv(outdir / f'composite_{variant}.csv')
        results[variant] = res
    out['results'] = results
    (outdir / 'results.json').write_text(json.dumps(out, indent=2, default=lambda o: float(o) if isinstance(o, (np.floating,)) else str(o)))
    return out


def main() -> None:
    d = Data(); panel = pd.read_pickle(ROOT / 'data/panel.pkl'); feats = registry()
    rank = pd.read_csv(ROOT / 'evaluation/ic_ranking_dev.csv'); clusters = pd.read_csv(ROOT / 'evaluation/clusters_dev.csv')
    allres = {}
    for name in ('cycle', 'regime', 'tactical'):
        allres[name] = run_system(name, panel, feats, d, rank, clusters)
        n = log_experiment('composite_build_and_single_holdout', dict(system=name, confirmed=allres[name]['confirmed_components'], exploratory=allres[name]['exploratory_components'],
                                                                        dropped=allres[name]['dedupe_dropped'], variants={k: (v.get('status') or f"dev_ic={v['dev_ic']:.3f} holdout_ic={v['holdout_ic']:.3f}") for k, v in allres[name]['results'].items()}))
        print(name, 'attempt', n, json.dumps({k: (v.get('status') or dict(dev=v['dev_ic'], hold=v['holdout_ic'])) for k, v in allres[name]['results'].items()}))
    (ROOT / 'systems/all_results.json').write_text(json.dumps(allres, indent=2, default=lambda o: float(o) if isinstance(o, (np.floating,)) else str(o)))


if __name__ == '__main__':
    main()
