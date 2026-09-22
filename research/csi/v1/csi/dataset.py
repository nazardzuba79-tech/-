"""Point-in-time information set builder.

`series` rows stay untouched (no fill). This module builds a *decision panel*: for each
decision day D (close of D, i.e. 00:00 UTC of D+1) the last value whose available_at <= D.
Carrying the last *known* value forward is an information-set operation, not interpolation
of the source series; a `max_stale` bound stops dead series (e.g. ETH HashRate after the Merge)
from being carried indefinitely.
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]


def load_series(db_path: Path | None = None) -> pd.DataFrame:
    db = sqlite3.connect(db_path or ROOT / 'data/csi.db')
    df = pd.read_sql_query('SELECT source, metric, asset, date, available_at, value FROM series', db)
    df['date'] = pd.to_datetime(df['date']); df['available_at'] = pd.to_datetime(df['available_at'])
    return df


class Data:
    def __init__(self, df: pd.DataFrame | None = None):
        self.df = df if df is not None else load_series()
        self.calendar = pd.date_range(self.df['date'].min(), self.df['date'].max(), freq='D')

    def raw(self, source: str, metric: str, asset: str = '') -> pd.Series:
        """Series indexed by observation date (native frequency, no fill)."""
        m = self.df[(self.df.source == source) & (self.df.metric == metric) & (self.df.asset == asset)]
        s = m.set_index('date')['value'].sort_index()
        s.name = f'{source}:{metric}:{asset}'
        return s

    def lag_of(self, source: str, metric: str, asset: str = '') -> int:
        m = self.df[(self.df.source == source) & (self.df.metric == metric) & (self.df.asset == asset)]
        if m.empty:
            return 0
        return int((m['available_at'] - m['date']).dt.days.min())

    def known(self, s: pd.Series, lag: int, max_stale: int = 7) -> pd.Series:
        """Align a date-indexed series (or a feature computed from it) to decision days.
        value for date d becomes known on d+lag; carried forward at most `max_stale` days."""
        k = s.dropna().copy()
        k.index = k.index + pd.Timedelta(days=lag)
        k = k[~k.index.duplicated(keep='last')]
        return k.reindex(self.calendar).ffill(limit=max_stale)

    def close(self, asset: str = 'btc', venue: str = 'auto') -> pd.Series:
        """Executable/reference close used for targets. 'okx' = OKX spot (lag 0, 2018+),
        'cm' = Coin Metrics PriceUSD (reference rate, 2010+). Never spliced."""
        if venue == 'okx':
            return self.raw('okx', 'spot_close', asset + 'usdt')
        return self.raw('coinmetrics', 'PriceUSD', asset)


def forward_log_return(close: pd.Series, h: int) -> pd.Series:
    """log(P[t+h]/P[t]) on the close's own calendar (daily). Requires a full daily index."""
    c = close.reindex(pd.date_range(close.index.min(), close.index.max(), freq='D'))
    return np.log(c.shift(-h) / c)
