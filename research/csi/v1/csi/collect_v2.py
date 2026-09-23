#!/usr/bin/env python3
"""v2 collectors: additional FREE public sources found after v1 (no keys, no trials, no bypass).

binance_vision : Binance's public data archive (data.binance.vision, plain HTTPS 200 from this runtime; api.binance.com is 451).
                 Same underlying data as the spec's Binance endpoints => canonical metric names, source='binance_vision'.
bitmex         : XBTUSD/ETHUSD perpetual funding history (8h events) since 2016-05 / 2018-08. Inverse contracts: different instrument => asset 'xbtusd'/'ethusd'.
deribit        : BTC/ETH-PERPETUAL hourly funding accrual (summed per UTC day), DVOL implied-volatility index (daily OHLC) since 2021-03-24.
bitfinex       : derivatives status history (1-minute): end-of-day open interest (BTC) for tBTCF0:USTF0 since 2019-08 (slow; ~700 pages).
coinbase       : BTC-USD / ETH-USD daily candles since 2015/2016 (US venue; Coinbase premium input).
bitstamp       : btcusd / ethusd daily OHLC since 2011 / 2017.
upbit          : KRW-BTC daily candles (Kimchi premium input) + FRED DEXKOUS (KRW per USD, lag 1).
blockchain_info: estimated-transaction-volume-usd, n-unique-addresses (NEW ids, not Coin Metrics definitions).
"""
from __future__ import annotations
import argparse, csv, datetime as dt, io, json, math, time, urllib.parse, zipfile
from pathlib import Path
from .store import Store, UTC, epoch_day, number, write_merged_report
from .collect import collect_fred as _collect_fred_v1  # noqa (kept for reference)

INCREMENTAL = True   # --full re-downloads complete histories


def _start_month(s, source, metric, asset, default):
    last = s.last_date(source, metric, asset) if INCREMENTAL else None
    return last[:7] if last and last[:7] > default else default


def _start_day(s, source, metric, asset, default: dt.date, back_days: int = 0) -> dt.date:
    last = s.last_date(source, metric, asset) if INCREMENTAL else None
    return max(default, dt.date.fromisoformat(last) - dt.timedelta(days=back_days)) if last else default


ALLOW_V2 = {'data.binance.vision', 'www.bitmex.com', 'www.deribit.com', 'api-pub.bitfinex.com', 'api.exchange.coinbase.com', 'www.bitstamp.net', 'api.upbit.com'}


def _extend_allow():
    from . import store
    store.ALLOW |= ALLOW_V2


def month_iter(start: str, end_day: str):
    y, m = map(int, start.split('-')); ey, em = int(end_day[:4]), int(end_day[5:7])
    while (y, m) <= (ey, em):
        yield f'{y:04d}-{m:02d}'
        m += 1
        if m > 12:
            y += 1; m = 1


def unzip_csv(body: bytes) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = z.namelist()[0]
        return list(csv.reader(io.StringIO(z.read(name).decode('utf-8'))))


# ---------------------------------------------------------------- Binance public archive
def collect_binance_vision(s: Store, only: str | None = None) -> None:
    _extend_allow()
    base = 'https://data.binance.vision/data'
    for symbol in ('BTCUSDT', 'ETHUSDT'):
        asset = symbol.lower()
        # ---- spot daily klines (monthly zips) since 2017-08
        if only in (None, 'spot'):
            n = 0; first = None; misses = []
            try:
                for mo in month_iter(_start_month(s, 'binance_vision', 'spot_close', asset, '2017-08'), s.day):
                    try:
                        body = s.request_bytes('binance_vision', 'spot_ohlcv', asset, f'{base}/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{mo}.zip')
                    except RuntimeError as exc:
                        if 'HTTP 404' in str(exc):
                            misses.append(mo); continue
                        raise
                    for row in unzip_csv(body):
                        if not row or not row[0].isdigit():
                            continue  # header line in newer files
                        t = int(row[0]); t = t // 1000 if t > 10**14 else t   # microsecond timestamps in 2025+ files
                        o, h, l, c, v, ct, qv = float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5]), int(row[6]), float(row[7])
                        if min(o, h, l, c) <= 0 or h < max(o, c, l) or l > min(o, c, h):
                            raise ValueError('Invalid OHLC geometry')
                        d = epoch_day(t); first = first or d
                        n += s.put('binance_vision', 'spot_close', asset, d, c, 0)
                        for mname, val in (('spot_open', o), ('spot_high', h), ('spot_low', l), ('spot_volume', v), ('spot_volume_quote', qv)):
                            s.put('binance_vision', mname, asset, d, val, 0)
                    time.sleep(0.05)
                for mname in ('spot_close', 'spot_open', 'spot_high', 'spot_low', 'spot_volume', 'spot_volume_quote'):
                    s.log('binance_vision', mname, asset, 'OK', f'{n} daily bars from monthly archive zips, first {first}; months without file: {misses[:6]}{"..." if len(misses) > 6 else ""}')
            except Exception as exc:
                s.log('binance_vision', 'spot_close', asset, 'FAIL', repr(exc))
        # ---- USD-M perpetual: funding (monthly zips) and 1d klines for basis
        if only in (None, 'futures'):
            for kind, metric in (('fundingRate', 'funding_events'), ('klines', 'perp_ohlcv')):
                n = 0; first = None; misses = []; days: dict[str, list] = {}
                try:
                    for mo in month_iter(_start_month(s, 'binance_vision', 'funding_rate_daily' if kind == 'fundingRate' else 'perp_close', asset, '2019-09'), s.day):
                        url = f'{base}/futures/um/monthly/{kind}/{symbol}/{symbol}-{kind}-{mo}.zip' if kind == 'fundingRate' else f'{base}/futures/um/monthly/klines/{symbol}/1d/{symbol}-1d-{mo}.zip'
                        try:
                            body = s.request_bytes('binance_vision', metric, asset, url)
                        except RuntimeError as exc:
                            if 'HTTP 404' in str(exc):
                                misses.append(mo); continue
                            raise
                        for row in unzip_csv(body):
                            if not row or not row[0].isdigit():
                                continue
                            t = int(row[0]); t = t // 1000 if t > 10**14 else t
                            if kind == 'fundingRate':
                                days.setdefault(epoch_day(t), []).append(float(row[2]))
                            else:
                                o, h, l, c, v = map(float, row[1:6]); d = epoch_day(t); first = first or d
                                n += s.put('binance_vision', 'perp_close', asset, d, c, 0); s.put('binance_vision', 'perp_volume', asset, d, v, 0)
                        time.sleep(0.05)
                    if kind == 'fundingRate':
                        rep = []
                        for day, vals in sorted(days.items()):
                            n += s.put('binance_vision', 'funding_rate_daily', asset, day, math.fsum(vals), 0)
                            rep.append([day, len(vals), math.fsum(vals), 'NOT_PROVEN_FROM_EVENT_COUNT_ALONE'])
                        write_merged_report(s.root / f'reports/funding_event_counts_binance_vision_{asset}.csv', ['date', 'event_count', 'sum_rates', 'completeness'], rep)
                        first = min(days) if days else None
                        s.log('binance_vision', 'funding_rate_daily', asset, 'OK' if n else 'FAIL', f'{n} days from {sum(len(v) for v in days.values())} settlement events (archive), first {first}; months without file: {misses[:6]}')
                    else:
                        cur_month_only = misses == [s.day[:7]]
                        s.log('binance_vision', 'perp_close', asset, 'OK' if (n or cur_month_only) else 'FAIL', f'{n} daily perp bars, first {first}; months without file: {misses[:6]}' + ('; current month not yet published (daily zips cover it)' if cur_month_only else ''))
                except Exception as exc:
                    s.log('binance_vision', metric, asset, 'FAIL', repr(exc))
            # derived basis
            rows = s.db.execute("SELECT p.date, p.value, q.value FROM series p JOIN series q ON p.date=q.date AND q.source='binance_vision' AND q.metric='spot_close' AND q.asset=p.asset WHERE p.source='binance_vision' AND p.metric='perp_close' AND p.asset=?", (asset,)).fetchall()
            nb = sum(s.put('binance_vision', 'perp_spot_basis', asset, d, pv / sv - 1, 0) for d, pv, sv in rows if sv)
            s.log('binance_vision', 'perp_spot_basis', asset, 'OK' if nb else 'FAIL', f'{nb} rows = perp_close/spot_close - 1 (archive daily closes)')
        # ---- daily metrics zips (5-minute rows): OI, OI value, long/short ratios, taker ratio
        if only in (None, 'metrics'):
            day = _start_day(s, 'binance_vision', 'open_interest', asset, dt.date(2020, 1, 1)) + (dt.timedelta(days=1) if INCREMENTAL and s.last_date('binance_vision', 'open_interest', asset) else dt.timedelta(0)); n = 0; first = None; misses = 0; consecutive_404 = 0
            try:
                while day.isoformat() < s.day:
                    ds = day.isoformat()
                    try:
                        body = s.request_bytes('binance_vision', 'metrics', asset, f'{base}/futures/um/daily/metrics/{symbol}/{symbol}-metrics-{ds}.zip')
                    except RuntimeError as exc:
                        if 'HTTP 404' in str(exc):
                            misses += 1; day += dt.timedelta(days=1); continue
                        raise
                    rows = [r for r in unzip_csv(body) if r and r[0] != 'create_time']
                    if not rows:
                        day += dt.timedelta(days=1); continue
                    last = rows[-1]; first = first or ds
                    taker = [float(r[7]) for r in rows if r[7] not in ('', 'null')]
                    n += s.put('binance_vision', 'open_interest', asset, ds, last[2], 0)
                    s.put('binance_vision', 'open_interest_usd', asset, ds, last[3], 0)
                    s.put('binance_vision', 'long_short_ratio', asset, ds, last[6], 0)
                    s.put('binance_vision', 'toptrader_ls_account_ratio', asset, ds, last[4], 0)
                    s.put('binance_vision', 'toptrader_ls_position_ratio', asset, ds, last[5], 0)
                    if taker:
                        s.put('binance_vision', 'taker_buy_sell_ratio', asset, ds, sum(taker) / len(taker), 0)
                    day += dt.timedelta(days=1); time.sleep(0.03)
                for m in ('open_interest', 'open_interest_usd', 'long_short_ratio', 'toptrader_ls_account_ratio', 'toptrader_ls_position_ratio', 'taker_buy_sell_ratio'):
                    s.log('binance_vision', m, asset, 'OK' if n else 'FAIL', f'{n} days from daily metrics zips, first {first}, {misses} days without file. OI/ratios = last 5-min row of the UTC day (23:55 snapshot); taker ratio = mean of 5-min sum_taker_long_short_vol_ratio (NOT the daily volume ratio)')
            except Exception as exc:
                s.log('binance_vision', 'open_interest', asset, 'FAIL', repr(exc))


# ---------------------------------------------------------------- BitMEX funding
def collect_bitmex(s: Store) -> None:
    _extend_allow()
    for symbol, asset, start in (('XBTUSD', 'xbtusd', '2016-05-01'), ('ETHUSD', 'ethusd', '2018-08-01')):
        days: dict[str, list] = {}; cursor = _start_day(s, 'bitmex', 'funding_rate_daily', asset, dt.date.fromisoformat(start)).isoformat() + 'T00:00:00.000Z'; seen = set()
        try:
            for _ in range(200):
                url = 'https://www.bitmex.com/api/v1/funding?' + urllib.parse.urlencode({'symbol': symbol, 'count': 500, 'reverse': 'false', 'startTime': cursor})
                data = s.request('bitmex', 'funding_events', asset, url)
                if not isinstance(data, list) or not data:
                    break
                new = 0
                for r in data:
                    if r.get('symbol') != symbol:
                        raise ValueError('wrong symbol')
                    if r['timestamp'] in seen:
                        continue
                    seen.add(r['timestamp']); new += 1
                    days.setdefault(r['timestamp'][:10], []).append(float(r['fundingRate']))
                if new == 0:
                    break
                cursor = data[-1]['timestamp']
                time.sleep(1.2)  # BitMEX public rate limit
            n = 0
            rep = []
            for day, vals in sorted(days.items()):
                n += s.put('bitmex', 'funding_rate_daily', asset, day, math.fsum(vals), 0)
                rep.append([day, len(vals), math.fsum(vals), 'NOT_PROVEN_FROM_EVENT_COUNT_ALONE'])
            write_merged_report(s.root / f'reports/funding_event_counts_bitmex_{asset}.csv', ['date', 'event_count', 'sum_rates', 'completeness'], rep)
            s.log('bitmex', 'funding_rate_daily', asset, 'OK', f'{n} days from {len(seen)} events, first {min(days) if days else None}; inverse contract {symbol}')
        except Exception as exc:
            s.log('bitmex', 'funding_rate_daily', asset, 'FAIL', repr(exc))


# ---------------------------------------------------------------- Deribit funding + DVOL
def collect_deribit(s: Store) -> None:
    _extend_allow()
    for inst, asset in (('BTC-PERPETUAL', 'btc-perpetual'), ('ETH-PERPETUAL', 'eth-perpetual')):
        days: dict[str, list] = {}; t0 = int(dt.datetime.combine(_start_day(s, 'deribit', 'funding_rate_daily', asset, dt.date(2019, 4, 1)), dt.time(), UTC).timestamp() * 1000); end = int(dt.datetime.now(UTC).timestamp() * 1000); seen = set()
        try:
            while t0 < end:
                t1 = min(t0 + 30 * 86400000, end)
                obj = s.request('deribit', 'funding_events', asset, f'https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name={inst}&start_timestamp={t0}&end_timestamp={t1}')
                for r in obj.get('result', []):
                    if r['timestamp'] in seen:
                        continue
                    seen.add(r['timestamp']); days.setdefault(epoch_day(r['timestamp']), []).append(float(r['interest_1h']))
                t0 = t1; time.sleep(0.25)
            n = 0
            rep = []
            for day, vals in sorted(days.items()):
                n += s.put('deribit', 'funding_rate_daily', asset, day, math.fsum(vals), 0)
                rep.append([day, len(vals), math.fsum(vals), 'HOURLY_ACCRUAL_SUM; 24 rows expected'])
            write_merged_report(s.root / f'reports/funding_event_counts_deribit_{asset}.csv', ['date', 'hourly_rows', 'sum_interest_1h', 'completeness'], rep)
            s.log('deribit', 'funding_rate_daily', asset, 'OK', f'{n} days = sum of hourly interest_1h (continuous funding, definition differs from 8h settlements), first {min(days) if days else None}')
        except Exception as exc:
            s.log('deribit', 'funding_rate_daily', asset, 'FAIL', repr(exc))
    for ccy, asset in (('BTC', 'btc'), ('ETH', 'eth')):
        try:
            t0 = int(dt.datetime.combine(_start_day(s, 'deribit', 'dvol_close', asset, dt.date(2021, 1, 1), 2), dt.time(), UTC).timestamp() * 1000); end = int(dt.datetime.now(UTC).timestamp() * 1000); n = 0; first = None
            while t0 < end:
                t1 = min(t0 + 900 * 86400000, end)
                obj = s.request('deribit', 'dvol', asset, f'https://www.deribit.com/api/v2/public/get_volatility_index_data?currency={ccy}&start_timestamp={t0}&end_timestamp={t1}&resolution=1D')
                for ts, o, h, l, c in obj['result']['data']:
                    d = epoch_day(ts); first = first or d; n += s.put('deribit', 'dvol_close', asset, d, c, 0)
                t0 = t1; time.sleep(0.25)
            s.log('deribit', 'dvol_close', asset, 'OK', f'{n} daily closes of Deribit DVOL (30-day implied volatility index, annualised %), first {first}')
        except Exception as exc:
            s.log('deribit', 'dvol_close', asset, 'FAIL', repr(exc))


# ---------------------------------------------------------------- Bitfinex derivatives status (open interest)
def collect_bitfinex(s: Store) -> None:
    _extend_allow()
    for pair, asset in (('tBTCF0:USTF0', 'btcf0ustf0'), ('tETHF0:USTF0', 'ethf0ustf0')):
        start = int(dt.datetime.combine(_start_day(s, 'bitfinex', 'open_interest', asset, dt.date(2019, 8, 1)), dt.time(), UTC).timestamp() * 1000); end = int(dt.datetime.now(UTC).timestamp() * 1000)
        last_by_day: dict[str, tuple] = {}; pages = 0
        try:
            while start < end and pages < 2000:
                data = s.request('bitfinex', 'deriv_status', asset, f'https://api-pub.bitfinex.com/v2/status/deriv/{pair}/hist?limit=5000&start={start}&sort=1')
                pages += 1
                if not data:
                    break
                for r in data:
                    d = epoch_day(r[0]); last_by_day[d] = (r[0], r[17], r[11], r[2], r[3])   # keep the latest record of each day
                nxt = data[-1][0] + 1
                if nxt <= start:
                    break
                start = nxt; time.sleep(1.5)
            n = 0
            for d, (ts, oi, fund, dp, sp) in sorted(last_by_day.items()):
                if oi is not None:
                    n += s.put('bitfinex', 'open_interest', asset, d, oi, 0)
                if dp and sp:
                    s.put('bitfinex', 'perp_spot_basis', asset, d, dp / sp - 1, 0)
            s.log('bitfinex', 'open_interest', asset, 'OK' if n else 'FAIL', f'{n} end-of-day OI (contract units = BTC/ETH) from {pages} pages of 1-minute status history')
        except Exception as exc:
            s.log('bitfinex', 'open_interest', asset, 'FAIL', repr(exc) + f' after {pages} pages; partial days kept')


# ---------------------------------------------------------------- Coinbase / Bitstamp / Upbit spot
def collect_coinbase(s: Store) -> None:
    _extend_allow()
    for product, asset, start in (('BTC-USD', 'btcusd', dt.date(2015, 1, 1)), ('ETH-USD', 'ethusd', dt.date(2016, 5, 1))):
        n = 0; day = _start_day(s, 'coinbase', 'spot_close', asset, start, 3); first = None
        try:
            while day.isoformat() < s.day:
                e = min(day + dt.timedelta(days=299), dt.date.fromisoformat(s.day))
                data = s.request('coinbase', 'spot_ohlcv', asset, f'https://api.exchange.coinbase.com/products/{product}/candles?granularity=86400&start={day.isoformat()}T00:00:00Z&end={e.isoformat()}T00:00:00Z')
                for t, lo, hi, o, c, v in data:
                    d = epoch_day(t, 's'); first = min(first, d) if first else d
                    n += s.put('coinbase', 'spot_close', asset, d, c, 0); s.put('coinbase', 'spot_volume', asset, d, v, 0)
                day = e + dt.timedelta(days=1); time.sleep(0.35)
            s.log('coinbase', 'spot_close', asset, 'OK', f'{n} daily candles {product}, first {first}')
        except Exception as exc:
            s.log('coinbase', 'spot_close', asset, 'FAIL', repr(exc))


def collect_bitstamp(s: Store) -> None:
    _collect_bitstamp_pairs(s, (('btcusd', 'btcusd', 1314000000), ('ethusd', 'ethusd', 1500000000)))


def _collect_bitstamp_pairs(s: Store, pairs) -> None:
    _extend_allow()
    for pair, asset, start in pairs:
        last = s.last_date('bitstamp', 'spot_close', asset) if INCREMENTAL else None
        n = 0; cur = max(start, int(dt.datetime.combine(dt.date.fromisoformat(last) - dt.timedelta(days=3), dt.time(), UTC).timestamp())) if last else start; first = None
        try:
            for _ in range(60):
                obj = s.request('bitstamp', 'spot_ohlcv', asset, f'https://www.bitstamp.net/api/v2/ohlc/{pair}/?step=86400&limit=1000&start={cur}')
                rows = obj.get('data', {}).get('ohlc', [])
                if not rows:
                    break
                for r in rows:
                    d = epoch_day(int(r['timestamp']), 's'); first = first or d
                    n += s.put('bitstamp', 'spot_close', asset, d, r['close'], 0); s.put('bitstamp', 'spot_volume', asset, d, r['volume'], 0)
                nxt = int(rows[-1]['timestamp']) + 86400
                if nxt <= cur:
                    break
                cur = nxt; time.sleep(0.3)
                # v3 fix: a short page is NOT the end (Bitstamp returns bars inside [start, start+limit*step)); stop at today
                if epoch_day(nxt, 's') >= s.day:
                    break
            s.log('bitstamp', 'spot_close', asset, 'OK', f'{n} daily bars {pair}, first {first}')
        except Exception as exc:
            s.log('bitstamp', 'spot_close', asset, 'FAIL', repr(exc))


def collect_upbit(s: Store, markets=('KRW-BTC', 'KRW-ETH'), with_fx: bool = True) -> None:
    _extend_allow()
    for market in markets:
        asset = market.lower(); n = 0; to = None; first = None
        try:
            for _ in range(60):
                url = f'https://api.upbit.com/v1/candles/days?market={market}&count=200' + (f'&to={to}' if to else '')
                data = s.request('upbit', 'spot_ohlcv', asset, url)
                if not data:
                    break
                for r in data:
                    d = r['candle_date_time_utc'][:10]; first = d
                    n += s.put('upbit', 'spot_close', asset, d, r['trade_price'], 0)
                to = data[-1]['candle_date_time_utc'] + 'Z'
                time.sleep(0.2)
                last = s.last_date('upbit', 'spot_close', asset) if INCREMENTAL else None
                if len(data) < 200 or (last and data[-1]['candle_date_time_utc'][:10] <= last):
                    break
            s.log('upbit', 'spot_close', asset, 'OK', f'{n} daily closes {market} (KRW), first {first}')
        except Exception as exc:
            s.log('upbit', 'spot_close', asset, 'FAIL', repr(exc))
    # KRW per USD from FRED (lag 1 per FRED rule)
    if not with_fx:
        return
    try:
        text = s.request('fred', 'DEXKOUS', '', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXKOUS', 'csv')
        rd = csv.DictReader(io.StringIO(text)); k = 'DATE' if 'DATE' in rd.fieldnames else 'observation_date'; m = 0
        for row in rd:
            if row['DEXKOUS'] not in ('.', ''):
                m += s.put('fred', 'DEXKOUS', '', row[k], row['DEXKOUS'], 1)
        s.log('fred', 'DEXKOUS', '', 'PARTIAL', f'{m} rows KRW per USD (noon buying rate NY); latest-revised')
    except Exception as exc:
        s.log('fred', 'DEXKOUS', '', 'FAIL', repr(exc))


def collect_blockchain_info_extra(s: Store) -> None:
    for chart, metric in (('estimated-transaction-volume-usd', 'tx_volume_usd_est'), ('n-unique-addresses', 'unique_addresses_used')):
        try:
            obj = s.request('blockchain_info', metric, 'btc', f'https://api.blockchain.info/charts/{chart}?timespan=all&format=json&sampled=false')
            n = sum(s.put('blockchain_info', metric, 'btc', epoch_day(int(r['x']), 's'), r['y'], 1) for r in obj['values'])
            s.log('blockchain_info', metric, 'btc', 'OK', f'{n} rows from chart {chart} ({obj.get("unit")}); NEW id, not a Coin Metrics definition')
        except Exception as exc:
            s.log('blockchain_info', metric, 'btc', 'FAIL', repr(exc))


def collect_binance_vision_recent(s: Store) -> None:
    """Current month is not yet in the monthly archives: fetch the daily 1d kline zips (spot and perp) for the days since the last monthly file."""
    _extend_allow(); base = 'https://data.binance.vision/data'
    for symbol in ('BTCUSDT', 'ETHUSDT'):
        asset = symbol.lower()
        for kind, src_metric, prefix in (('spot', 'spot_close', 'spot'), ('futures/um', 'perp_close', 'perp')):
            last = s.db.execute("SELECT MAX(date) FROM series WHERE source='binance_vision' AND metric=? AND asset=?", (src_metric, asset)).fetchone()[0]
            if not last:
                continue
            day = dt.date.fromisoformat(last) + dt.timedelta(days=1); n = 0; miss = 0
            while day.isoformat() < s.day:
                try:
                    body = s.request_bytes('binance_vision', prefix + '_ohlcv', asset, f'{base}/{kind}/daily/klines/{symbol}/1d/{symbol}-1d-{day.isoformat()}.zip')
                except RuntimeError as exc:
                    if 'HTTP 404' in str(exc):
                        miss += 1; day += dt.timedelta(days=1); continue
                    raise
                for row in unzip_csv(body):
                    if not row or not row[0].isdigit():
                        continue
                    t = int(row[0]); t = t // 1000 if t > 10**14 else t; o, h, l, c, v = map(float, row[1:6]); d = epoch_day(t)
                    n += s.put('binance_vision', prefix + '_close', asset, d, c, 0); s.put('binance_vision', prefix + '_volume', asset, d, v, 0)
                    if prefix == 'spot':
                        for m, val in (('spot_open', o), ('spot_high', h), ('spot_low', l), ('spot_volume_quote', float(row[7]))):
                            s.put('binance_vision', m, asset, d, val, 0)
                day += dt.timedelta(days=1); time.sleep(0.05)
            s.log('binance_vision', prefix + '_close', asset, 'OK', f'recent daily zips: {n} bars added after {last}, {miss} days without file')
    for asset in ('btcusdt', 'ethusdt'):
        rows = s.db.execute("SELECT p.date, p.value, q.value FROM series p JOIN series q ON p.date=q.date AND q.source='binance_vision' AND q.metric='spot_close' AND q.asset=p.asset WHERE p.source='binance_vision' AND p.metric='perp_close' AND p.asset=?", (asset,)).fetchall()
        nb = sum(s.put('binance_vision', 'perp_spot_basis', asset, d, pv / sv - 1, 0) for d, pv, sv in rows if sv)
        s.log('binance_vision', 'perp_spot_basis', asset, 'OK', f'{nb} rows after recent update')


def collect_bitstamp_eth(s: Store) -> None:
    _collect_bitstamp_pairs(s, (('ethusd', 'ethusd', 1500000000),))


def collect_upbit_eth(s: Store) -> None:
    collect_upbit(s, markets=('KRW-ETH',), with_fx=False)


SOURCES = {'bitstamp_eth': collect_bitstamp_eth, 'upbit_eth': collect_upbit_eth, 'binance_vision': collect_binance_vision, 'binance_vision_recent': collect_binance_vision_recent, 'bitmex': collect_bitmex, 'deribit': collect_deribit, 'bitfinex': collect_bitfinex,
           'coinbase': collect_coinbase, 'bitstamp': collect_bitstamp, 'upbit': collect_upbit, 'blockchain_info_extra': collect_blockchain_info_extra}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--source', choices=list(SOURCES) + ['all'], required=True); p.add_argument('--only', default=None)
    p.add_argument('--full', action='store_true', help='re-download complete histories instead of incremental updates')
    a = p.parse_args(); s = Store(Path(__file__).resolve().parents[1])
    global INCREMENTAL
    INCREMENTAL = not a.full
    try:
        for name in (list(SOURCES) if a.source == 'all' else [a.source]):
            print(f'=== {name} ===', flush=True)
            SOURCES[name](s, a.only) if name == 'binance_vision' else SOURCES[name](s)
    finally:
        s.finish()
    return 1 if s.failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
