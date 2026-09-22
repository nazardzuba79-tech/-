"""v2 feature registry = v1 registry + derivatives/positioning/venue-premium features from the free sources found after v1.

Signs pre-registered BEFORE any v2 IC is computed (docs/PREREGISTRATION_v2.md records this file's sha256).
v1 features keep their ids and signs; tactical price features are re-declared on the Binance archive spot close
(the canonical executable price), which changes only the price series, not the definition.
"""
from __future__ import annotations
import numpy as np, pandas as pd
from .dataset import Data
from .features import Feature, registry as registry_v1, roll_z, rsi, _pctb, CM_LAG, LLAMA_LAG, FRED_LAG

BV_LAG = 0


def registry() -> list[Feature]:
    v1 = registry_v1()
    keep = [f for f in v1 if f.system in ('cycle', 'regime') or f.fid in ('M096t', 'C002')]
    bv = lambda m, a='btcusdt': (lambda d: d.raw('binance_vision', m, a))
    cm = lambda m, a='btc': (lambda d: d.raw('coinmetrics', m, a))
    F: list[Feature] = list(keep)
    # ---- tactical price features on the Binance archive spot close (same definitions as v1 M017/M040/N005/N006/M018/M021/M044)
    F += [
        Feature('M017', 'RSI 14', 'tactical', -1, 'btc', lambda d: rsi(bv('spot_close')(d), 14), BV_LAG),
        Feature('M040', 'Bollinger %B 20', 'tactical', -1, 'btc', lambda d: _pctb(bv('spot_close')(d), 20), BV_LAG),
        Feature('N005', '5d return z (60d)', 'tactical', -1, 'btc', lambda d: roll_z(np.log(bv('spot_close')(d)).diff(5), 60), BV_LAG),
        Feature('N006', 'SMA20 distance', 'tactical', -1, 'btc', lambda d: bv('spot_close')(d) / bv('spot_close')(d).rolling(20).mean() - 1, BV_LAG),
        Feature('M018', 'Stochastic %K 14', 'tactical', -1, 'btc', lambda d: _stoch_bv(d, 14), BV_LAG),
        Feature('M021', 'CCI 20', 'tactical', -1, 'btc', lambda d: _cci_bv(d, 20), BV_LAG),
        Feature('M044', 'Drawdown from 90d high', 'tactical', +1, 'btc', lambda d: bv('spot_close')(d) / bv('spot_high')(d).rolling(90).max() - 1, BV_LAG),
        Feature('M068', 'Perp-spot basis (Binance archive)', 'tactical', -1, 'btc', bv('perp_spot_basis'), BV_LAG),
        Feature('C001', 'Trend control: price above SMA200 (Binance archive)', 'control', 0, 'btc', lambda d: (bv('spot_close')(d) > bv('spot_close')(d).rolling(200).mean()).astype(float), BV_LAG),
        # ---- positioning (new)
        Feature('T101', 'Funding 7d mean (Binance archive)', 'tactical', -1, 'btc', lambda d: bv('funding_rate_daily')(d).rolling(7).mean(), BV_LAG, note='crowded-long hypothesis'),
        Feature('T102', 'Funding 7d mean (BitMEX XBTUSD)', 'tactical', -1, 'btc', lambda d: d.raw('bitmex', 'funding_rate_daily', 'xbtusd').rolling(7).mean(), 0, note='inverse contract, 2016+'),
        Feature('T113', 'Funding 7d mean (Deribit)', 'tactical', -1, 'btc', lambda d: d.raw('deribit', 'funding_rate_daily', 'btc-perpetual').rolling(7).mean(), 0),
        Feature('T103', 'OI contracts 7d change (Binance archive)', 'tactical', -1, 'btc', lambda d: np.log(bv('open_interest')(d)).diff(7), BV_LAG, note='price-neutral: contract units'),
        Feature('T104', 'OI USD / market cap (Binance archive)', 'tactical', -1, 'btc', lambda d: (bv('open_interest_usd')(d) / cm('CapMrktCurUSD')(d).reindex(bv('open_interest_usd')(d).index)), 1, note='mcap has lag 1 => feature lag 1'),
        Feature('T105', 'Taker buy/sell ratio 7d mean', 'tactical', -1, 'btc', lambda d: bv('taker_buy_sell_ratio')(d).rolling(7).mean(), BV_LAG),
        Feature('T106', 'Global long/short account ratio', 'tactical', -1, 'btc', bv('long_short_ratio'), BV_LAG),
        Feature('T107', 'Top-trader position long/short ratio', 'tactical', +1, 'btc', bv('toptrader_ls_position_ratio'), BV_LAG, note='informed-trader hypothesis'),
        Feature('T108', 'DVOL level', 'tactical', +1, 'btc', lambda d: d.raw('deribit', 'dvol_close', 'btc'), 0, note='high implied vol = risk premium hypothesis'),
        Feature('T109', 'DVOL 7d change', 'tactical', -1, 'btc', lambda d: d.raw('deribit', 'dvol_close', 'btc').diff(7), 0),
        Feature('T110', 'Coinbase premium 3d mean', 'tactical', +1, 'btc', lambda d: _coinbase_premium(d).rolling(3).mean(), 0, note='Coinbase BTC-USD / Bitstamp btcusd - 1'),
        Feature('T111', 'Kimchi premium 3d mean', 'tactical', -1, 'btc', lambda d: _kimchi(d).rolling(3).mean(), 1, note='Upbit KRW-BTC / DEXKOUS / Coinbase - 1; DEXKOUS lag 1'),
        Feature('T112', 'Bitfinex OI 7d change', 'tactical', -1, 'btc', lambda d: np.log(d.raw('bitfinex', 'open_interest', 'btcf0ustf0')).diff(7), 0),
        # ---- regime (new)
        Feature('R101', 'Funding 30d mean (BitMEX XBTUSD)', 'regime', -1, 'btc', lambda d: d.raw('bitmex', 'funding_rate_daily', 'xbtusd').rolling(30).mean(), 0),
        Feature('R102', 'OI USD / market cap 30d mean', 'regime', -1, 'btc', lambda d: (bv('open_interest_usd')(d) / cm('CapMrktCurUSD')(d).reindex(bv('open_interest_usd')(d).index)).rolling(30).mean(), 1),
        Feature('R103', 'OI contracts 30d change', 'regime', -1, 'btc', lambda d: np.log(bv('open_interest')(d)).diff(30), BV_LAG),
        Feature('R104', 'DVOL level (regime)', 'regime', +1, 'btc', lambda d: d.raw('deribit', 'dvol_close', 'btc'), 0),
        Feature('R105', 'Coinbase premium 30d mean', 'regime', +1, 'btc', lambda d: _coinbase_premium(d).rolling(30).mean(), 0),
        Feature('R106', 'Kimchi premium 30d mean', 'regime', -1, 'btc', lambda d: _kimchi(d).rolling(30).mean(), 1),
        Feature('R107', 'NVT (mcap / 90d mean est. tx volume USD)', 'regime', -1, 'btc', lambda d: _nvt(d), 1, note='blockchain.info estimated-transaction-volume-usd, NOT TxTfrValAdjUSD'),
        Feature('R108', 'Unique addresses 30d growth', 'regime', +1, 'btc', lambda d: np.log(d.raw('blockchain_info', 'unique_addresses_used', 'btc').rolling(7).mean()).diff(30), 1),
        Feature('R109', 'Bitfinex OI 30d change', 'regime', -1, 'btc', lambda d: np.log(d.raw('bitfinex', 'open_interest', 'btcf0ustf0')).diff(30), 0),
        # ---- cycle (new)
        Feature('C101', 'NVT z (365d) of mcap / 90d tx volume', 'cycle', -1, 'btc', lambda d: roll_z(np.log(_nvt(d)), 365), 1),
        Feature('C102', 'Funding 90d mean (BitMEX XBTUSD)', 'cycle', -1, 'btc', lambda d: d.raw('bitmex', 'funding_rate_daily', 'xbtusd').rolling(90).mean(), 0),
    ]
    return F


def _stoch_bv(d: Data, n: int) -> pd.Series:
    c = d.raw('binance_vision', 'spot_close', 'btcusdt'); h = d.raw('binance_vision', 'spot_high', 'btcusdt'); l = d.raw('binance_vision', 'spot_low', 'btcusdt')
    return 100 * (c - l.rolling(n).min()) / (h.rolling(n).max() - l.rolling(n).min())


def _cci_bv(d: Data, n: int) -> pd.Series:
    c = d.raw('binance_vision', 'spot_close', 'btcusdt'); h = d.raw('binance_vision', 'spot_high', 'btcusdt'); l = d.raw('binance_vision', 'spot_low', 'btcusdt')
    tp = (h + l + c) / 3; ma = tp.rolling(n).mean(); md = (tp - ma).abs().rolling(n).mean()
    return (tp - ma) / (0.015 * md)


def _coinbase_premium(d: Data) -> pd.Series:
    cb = d.raw('coinbase', 'spot_close', 'btcusd'); bs = d.raw('bitstamp', 'spot_close', 'btcusd')
    return (cb / bs.reindex(cb.index) - 1).dropna()


def _kimchi(d: Data) -> pd.Series:
    up = d.raw('upbit', 'spot_close', 'krw-btc'); fx = d.raw('fred', 'DEXKOUS').reindex(up.index, method='ffill', limit=5); cb = d.raw('coinbase', 'spot_close', 'btcusd').reindex(up.index)
    return (up / fx / cb - 1).dropna()


def _nvt(d: Data) -> pd.Series:
    mc = d.raw('coinmetrics', 'CapMrktCurUSD', 'btc'); tv = d.raw('blockchain_info', 'tx_volume_usd_est', 'btc').reindex(mc.index)
    return (mc / tv.rolling(90, min_periods=60).mean()).dropna()
