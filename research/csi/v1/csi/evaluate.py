#!/usr/bin/env python3
"""Individual candidate evaluation under the pre-registered protocol (docs/PREREGISTRATION.md).

Outputs (evaluation/):
  ic_individual.csv        IC per feature x horizon x slice x window(dev/holdout) with block-bootstrap 90% band
  ic_ranking_dev.csv       worst-valid-slice ranking on development window only, primary horizon per system
  clusters_dev.csv         Spearman correlation families on development (|rho|>0.8)
  corr_dev.csv             full development correlation matrix of causal percentile ranks
Every call is appended to experiments/experiments.jsonl with a counter.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, sys
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
from .dataset import Data, forward_log_return
from .features import build_panel, registry, expanding_pct

ROOT = Path(__file__).resolve().parents[1]
HORIZONS = [1, 7, 30, 90, 180, 365]
PRIMARY = {'cycle': 365, 'regime': 30, 'tactical': 7}
SECONDARY = {'cycle': 180, 'regime': 90, 'tactical': 1}
DEV_END = pd.Timestamp('2022-12-31'); EMBARGO = 30; HOLDOUT_START = DEV_END + pd.Timedelta(days=EMBARGO + 1)
EXCL = {'ex_2020-03_2022-01': (pd.Timestamp('2020-03-01'), pd.Timestamp('2022-01-31')), 'ex_2017': (pd.Timestamp('2017-01-01'), pd.Timestamp('2017-12-31'))}
RNG = np.random.default_rng(20260922)


def log_experiment(kind: str, payload: dict) -> int:
    p = ROOT / 'experiments/experiments.jsonl'; p.parent.mkdir(exist_ok=True)
    n = sum(1 for _ in p.open()) if p.exists() else 0
    rec = dict(attempt=n + 1, at_utc=dt.datetime.now(dt.timezone.utc).isoformat(), kind=kind, **payload)
    with p.open('a') as f:
        f.write(json.dumps(rec, ensure_ascii=False, default=str) + '\n')
    return n + 1


def check_prereg() -> str:
    h = hashlib.sha256((ROOT / 'csi/features.py').read_bytes()).hexdigest()
    rec = (ROOT / 'docs/PREREGISTRATION_HASH.txt').read_text().strip()
    if h != rec:
        log_experiment('PROTOCOL_VIOLATION', dict(msg='features.py changed after pre-registration', recorded=rec, current=h))
        print('WARNING: features.py hash differs from pre-registration record', file=sys.stderr)
    return h


def slice_mask(idx: pd.DatetimeIndex, h: int, name: str) -> np.ndarray:
    if name == 'full':
        return np.ones(len(idx), bool)
    if name == 'since_2022':
        return np.asarray(idx >= pd.Timestamp('2022-01-01'))
    a, b = EXCL[name]; end = idx + pd.Timedelta(days=h)
    overlap = (idx <= b) & (end >= a)   # decision date or target window touches the excluded interval
    return np.asarray(~overlap)


def block_bootstrap_ic(x: np.ndarray, y: np.ndarray, block: int, n_boot: int = 300) -> tuple[float, float]:
    n = len(x)
    if n < 2 * block:
        return np.nan, np.nan
    nb = int(np.ceil(n / block)); out = np.empty(n_boot)
    for b in range(n_boot):
        starts = RNG.integers(0, n, nb)
        idx = np.concatenate([(np.arange(block) + s) % n for s in starts])[:n]
        out[b] = spearmanr(x[idx], y[idx]).correlation
    return float(np.nanpercentile(out, 5)), float(np.nanpercentile(out, 95))


def ic_table(panel: pd.DataFrame, feats, targets: dict[str, pd.DataFrame], boot: bool = True) -> pd.DataFrame:
    rows = []
    for f in feats:
        x_all = panel[f.fid]
        price_keys = ['cm'] if f.system in ('cycle', 'control') and f.fid != 'C001' else (['okx', 'cm'] if f.system == 'regime' else ['okx'])
        for price_key in price_keys:
          for h in HORIZONS:
              y_all = targets[price_key][h]
              df = pd.concat([x_all, y_all], axis=1, keys=['x', 'y']).dropna()
              for window, wmask in (('dev', df.index + pd.Timedelta(days=h) <= DEV_END), ('holdout', df.index >= HOLDOUT_START)):
                  d1 = df[wmask]
                  for sl in ('full', 'ex_2020-03_2022-01', 'ex_2017', 'since_2022'):
                      if window == 'holdout' and sl != 'full':
                          continue
                      d2 = d1[slice_mask(d1.index, h, sl)]
                      n = len(d2); n_eff = n / max(h, 1)
                      # amended validity rule (experiments.jsonl attempt 3): N_eff>=30 is unattainable for h>=180 with ~12y of data
                      if n < 30 or n_eff < (8 if h >= 180 else 30):
                          rows.append(dict(fid=f.fid, name=f.name, system=f.system, sign=f.sign, price=price_key, horizon=h, window=window, slice=sl, n=n, n_eff=round(n_eff, 1), ic=np.nan, lo=np.nan, hi=np.nan, status='insufficient')); continue
                      ic = spearmanr(d2['x'].values, d2['y'].values).correlation
                      lo, hi = block_bootstrap_ic(d2['x'].values, d2['y'].values, max(h, 20)) if boot else (np.nan, np.nan)
                      signed = ic * f.sign if f.sign else np.nan
                      rows.append(dict(fid=f.fid, name=f.name, system=f.system, sign=f.sign, price=price_key, horizon=h, window=window, slice=sl, n=n, n_eff=round(n_eff, 1),
                                       ic=round(ic, 4), lo=round(lo, 4), hi=round(hi, 4), signed_ic=round(signed, 4) if f.sign else np.nan,
                                       sign_ok=(np.sign(ic) == f.sign) if f.sign else None, ci_excludes_0=bool(lo > 0 or hi < 0) if boot else None,
                                       status='ok'))
    return pd.DataFrame(rows)


def main(boot: bool = True) -> None:
    h = check_prereg()
    d = Data(); panel, feats = build_panel(d)
    targets = {'cm': pd.DataFrame({hh: forward_log_return(d.close('btc', 'cm'), hh) for hh in HORIZONS}),
               'okx': pd.DataFrame({hh: forward_log_return(d.close('btc', 'okx'), hh) for hh in HORIZONS})}
    out = ROOT / 'evaluation'; out.mkdir(exist_ok=True)
    panel.to_pickle(ROOT / 'data/panel.pkl')
    ic = ic_table(panel, feats, targets, boot)
    ic.to_csv(out / 'ic_individual.csv', index=False)
    # ranking on development only, worst valid slice, primary horizon per system
    rk = []
    for f in feats:
        if f.sign == 0:
            continue
        pk = 'okx' if f.system == 'tactical' else 'cm'   # amendment (attempt 3): REGIME confirmation on the long CM-priced window; OKX-priced window reported alongside
        sub = ic[(ic.fid == f.fid) & (ic.window == 'dev') & (ic.horizon == PRIMARY[f.system]) & (ic.status == 'ok') & (ic.price == pk)]
        if sub.empty:
            rk.append(dict(fid=f.fid, name=f.name, system=f.system, horizon=PRIMARY[f.system], worst_slice=None, worst_signed_ic=np.nan, all_sign_ok=False, full_ci_excl0=False, status='insufficient')); continue
        w = sub.loc[sub.signed_ic.idxmin()]
        full = sub[sub.slice == 'full'].iloc[0]
        rk.append(dict(fid=f.fid, name=f.name, system=f.system, horizon=PRIMARY[f.system], price=pk, worst_slice=w.slice, worst_signed_ic=w.signed_ic, all_sign_ok=bool(sub.sign_ok.all()),
                       full_ic=full.ic, full_lo=full.lo, full_hi=full.hi, full_ci_excl0=bool(full.ci_excludes_0), n_full=int(full.n),
                       status='confirmed_dev' if (sub.sign_ok.all() and full.ci_excludes_0) else 'not_confirmed'))
    rank = pd.DataFrame(rk).sort_values(['system', 'worst_signed_ic'], ascending=[True, False])
    rank.to_csv(out / 'ic_ranking_dev.csv', index=False)
    # clustering on development window only (causal percentile ranks)
    dev = panel[panel.index <= DEV_END]
    ranks = pd.DataFrame({f.fid: expanding_pct(dev[f.fid].dropna()).reindex(dev.index) for f in feats if f.sign != 0})
    corr = ranks.corr(method='spearman', min_periods=365)
    corr.to_csv(out / 'corr_dev.csv')
    fam = []; seen = set()
    for a in corr.index:
        for b in corr.columns:
            if a < b and abs(corr.loc[a, b]) > 0.8:
                fam.append(dict(a=a, b=b, rho=round(corr.loc[a, b], 3)))
    pd.DataFrame(fam).to_csv(out / 'clusters_dev.csv', index=False)
    n = log_experiment('individual_ic', dict(features=len(feats), horizons=HORIZONS, prereg_hash=h, rows=len(ic), confirmed_dev=int((rank.status == 'confirmed_dev').sum())))
    print(rank.to_string()); print('experiment attempt', n)


if __name__ == '__main__':
    main(boot='--noboot' not in sys.argv)
