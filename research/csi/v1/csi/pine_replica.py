#!/usr/bin/env python3
"""Python replicas of the four v3 Pine indicators (platform/pine/*.pine) with their own backtests
(spec logged in experiments.jsonl before computing: attempt 21). Inputs come from the same venues where possible
(Bitstamp, Coinbase, Upbit, Deribit, Binance archive); USD/KRW uses FRED DEXKOUS at its own date (TradingView uses FX_IDC),
so the Kimchi part is an approximation. This is NOT TradingView data and NOT a TradingView compile/backtest."""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from .v3util import load_data, pine_percentrank, pine_valid_count
from .dataset import forward_log_return
from .backtest import run, trend_exposure
from .evaluate import DEV_END, HOLDOUT_START, log_experiment
from .systems_v3 import ic_ci

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'platform' / 'replica'
L = {'cycle': 1461, 'regime': 365, 'tactical': 365}


def pr_guard(src: pd.Series, length: int) -> pd.Series:
    raw = pine_percentrank(src, length); valid = pine_valid_count(src)
    return raw.where(valid > length)


def cycle_gauge(px: pd.Series) -> tuple[pd.Series, pd.Series]:
    t = px.index; x = np.log(np.maximum(1.0, (t - pd.Timestamp('2009-01-03')).days.values.astype(float))); y = np.log(px.values)
    sx = sy = sxx = sxy = 0.0; n = 0; res = np.full(len(y), np.nan)
    for i in range(len(y)):
        sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; n += 1
        if n > 730:
            b = (n * sxy - sx * sy) / (n * sxx - sx * sx); a = (sy - b * sx) / n; res[i] = y[i] - (a + b * x[i])
    resid = pd.Series(res, index=t)
    return pr_guard(resid, L['cycle']), resid


def main() -> None:
    d = load_data(); OUT.mkdir(parents=True, exist_ok=True)
    bs = d.raw('bitstamp', 'spot_close', 'btcusd'); bs = bs.reindex(pd.date_range(bs.index.min(), bs.index.max())).ffill(limit=3)
    bn = d.raw('binance_vision', 'spot_close', 'btcusdt')
    cb = d.raw('coinbase', 'spot_close', 'btcusd'); up = d.raw('upbit', 'spot_close', 'krw-btc')
    fx = d.raw('fred', 'DEXKOUS'); dv = d.raw('deribit', 'dvol_close', 'btc')
    cal = bs.index
    on = lambda s, idx=cal: s.reindex(idx).ffill(limit=3)          # request.security gaps_off: last value on chart bars
    gauge, resid = cycle_gauge(bs)
    cbp = (on(cb) / bs - 1).rolling(30).mean(); kim = (on(up) / on(fx) / on(cb) - 1).rolling(30).mean()
    p1 = pr_guard(cbp, L['regime']); p2 = pr_guard(kim, L['regime'])
    reg = pd.concat([p1, 100 - p2], axis=1).mean(axis=1)
    calb = bn.index
    cbp3 = (on(cb, calb) / on(bs, calb) - 1).rolling(3).mean(); tac = pd.concat([pr_guard(on(dv, calb), L['tactical']), pr_guard(cbp3, L['tactical'])], axis=1).mean(axis=1)
    specs = {
        'CSI_Cycle_Gauge': dict(score=gauge, expo=1 - gauge / 100, px=bs, h=365, ic_sign=-1),
        'CSI_Trend_Filter': dict(score=trend_exposure(bs) * 100, expo=trend_exposure(bs), px=bs, h=30, ic_sign=1),
        'CSI_Regime_Premiums_research': dict(score=reg, expo=reg / 100, px=bs, h=30, ic_sign=1),
        'CSI_Tactical_DVOL_research': dict(score=tac, expo=tac / 100, px=bn, h=7, ic_sign=1),
    }
    res = {}
    for name, s in specs.items():
        y = forward_log_return(s['px'], s['h']); sc = s['score'] * s['ic_sign']
        j = pd.concat([sc.rename('s'), y.rename('y')], axis=1).dropna()
        pre = j[j.index + pd.Timedelta(days=s['h']) <= DEV_END]; post = j[j.index >= HOLDOUT_START]
        r = dict(first_score_date=str(s['score'].dropna().index.min().date()), last_score=round(float(s['score'].dropna().iloc[-1]), 1),
                 last_date=str(s['score'].dropna().index.max().date()), horizon=s['h'], ic_note='IC of the favourable-oriented score (gauge inverted)',
                 ic_full=ic_ci(j.s, j.y, max(s['h'], 20)), ic_pre_2023=ic_ci(pre.s, pre.y, max(s['h'], 20)), ic_post_2023=ic_ci(post.s, post.y, max(s['h'], 20)))
        bt = {}
        for win, a, z in (('full', None, None), ('pre_2023', None, DEV_END), ('post_2023', HOLDOUT_START, None)):
            dfb, st = run(s['expo'].dropna(), s['px'], a, z)
            if st:
                st['baseline_trend200'] = run(trend_exposure(s['px']).reindex(dfb.index).dropna(), s['px'], a, z)[1].get('strategy')
                if win == 'full':
                    dfb.to_csv(OUT / f'{name}_backtest.csv')
            bt[win] = st
        r['backtests'] = bt; res[name] = r
        s['score'].rename('score').to_csv(OUT / f'{name}_score.csv')
        print(name, 'first', r['first_score_date'], 'last', r['last_date'], r['last_score'], '| IC full', r['ic_full'], '| pre', r['ic_pre_2023']['ic'], 'post', r['ic_post_2023']['ic'])
    # descriptive tables for the owner: forward 1-year returns by Cycle gauge zone; trend filter regimes
    y365 = forward_log_return(bs, 365)
    z = pd.concat([gauge.rename('g'), y365.rename('r')], axis=1).dropna()
    z['zone'] = pd.cut(z.g, [-0.1, 20, 40, 60, 80, 100.1], labels=['0-20', '20-40', '40-60', '60-80', '80-100'])
    zones = z.groupby('zone', observed=False).agg(days=('r', 'size'), median_1y_return=('r', lambda v: float(np.expm1(np.median(v))) if len(v) else None),
                                                   share_positive=('r', lambda v: float((v > 0).mean()) if len(v) else None))
    zones['independent_years_approx'] = (zones['days'] / 365).round(1)
    zones.to_csv(OUT / 'cycle_gauge_zones.csv')
    res['cycle_gauge_zones'] = zones.reset_index().to_dict('records')
    tr = trend_exposure(bs); r1 = bs.shift(-1) / bs - 1
    tz = pd.concat([tr.rename('above'), r1.rename('r')], axis=1).dropna()
    res['trend_filter_regimes'] = {('above' if k == 1 else 'below'): dict(days=int(len(g)), mean_daily_return_pct=round(float(g.r.mean() * 100), 3),
                                   daily_vol_pct=round(float(g.r.std() * 100), 2)) for k, g in tz.groupby('above')}
    (OUT / 'results.json').write_text(json.dumps(res, indent=2, default=str))
    print(zones.to_string()); print(res['trend_filter_regimes'])
    print('attempt', log_experiment('pine_replica_v3', {k: v['ic_full'] for k, v in res.items() if isinstance(v, dict) and 'ic_full' in v}))


if __name__ == '__main__':
    main()
