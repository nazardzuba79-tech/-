"""v3 backtest mechanics (fixes three v1/v2 defects, see docs/AUDIT_v3_UA.md):
1. exposure = causal percentile of the FAVOURABLE-oriented score for every system (CYCLE was inverted in v1/v2);
2. the percentile uses the score's full causal history; the evaluation window is cut afterwards (v1/v2 holdout started 2024-01-30);
3. simple returns: r_strat = e * (P[t+1]/P[t] - 1) - cost * |delta e|  (v1/v2 used e * log-return).
Position is set at the close of day D with information available at D and earns the close-to-close return D -> D+1.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from .v3util import expanding_pct_fast

COST = 0.0015   # per side: 0.10% fee + 0.05% slippage (assumption, not measured)


def exposure(score: pd.Series, rebal: int = 1, smooth_k: int = 1, min_periods: int = 365) -> pd.Series:
    pct = expanding_pct_fast(score, min_periods)
    if pct.empty:
        return pct
    cal = pd.date_range(pct.index.min(), pct.index.max(), freq='D')
    e = pct.reindex(cal)
    if smooth_k > 1:
        e = e.rolling(smooth_k, min_periods=smooth_k).mean()
    if rebal > 1:
        keep = (np.arange(len(e)) % rebal) == 0
        e = e.where(keep).ffill(limit=rebal - 1)
    return e


def trend_exposure(close: pd.Series, n: int = 200) -> pd.Series:
    c = close.reindex(pd.date_range(close.index.min(), close.index.max(), freq='D'))
    sma = c.rolling(n, min_periods=n).mean()
    return (c > sma).astype(float).where(sma.notna() & c.notna())


def run(expo: pd.Series, close: pd.Series, start=None, end=None, cost: float = COST) -> tuple[pd.DataFrame, dict]:
    c = close.reindex(pd.date_range(close.index.min(), close.index.max(), freq='D'))
    ret = c.shift(-1) / c - 1
    df = pd.DataFrame({'ret': ret, 'expo': expo.reindex(c.index)}).dropna()
    if start is not None:
        df = df[df.index >= pd.Timestamp(start)]
    if end is not None:
        df = df[df.index <= pd.Timestamp(end)]
    if df.empty:
        return df, {}
    df['turnover'] = df['expo'].diff().abs().fillna(df['expo'].abs())
    df['strat'] = df['expo'] * df['ret'] - cost * df['turnover']
    return df, stats(df)


def metrics(r: pd.Series) -> dict:
    r = r.dropna()
    if len(r) < 30:
        return {}
    eq = (1 + r).cumprod(); yrs = len(r) / 365.25
    sd = r.std()
    return dict(cagr=round(float(eq.iloc[-1] ** (1 / yrs) - 1), 4), vol=round(float(sd * np.sqrt(365)), 4),
                sharpe=round(float(r.mean() / sd * np.sqrt(365)), 3) if sd > 0 else None,
                max_drawdown=round(float((eq / eq.cummax() - 1).min()), 4), total_return=round(float(eq.iloc[-1] - 1), 4))


def stats(df: pd.DataFrame) -> dict:
    yrs = len(df) / 365.25; e = float(df['expo'].mean())
    return dict(start=str(df.index.min().date()), end=str(df.index.max().date()), days=len(df), years=round(yrs, 2),
                avg_exposure=round(e, 3), turnover_per_year=round(float(df['turnover'].sum() / yrs), 2),
                cost_drag_per_year=round(float((df['expo'] * df['ret'] - df['strat']).sum() / yrs), 4),
                strategy=metrics(df['strat']), buy_and_hold=metrics(df['ret']), bh_same_avg_exposure=metrics(df['ret'] * e))
