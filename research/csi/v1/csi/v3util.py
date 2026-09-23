"""v3 helpers (new module so that the hash-frozen registries features.py / features_v2.py stay untouched).

expanding_pct_fast  - identical semantics to features.expanding_pct (share of previous values strictly below), O(n log n)
pine_percentrank    - TradingView ta.percentrank: % of the previous `length` bars whose value is <= current (na counts as not <=)
h10_available       - Federal Reserve H.10 weekly release: an observation for Mon..Fri of week W becomes public on Monday of W+1
known_var           - align a series whose observations have individual availability dates to decision days
load_data           - Data restricted to date <= cutoff (reproducible v3 runs on the v2 database state)
"""
from __future__ import annotations
import bisect
from pathlib import Path
import numpy as np
import pandas as pd
from .dataset import Data, load_series

CUTOFF_V3 = '2026-09-21'   # last observation date of the v2 database; v3 evaluations are run on exactly this state


# Data-quality exclusions (v3 audit): values the source reports that are impossible for an active instrument.
# They are NOT deleted from csi.db; they are excluded when loading and listed in reports/dq_exclusions_v3.csv.
DQ_RULES = [
    ('binance_vision', ('open_interest', 'open_interest_usd'), 'open interest <= 0 on a listed perpetual (archive glitch; last 5-min row of the day = 0)'),
    ('bitfinex', ('open_interest',), 'open interest reported as 0 for the first weeks after listing (field not populated)'),
]


def dq_mask(df: pd.DataFrame) -> pd.Series:
    m = pd.Series(False, index=df.index)
    for source, metrics, _ in DQ_RULES:
        m |= (df['source'] == source) & df['metric'].isin(metrics) & (df['value'] <= 0)
    return m


def load_data(cutoff: str | None = CUTOFF_V3, apply_dq: bool = True, write_report: bool = True) -> Data:
    df = load_series()
    if cutoff:
        df = df[df['date'] <= pd.Timestamp(cutoff)].copy()
    if apply_dq:
        m = dq_mask(df)
        if write_report:
            rep = Path(__file__).resolve().parents[1] / 'reports' / 'dq_exclusions_v3.csv'
            out = df[m][['source', 'metric', 'asset', 'date', 'value']].copy()
            reasons = {src: why for src, _, why in DQ_RULES}
            out['reason'] = out['source'].map(reasons)
            out.to_csv(rep, index=False)
        df = df[~m].copy()
    return Data(df)


def sanitize(panel: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Non-finite derived values (log of 0, % change from 0) are missing values, never extreme ranks."""
    counts = {c: int(np.isinf(panel[c]).sum()) for c in panel.columns if np.isinf(panel[c]).sum() > 0}
    return panel.replace([np.inf, -np.inf], np.nan), counts


def expanding_pct_fast(s: pd.Series, min_periods: int = 365) -> pd.Series:
    x = s.dropna()
    out = np.full(len(x), np.nan); hist: list[float] = []
    for i, v in enumerate(x.values):
        if i > 0 and i + 1 >= min_periods:
            out[i] = bisect.bisect_left(hist, v) / i
        bisect.insort(hist, v)
    return pd.Series(out, index=x.index)


def pine_percentrank(s: pd.Series, length: int) -> pd.Series:
    v = s.to_numpy(dtype=float); n = len(v); out = np.full(n, np.nan)
    for i in range(length, n):
        if np.isnan(v[i]):
            continue
        w = v[i - length:i]
        out[i] = 100.0 * np.count_nonzero(w <= v[i]) / length   # NaN <= x is False, as in Pine
    return pd.Series(out, index=s.index)


def pine_valid_count(s: pd.Series) -> pd.Series:
    """ta.cum(na(src) ? 0 : 1)"""
    return s.notna().astype(int).cumsum()


def h10_available(dates: pd.DatetimeIndex) -> pd.DatetimeIndex:
    wd = np.asarray(dates.weekday)
    add = np.where(wd <= 4, 7 - wd, 14 - wd)   # Mon->+7 ... Fri->+3; weekend (not expected for H.10) -> Monday after next week
    return dates + pd.to_timedelta(add, unit='D')


def known_var(values: pd.Series, avail: pd.DatetimeIndex, calendar: pd.DatetimeIndex, max_stale: int) -> pd.Series:
    k = pd.Series(values.to_numpy(), index=pd.DatetimeIndex(avail))
    k = k[k.notna()]
    k = k.groupby(level=0).last()        # several observations released together: the latest observation wins
    return k.reindex(calendar).ffill(limit=max_stale)
