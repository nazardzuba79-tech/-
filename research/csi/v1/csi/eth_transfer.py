#!/usr/bin/env python3
"""ETH transfer test (PREREGISTRATION_v3.md E): the FROZEN BTC component sets, signs and rules applied to ETH inputs with
1:1 definitions. ETH was never used for selection, so the whole ETH history is out-of-sample for the selection step.
Semi-independent: ETH and BTC returns are correlated and M106 (dollar index) is shared.
Pass criterion: 90% block-bootstrap CI of the full-period IC is above 0."""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from .v3util import load_data, expanding_pct_fast, h10_available, known_var, sanitize
from .dataset import forward_log_return
from .backtest import exposure, run, trend_exposure
from .evaluate import PRIMARY, DEV_END, HOLDOUT_START, log_experiment
from .systems_v3 import ic_ci, REBAL, kimchi_realistic

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'eth_transfer'
SETS = {'cycle_confirmed': ('cycle', ['M066']),
        'regime_confirmed': ('regime', ['O080', 'M106', 'M015', 'N004', 'R101', 'R105', 'R106']),   # R108 has no ETH equivalent
        'regime_pruned': ('regime', ['O080', 'R101', 'R105', 'R106']),
        'tactical_confirmed': ('tactical', ['T102', 'T108', 'T110'])}
SIGN = {'M066': -1, 'O080': -1, 'M106': -1, 'M015': 1, 'N004': 1, 'R101': -1, 'R105': 1, 'R106': -1, 'T102': -1, 'T108': 1, 'T110': 1}
BITMEX = {'R101', 'T102'}


def powerlaw_residual(price: pd.Series, genesis: str, min_obs: int = 730) -> pd.Series:
    p = np.log(price); x = np.log((p.index - pd.Timestamp(genesis)).days.values.astype(float)); y = p.values; out = np.full(len(y), np.nan)
    sx = sy = sxx = sxy = 0.0; n = 0
    for i in range(len(y)):
        if not np.isnan(y[i]):
            n += 1; sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]
            if n >= min_obs:
                b = (n * sxy - sx * sy) / (n * sxx - sx * sx); a = (sy - b * sx) / n; out[i] = y[i] - (a + b * x[i])
    return pd.Series(out, index=p.index)


def eth_panel(d, realistic: bool = False) -> pd.DataFrame:
    cm = lambda m: d.raw('coinmetrics', m, 'eth')
    price = cm('PriceUSD'); cb = d.raw('coinbase', 'spot_close', 'ethusd'); bs = d.raw('bitstamp', 'spot_close', 'ethusd')
    prem = (cb / bs.reindex(cb.index) - 1).dropna()
    up = d.raw('upbit', 'spot_close', 'krw-eth'); fx = d.raw('fred', 'DEXKOUS')
    kimchi = kimchi_realistic(d, 'krw-eth', 'ethusd') if realistic else (up / fx.reindex(up.index, method='ffill', limit=5) / cb.reindex(up.index) - 1).dropna()
    fund = d.raw('bitmex', 'funding_rate_daily', 'ethusd')
    dxy = d.raw('fred', 'DTWEXBGS').pct_change(21)
    cols = {
        'M066': d.known(powerlaw_residual(price, '2015-07-30'), 1),
        'O080': d.known(cm('SplyExNtv').pct_change(30), 1),
        'M106': (known_var(dxy.dropna(), h10_available(dxy.dropna().index), d.calendar, 10) if realistic else d.known(dxy, 1, 10)),
        'M015': d.known(np.log(price / price.shift(90)), 1),
        'N004': d.known(np.log(cm('volume_reported_spot_usd_1d').rolling(7).mean()).diff(30), 1),
        'R101': d.known(fund.rolling(30).mean(), 0),
        'R105': d.known(prem.rolling(30).mean(), 0),
        'R106': d.known(kimchi.rolling(30).mean(), 1),
        'T102': d.known(fund.rolling(7).mean(), 0),
        'T108': d.known(d.raw('deribit', 'dvol_close', 'eth'), 0),
        'T110': d.known(prem.rolling(3).mean(), 0),
    }
    return sanitize(pd.DataFrame(cols))[0]


def main() -> None:
    d = load_data(); OUT.mkdir(exist_ok=True); res = {}
    for mode in ('registered', 'realistic', 'realistic_no_bitmex'):
        P = eth_panel(d, realistic=(mode != 'registered'))
        parts = {c: (expanding_pct_fast(P[c], 365) if SIGN[c] > 0 else 1 - expanding_pct_fast(P[c], 365)).reindex(P.index) for c in P.columns}
        for name, (system, ids) in SETS.items():
            use = [i for i in ids if not (mode == 'realistic_no_bitmex' and i in BITMEX)]
            if mode == 'realistic_no_bitmex' and use == ids:
                continue
            h = PRIMARY[system]
            tgt = d.raw('binance_vision', 'spot_close', 'ethusdt') if system == 'tactical' else d.raw('coinmetrics', 'PriceUSD', 'eth')
            px = d.raw('binance_vision', 'spot_close', 'ethusdt') if system == 'tactical' else d.raw('bitstamp', 'spot_close', 'ethusd')
            y = forward_log_return(tgt, h)
            Pm = pd.DataFrame({c: parts[c] for c in use}); need = max(1, int(np.ceil(0.5 * len(use))))
            sc = Pm.mean(axis=1).where(Pm.notna().sum(axis=1) >= need)
            j = pd.concat([sc.rename('s'), y.rename('y')], axis=1).dropna()
            yearly = {int(k): round(float(spearmanr(g.s, g.y).correlation), 4) for k, g in j.groupby(j.index.year) if len(g) > 60}
            pre = j[j.index + pd.Timedelta(days=h) <= DEV_END]; post = j[j.index >= HOLDOUT_START]
            r = dict(components=use, horizon=h, first_date=str(j.index.min().date()) if len(j) else None,
                     full=ic_ci(j.s, j.y, max(h, 20)), pre_2023=ic_ci(pre.s, pre.y, max(h, 20)), post_2023=ic_ci(post.s, post.y, max(h, 20)), yearly=yearly)
            lo = r['full'].get('lo'); r['pass'] = bool(lo is not None and lo > 0)
            bt = {}
            for win, a, z in (('full', None, None), ('pre_2023', None, DEV_END), ('post_2023', HOLDOUT_START, None)):
                dfb, st = run(exposure(sc, REBAL[system]), px, a, z)
                if st:
                    st['baseline_trend200'] = run(trend_exposure(px).reindex(dfb.index).dropna(), px, a, z)[1].get('strategy')
                bt[win] = st
            r['backtests'] = bt
            res[f'{name}|{mode}'] = r
            print(name, mode, 'first', r['first_date'], 'full', r['full'], 'pass', r['pass'])
    (OUT / 'results.json').write_text(json.dumps(res, indent=2, default=str))
    print('attempt', log_experiment('eth_transfer_v3', {k: v['pass'] for k, v in res.items()}))


if __name__ == '__main__':
    main()
