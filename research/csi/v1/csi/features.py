"""Candidate feature registry with PRE-REGISTERED directions.

Every feature is causal (uses only data up to its own date) and is later aligned to
decision days with the source lag. `sign` is the hypothesised direction of the Spearman IC
(+1: higher value -> higher forward return). It is fixed BEFORE any IC is computed
(see docs/PREREGISTRATION.md, which records this file's sha256). Signs are never flipped
after seeing results; a wrong sign is a negative result.

Normalisations are causal only: expanding/rolling windows, min_periods enforced.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable
import numpy as np
import pandas as pd
from .dataset import Data

CM_LAG, OKX_LAG, LLAMA_LAG, FRED_LAG = 1, 0, 1, 1


@dataclass
class Feature:
    fid: str                 # catalogue id or new id (N###) for definitions not in the catalogue
    name: str
    system: str              # cycle | regime | tactical | control
    sign: int                # +1 / -1 pre-registered; 0 = unsigned (evaluated, never composited)
    asset: str               # btc | eth | '' (macro)
    build: Callable[[Data], pd.Series]
    lag: int
    max_stale: int = 7
    note: str = ''
    min_history_days: int = 0


def expanding_pct(s: pd.Series, min_periods: int = 365) -> pd.Series:
    """Causal percentile rank of the current value within its own history."""
    def _rank(a):
        return (a[:-1] < a[-1]).mean() if len(a) > 1 else np.nan
    return s.expanding(min_periods=min_periods).apply(_rank, raw=True)


def roll_z(s: pd.Series, w: int) -> pd.Series:
    return (s - s.rolling(w, min_periods=w // 2).mean()) / s.rolling(w, min_periods=w // 2).std()


def rsi(c: pd.Series, n: int = 14) -> pd.Series:
    d = c.diff(); up = d.clip(lower=0); dn = -d.clip(upper=0)
    ru = up.ewm(alpha=1 / n, min_periods=n).mean(); rd = dn.ewm(alpha=1 / n, min_periods=n).mean()
    return 100 - 100 / (1 + ru / rd)


def registry() -> list[Feature]:
    F: list[Feature] = []
    cm = lambda m, a='btc': (lambda d: d.raw('coinmetrics', m, a))
    okx = lambda m, a='btcusdt': (lambda d: d.raw('okx', m, a))

    # ------------------------------------------------------------------ CYCLE (valuation, long horizon)
    F += [
        Feature('O003', 'MVRV', 'cycle', -1, 'btc', cm('CapMVRVCur'), CM_LAG, note='Coin Metrics CapMVRVCur as delivered'),
        Feature('O004', 'MVRV Z causal', 'cycle', -1, 'btc', lambda d: _mvrv_z(d), CM_LAG,
                note='(mcap - realized_cap)/expanding_std(mcap); realized_cap = CapMrktCurUSD/CapMVRVCur (derived, CapRealUSD not in Community)'),
        Feature('M057', 'Mayer Multiple', 'cycle', -1, 'btc', lambda d: _price(d) / _price(d).rolling(200, min_periods=200).mean(), CM_LAG),
        Feature('M059', '200W MA distance', 'cycle', -1, 'btc', lambda d: _price(d) / _price(d).rolling(1400, min_periods=1400).mean() - 1, CM_LAG),
        Feature('M058', '2Y MA multiplier', 'cycle', -1, 'btc', lambda d: _price(d) / _price(d).rolling(730, min_periods=730).mean(), CM_LAG),
        Feature('O072', 'Puell Multiple', 'cycle', -1, 'btc', lambda d: cm('IssTotUSD')(d) / cm('IssTotUSD')(d).rolling(365, min_periods=365).mean(), CM_LAG),
        Feature('O013', 'Mcap / thermocap', 'cycle', -1, 'btc', lambda d: cm('CapMrktCurUSD')(d) / cm('IssTotUSD')(d).cumsum(), CM_LAG,
                note='thermocap = cumulative IssTotUSD from first CM day (2010-07-18); pre-2010 issuance USD not available => level biased, ranks usable'),
        Feature('O011', 'Realized cap 90d change', 'cycle', +1, 'btc', lambda d: _realized_cap(d).pct_change(90), CM_LAG, note='flow hypothesis: rising cost basis = new capital'),
        Feature('M065', 'Four-year return', 'cycle', -1, 'btc', lambda d: np.log(_price(d) / _price(d).shift(1461)), CM_LAG),
        Feature('M066', 'Log power-law residual', 'cycle', -1, 'btc', lambda d: _powerlaw_residual(d), CM_LAG, note='expanding OLS of log price on log(days since 2009-01-03); residual'),
        Feature('N001', 'ROI 1y (CM)', 'cycle', -1, 'btc', cm('ROI1yr'), CM_LAG, note='1y momentum; pre-registered as mean-reverting at 365d horizon'),
        Feature('O067', 'Hash ribbons', 'cycle', +1, 'btc', lambda d: cm('HashRate')(d).rolling(30).mean() / cm('HashRate')(d).rolling(60).mean() - 1, CM_LAG),
        Feature('O059', 'Fee share of issuance+fees', 'cycle', -1, 'btc', lambda d: cm('FeeTotNtv')(d).rolling(30).sum() / (cm('FeeTotNtv')(d).rolling(30).sum() + cm('IssTotNtv')(d).rolling(30).sum()), CM_LAG),
        Feature('O081', 'Exchange supply ratio', 'cycle', -1, 'btc', lambda d: cm('SplyExNtv')(d) / cm('SplyCur')(d), CM_LAG, note='label coverage incomplete per provider'),
        Feature('N002', 'Mcap per active address (log, z 365)', 'cycle', -1, 'btc', lambda d: roll_z(np.log(cm('CapMrktCurUSD')(d) / cm('AdrActCnt')(d).rolling(30).mean()), 365), CM_LAG),
        Feature('M064', 'Days since halving', 'cycle', 0, 'btc', lambda d: _halving_age(d), CM_LAG, note='unsigned: non-monotone by construction; evaluated, never composited'),
    ]
    # ------------------------------------------------------------------ REGIME (weeks-months)
    F += [
        Feature('O102', 'Stablecoin mcap 30d change', 'regime', +1, '', lambda d: d.raw('defillama', 'stablecoin_mcap').pct_change(30), LLAMA_LAG, note='supply change, NOT net inflow'),
        Feature('O103', 'Stablecoin supply ratio', 'regime', -1, '', lambda d: _ssr(d), LLAMA_LAG, note='BTC mcap / stablecoin mcap; higher = less dry powder'),
        Feature('O079', 'Exchange netflow 30d / exch supply', 'regime', -1, 'btc', lambda d: (cm('FlowInExNtv')(d) - cm('FlowOutExNtv')(d)).rolling(30).sum() / cm('SplyExNtv')(d), CM_LAG),
        Feature('O080', 'Exchange balance 30d change', 'regime', -1, 'btc', lambda d: cm('SplyExNtv')(d).pct_change(30), CM_LAG),
        Feature('M115', 'Net liquidity heuristic 13w change', 'regime', +1, '', lambda d: _net_liquidity(d).pct_change(13), 8, max_stale=45,
                note='WALCL - WTREGEN - RRPONTSYD*1000 (all in USD millions); weekly; heuristic, not an official flow'),
        Feature('M106', 'Broad dollar 30d change', 'regime', -1, '', lambda d: d.raw('fred', 'DTWEXBGS').pct_change(21), FRED_LAG, max_stale=10, note='DTWEXBGS is NOT ICE DXY'),
        Feature('M107', 'Real 10y yield 30d change', 'regime', -1, '', lambda d: d.raw('fred', 'DFII10').diff(21), FRED_LAG, max_stale=10),
        Feature('M109', 'VIX level', 'regime', -1, '', lambda d: d.raw('fred', 'VIXCLS'), FRED_LAG, max_stale=10),
        Feature('M110', 'S&P 500 30d return', 'regime', +1, '', lambda d: np.log(d.raw('fred', 'SP500')).diff(21), FRED_LAG, max_stale=10, note='FRED SP500 only last 10y'),
        Feature('M108', 'HY OAS 30d change', 'regime', -1, '', lambda d: d.raw('fred', 'BAMLH0A0HYM2').diff(21), FRED_LAG, max_stale=10, note='FRED delivers ~3y only'),
        Feature('M105', 'M2 yoy', 'regime', +1, '', lambda d: d.raw('fred', 'M2SL').pct_change(12), 30, max_stale=60, note='monthly, lag 30'),
        Feature('M001', 'SMA200 distance', 'regime', +1, 'btc', lambda d: _price(d) / _price(d).rolling(200).mean() - 1, CM_LAG, note='trend persistence hypothesis at 30-90d'),
        Feature('M015', 'TS momentum 90d', 'regime', +1, 'btc', lambda d: np.log(_price(d) / _price(d).shift(90)), CM_LAG),
        Feature('N003', 'Realized vol 30d', 'regime', -1, 'btc', lambda d: np.log(_price(d)).diff().rolling(30).std() * np.sqrt(365), CM_LAG),
        Feature('O046', 'Active addresses 30d growth', 'regime', +1, 'btc', lambda d: np.log(cm('AdrActCnt')(d).rolling(7).mean()).diff(30), CM_LAG),
        Feature('O049', 'Tx count 30d growth', 'regime', +1, 'btc', lambda d: np.log(cm('TxCnt')(d).rolling(7).mean()).diff(30), CM_LAG),
        Feature('O113', 'TVL 30d change', 'regime', +1, '', lambda d: d.raw('defillama', 'total_tvl').pct_change(30), LLAMA_LAG, note='includes price revaluation; not inflow'),
        Feature('O115', 'DEX volume 30d change', 'regime', +1, '', lambda d: np.log(d.raw('defillama', 'dex_volume_usd').rolling(7).mean().replace(0, np.nan)).diff(30), LLAMA_LAG),
        Feature('M096', 'Fear & Greed level', 'regime', -1, '', lambda d: d.raw('alternative_me', 'fng'), 0, note='contrarian; index itself contains price momentum'),
        Feature('M088', 'ETH/BTC 30d change', 'regime', +1, '', lambda d: np.log(cm('PriceBTC', 'eth')(d)).diff(30), CM_LAG, note='risk-appetite proxy'),
        Feature('O066', 'Hash rate 30d growth', 'regime', +1, 'btc', lambda d: np.log(cm('HashRate')(d).rolling(7).mean()).diff(30), CM_LAG),
        Feature('N004', 'Spot volume USD 30d change (CM reported)', 'regime', +1, 'btc', lambda d: np.log(cm('volume_reported_spot_usd_1d')(d).rolling(7).mean()).diff(30), CM_LAG),
        Feature('M117', 'US spot ETF net flow 30d sum (US$m)', 'regime', +1, 'btc', lambda d: d.raw('farside', 'etf_flow_musd', 'btc').rolling(30, min_periods=15).sum(), 1, max_stale=5, note='2024-01-11+ only: entirely inside holdout => no development evidence possible'),
    ]
    # ------------------------------------------------------------------ TACTICAL (days-weeks; contrarian thesis)
    F += [
        Feature('M017', 'RSI 14', 'tactical', -1, 'btc', lambda d: rsi(okx('spot_close')(d), 14), OKX_LAG),
        Feature('M040', 'Bollinger %B 20', 'tactical', -1, 'btc', lambda d: _pctb(okx('spot_close')(d), 20), OKX_LAG),
        Feature('N005', '5d return z (60d)', 'tactical', -1, 'btc', lambda d: roll_z(np.log(okx('spot_close')(d)).diff(5), 60), OKX_LAG),
        Feature('N006', 'SMA20 distance', 'tactical', -1, 'btc', lambda d: okx('spot_close')(d) / okx('spot_close')(d).rolling(20).mean() - 1, OKX_LAG),
        Feature('M018', 'Stochastic %K 14', 'tactical', -1, 'btc', lambda d: _stoch(d, 14), OKX_LAG),
        Feature('M021', 'CCI 20', 'tactical', -1, 'btc', lambda d: _cci(d, 20), OKX_LAG),
        Feature('M044', 'Drawdown from 90d high', 'tactical', +1, 'btc', lambda d: okx('spot_close')(d) / okx('spot_high')(d).rolling(90).max() - 1, OKX_LAG, note='deeper drawdown -> bounce hypothesis; sign +'),
        Feature('M096t', 'Fear & Greed level (tactical)', 'tactical', -1, '', lambda d: d.raw('alternative_me', 'fng'), 0),
        Feature('M068', 'Perp-spot basis (OKX)', 'tactical', -1, 'btc', lambda d: okx('perp_close')(d) / okx('spot_close')(d) - 1, OKX_LAG, note='2020+; crowded-long hypothesis'),
        Feature('M053', 'Relative volume 20', 'tactical', 0, 'btc', lambda d: okx('spot_volume')(d) / okx('spot_volume')(d).rolling(20).mean(), OKX_LAG, note='unsigned'),
        Feature('M067', 'Funding daily sum (OKX)', 'tactical', -1, 'btc', okx('funding_rate_daily'), OKX_LAG, note='ONLY ~97 days of history: insufficient evidence by construction'),
        Feature('N007', 'OKX long/short account ratio', 'tactical', -1, 'btc', lambda d: d.raw('okx', 'okx_long_short_account_ratio', 'btc'), 1, note='180 days only'),
        Feature('N008', 'OKX taker buy/sell ratio', 'tactical', -1, 'btc', lambda d: d.raw('okx', 'okx_taker_buy_usd', 'btc') / d.raw('okx', 'okx_taker_sell_usd', 'btc'), 1, note='72 days only'),
        Feature('M032', 'Return autocorr 60d (lag1)', 'tactical', 0, 'btc', lambda d: np.log(okx('spot_close')(d)).diff().rolling(60).apply(lambda a: pd.Series(a).autocorr(1), raw=True), OKX_LAG, note='unsigned'),
    ]
    # ------------------------------------------------------------------ CONTROLS (used for conditioning / baselines, never as votes)
    F += [
        Feature('C001', 'Trend control: price above SMA200 (OKX)', 'control', 0, 'btc', lambda d: (okx('spot_close')(d) > okx('spot_close')(d).rolling(200).mean()).astype(float), OKX_LAG),
        Feature('C002', 'Trend control: price above SMA200 (CM)', 'control', 0, 'btc', lambda d: (_price(d) > _price(d).rolling(200).mean()).astype(float), CM_LAG),
    ]
    return F


# ----------------------------------------------------------------------- helpers
def _price(d: Data) -> pd.Series:
    return d.raw('coinmetrics', 'PriceUSD', 'btc')


def _realized_cap(d: Data) -> pd.Series:
    return d.raw('coinmetrics', 'CapMrktCurUSD', 'btc') / d.raw('coinmetrics', 'CapMVRVCur', 'btc')


def _mvrv_z(d: Data) -> pd.Series:
    mc = d.raw('coinmetrics', 'CapMrktCurUSD', 'btc')
    return (mc - _realized_cap(d)) / mc.expanding(min_periods=365).std()


def _powerlaw_residual(d: Data) -> pd.Series:
    p = np.log(_price(d)); x = np.log((p.index - pd.Timestamp('2009-01-03')).days.values.astype(float))
    y = p.values; out = np.full(len(y), np.nan)
    sx = sy = sxx = sxy = 0.0; n = 0
    for i in range(len(y)):
        if not np.isnan(y[i]):
            n += 1; sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]
            if n >= 730:
                b = (n * sxy - sx * sy) / (n * sxx - sx * sx); a = (sy - b * sx) / n
                out[i] = y[i] - (a + b * x[i])
    return pd.Series(out, index=p.index)


def _halving_age(d: Data) -> pd.Series:
    idx = _price(d).index
    halvings = pd.to_datetime(['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'])
    out = pd.Series(np.nan, index=idx)
    for h in halvings:
        m = idx >= h
        out[m] = (idx[m] - h).days
    return out


def _ssr(d: Data) -> pd.Series:
    mc = d.raw('coinmetrics', 'CapMrktCurUSD', 'btc'); st = d.raw('defillama', 'stablecoin_mcap')
    return (mc / st.reindex(mc.index)).dropna()


def _net_liquidity(d: Data) -> pd.Series:
    w = d.raw('fred', 'WALCL'); t = d.raw('fred', 'WTREGEN'); r = d.raw('fred', 'RRPONTSYD')
    r_w = r.reindex(w.index, method='ffill')  # RRP is daily (billions): take the value on the Wednesday of WALCL; contractual lag of the composite = 8
    return (w - t - r_w * 1000.0).dropna()


def _pctb(c: pd.Series, n: int) -> pd.Series:
    m = c.rolling(n).mean(); s = c.rolling(n).std()
    return (c - (m - 2 * s)) / (4 * s)


def _stoch(d: Data, n: int) -> pd.Series:
    c = d.raw('okx', 'spot_close', 'btcusdt'); h = d.raw('okx', 'spot_high', 'btcusdt'); l = d.raw('okx', 'spot_low', 'btcusdt')
    hh = h.rolling(n).max(); ll = l.rolling(n).min()
    return 100 * (c - ll) / (hh - ll)


def _cci(d: Data, n: int) -> pd.Series:
    c = d.raw('okx', 'spot_close', 'btcusdt'); h = d.raw('okx', 'spot_high', 'btcusdt'); l = d.raw('okx', 'spot_low', 'btcusdt')
    tp = (h + l + c) / 3; ma = tp.rolling(n).mean(); md = (tp - ma).abs().rolling(n).mean()
    return (tp - ma) / (0.015 * md)


def build_panel(d: Data, feats: list[Feature] | None = None) -> tuple[pd.DataFrame, list[Feature]]:
    feats = feats or registry(); cols = {}
    for f in feats:
        try:
            s = f.build(d)
            cols[f.fid] = d.known(s, f.lag, f.max_stale)
        except Exception as exc:  # a feature that cannot be built is recorded, not silently dropped
            print(f'FEATURE_BUILD_FAIL {f.fid} {f.name}: {exc!r}')
            cols[f.fid] = pd.Series(np.nan, index=d.calendar)
    return pd.DataFrame(cols), feats
