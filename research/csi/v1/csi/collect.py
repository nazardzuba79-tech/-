#!/usr/bin/env python3
"""Live collectors. Each adapter: GET public endpoints only, save raw bytes before parsing,
write canonical metrics with the contractual lag, log OK/PARTIAL/UNAVAILABLE/FAIL.

Fallback rules (from the owner's spec):
  * a fallback source writes the SAME canonical metric name only when the economic definition
    is the same, and sets `source` to itself; otherwise a NEW metric name is used.
  * OKX is used ONLY because Binance (451) and Bybit (403 CloudFront) are geo-blocked from this runtime.
"""
from __future__ import annotations
import argparse, csv, datetime as dt, io, json, math, re, sys, time, urllib.parse
from pathlib import Path
from .store import Store, UTC, epoch_day, number, write_merged_report

CM_WANTED = 'PriceUSD CapMrktCurUSD CapRealUSD CapMVRVCur SplyCur SplyAct1yr SplyActEver AdrActCnt TxCnt TxTfrValAdjUSD FeeTotUSD RevUSD IssTotUSD HashRate DiffMean NVTAdj90 VtyDayRet30d'.split()
# Extra Community metrics used by catalogue candidates (exchange flows, balances, fees in native units, ROI, spot volume)
CM_EXTRA = 'AdrBalCnt BlkCnt FeeTotNtv FlowInExNtv FlowInExUSD FlowOutExNtv FlowOutExUSD IssTotNtv ROI1yr ROI30d SplyExNtv SplyExUSD TxTfrCnt volume_reported_spot_usd_1d PriceBTC'.split()
FRED_CORE = 'WALCL WTREGEN RRPONTSYD WRESBAL M2SL DTWEXBGS DFII10 BAMLH0A0HYM2 VIXCLS SP500'.split()
FRED_EXTRA = 'T10Y2Y DFF T10YIE NFCI'.split()  # catalogue M111-M114; lag 1 by the "решта: 1" rule
FRED_LAG = {'WALCL': 8, 'WTREGEN': 8, 'WRESBAL': 8, 'M2SL': 30}
INCREMENTAL = True   # --full re-downloads complete histories
LLAMA_CHAINS = {'Ethereum': 'stablecoin_mcap_ethereum', 'Tron': 'stablecoin_mcap_tron', 'Solana': 'stablecoin_mcap_solana',
                'Arbitrum': 'stablecoin_mcap_arbitrum', 'Base': 'stablecoin_mcap_base', 'BSC': 'stablecoin_mcap_bsc'}


# ---------------------------------------------------------------- alternative.me
def collect_alternative_me(s: Store) -> None:
    try:
        obj = s.request('alternative_me', 'fng', '', 'https://api.alternative.me/fng/?limit=0&format=json')
        if obj.get('metadata', {}).get('error'):
            raise ValueError(str(obj['metadata']['error']))
        data = obj.get('data')
        if not isinstance(data, list) or not data:
            raise ValueError('Missing nonempty fng data list')
        n = 0
        for row in data:
            n += s.put('alternative_me', 'fng', '', epoch_day(int(row['timestamp']), 's'), row['value'], 0)
        s.log('alternative_me', 'fng', '', 'OK', f'{n} closed-day observations from {len(data)} returned; provider completeness not independently proven')
    except Exception as exc:
        s.log('alternative_me', 'fng', '', 'FAIL', repr(exc))


# ---------------------------------------------------------------- FRED
def collect_fred(s: Store) -> None:
    for metric in FRED_CORE + FRED_EXTRA:
        try:
            text = s.request('fred', metric, '', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + metric, 'csv')
            reader = csv.DictReader(io.StringIO(text)); headers = reader.fieldnames or []
            day_key = 'DATE' if 'DATE' in headers else 'observation_date'
            if metric not in headers or day_key not in headers:
                raise ValueError(f'Unexpected CSV columns {headers}')
            lag = FRED_LAG.get(metric, 1); n = 0; blank = 0
            for row in reader:
                if row[metric] in ('.', ''):
                    blank += 1; continue  # holidays/missing stay missing
                n += s.put('fred', metric, '', row[day_key], row[metric], lag)
            s.log('fred', metric, '', 'PARTIAL', f'{n} rows, {blank} blank cells skipped. Latest-revised CSV (not vintages); exact user lag {lag}d preserved; native frequency kept')
        except Exception as exc:
            s.log('fred', metric, '', 'FAIL', repr(exc))


# ---------------------------------------------------------------- Coin Metrics
def cm_catalog_metrics(catalog: dict, asset: str) -> dict[str, dict]:
    out = {}
    for a in catalog.get('data', []):
        if a.get('asset') != asset:
            continue
        for m in a.get('metrics', []):
            for f in m.get('frequencies', []):
                if f.get('frequency') == '1d':
                    out[m['metric']] = f
    return out


def collect_coinmetrics(s: Store) -> None:
    wanted_report = []
    for asset in ('btc', 'eth'):
        try:
            catalog = s.request('coinmetrics', 'catalog', asset,
                                'https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?assets=' + asset)
            offered = cm_catalog_metrics(catalog, asset)
            if not offered:
                raise ValueError('Catalog schema not recognized; inspect raw catalog')
        except Exception as exc:
            for metric in CM_WANTED:
                s.log('coinmetrics', metric, asset, 'FAIL', 'Catalog gate: ' + repr(exc))
                wanted_report.append([metric, asset, 'wanted', 'FAIL', repr(exc)])
            continue
        for metric in CM_WANTED + CM_EXTRA:
            kind = 'wanted' if metric in CM_WANTED else 'extra'
            f = offered.get(metric)
            if f is None or not f.get('community'):
                reason = 'not in catalog for asset' if f is None else 'in catalog but community=false'
                s.log('coinmetrics', metric, asset, 'UNAVAILABLE', reason)
                wanted_report.append([metric, asset, kind, 'UNAVAILABLE', reason]); continue
            last = s.last_date('coinmetrics', metric, asset) if INCREMENTAL else None
            start_time = (dt.date.fromisoformat(last) - dt.timedelta(days=30)).isoformat() if last else '2009-01-01'   # 30-day overlap re-reads recent revisions
            url = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?' + urllib.parse.urlencode(
                {'assets': asset, 'metrics': metric, 'frequency': '1d', 'start_time': start_time, 'end_time': s.day, 'page_size': 10000})
            visited = set(); n = 0; nulls = 0
            try:
                for _ in range(100):
                    if url in visited:
                        raise ValueError('Repeated next_page URL')
                    visited.add(url); obj = s.request('coinmetrics', metric, asset, url)
                    if not isinstance(obj, dict) or not isinstance(obj.get('data'), list):
                        raise ValueError('Unknown CM timeseries schema')
                    for row in obj['data']:
                        if row.get('asset') != asset:
                            raise ValueError('Wrong asset in CM series')
                        if metric not in row:
                            raise ValueError('Requested metric missing from CM observation')
                        if row[metric] is None:
                            nulls += 1; continue
                        n += s.put('coinmetrics', metric, asset, row['time'][:10], row[metric], 1)
                    nxt = obj.get('next_page_url')
                    if not nxt and obj.get('next_page_token'):
                        q = urllib.parse.urlparse(url); params = urllib.parse.parse_qs(q.query)
                        params['next_page_token'] = [obj['next_page_token']]
                        nxt = urllib.parse.urlunparse(q._replace(query=urllib.parse.urlencode(params, doseq=True)))
                    time.sleep(0.7)
                    if not nxt:
                        break
                    url = nxt
                else:
                    raise ValueError('CM page ceiling reached')
                s.log('coinmetrics', metric, asset, 'OK', f'{n} rows, {nulls} nulls kept missing; catalog range {f["min_time"][:10]}..{f["max_time"][:10]}; revised history, lag=1 contractual')
                wanted_report.append([metric, asset, kind, 'OK', f'{n} rows'])
            except Exception as exc:
                s.log('coinmetrics', metric, asset, 'FAIL', repr(exc)); wanted_report.append([metric, asset, kind, 'FAIL', repr(exc)])
    with (s.root / 'reports/coinmetrics_wanted_obtained.csv').open('w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh); w.writerow(['metric', 'asset', 'kind', 'status', 'detail']); w.writerows(wanted_report)


# ---------------------------------------------------------------- Binance direct API (451 from the research runtime; parsers follow the documented formats)
def collect_binance(s: Store) -> None:
    """Spot 1d klines (2017-08-17+), USD-M funding events (2019-09+), short-history OI / taker / long-short (period=1d, ~30 days)."""
    start_today = int(dt.datetime.combine(dt.date.fromisoformat(s.day), dt.time(), UTC).timestamp() * 1000)
    for symbol in ('BTCUSDT', 'ETHUSDT'):
        asset = symbol.lower(); cursor = int(dt.datetime(2017, 8, 17, tzinfo=UTC).timestamp() * 1000); n = 0
        try:
            for _ in range(100):
                data = s.request('binance_spot', 'spot_ohlcv', asset, 'https://api.binance.com/api/v3/klines?' + urllib.parse.urlencode({'symbol': symbol, 'interval': '1d', 'limit': 1000, 'startTime': cursor, 'endTime': start_today - 1}))
                if not data:
                    break
                for row in data:
                    t = int(row[0]); o, h, l, c = map(float, row[1:5])
                    if min(o, h, l, c) <= 0 or h < max(o, c, l) or l > min(o, c, h):
                        raise ValueError('Invalid OHLC geometry')
                    d = epoch_day(t); n += s.put('binance_spot', 'spot_close', asset, d, c, 0)
                    for m, v in (('spot_open', o), ('spot_high', h), ('spot_low', l), ('spot_volume', row[5]), ('spot_volume_quote', row[7])):
                        s.put('binance_spot', m, asset, d, v, 0)
                nxt = int(data[-1][0]) + 1
                if nxt <= cursor:
                    raise ValueError('Pagination stalled')
                cursor = nxt
                if len(data) < 1000:
                    break
            for m in ('spot_close', 'spot_open', 'spot_high', 'spot_low', 'spot_volume', 'spot_volume_quote'):
                s.log('binance_spot', m, asset, 'OK', f'{n} closed daily bars via direct API')
        except Exception as exc:
            s.log('binance_spot', 'spot_close', asset, 'FAIL', 'GEO_BLOCKED_OR_ERROR: ' + repr(exc)[:400])
        # funding events
        cursor = int(dt.datetime(2019, 9, 1, tzinfo=UTC).timestamp() * 1000); events = {}
        try:
            for _ in range(100):
                data = s.request('binance_futures', 'funding_events', asset, 'https://fapi.binance.com/fapi/v1/fundingRate?' + urllib.parse.urlencode({'symbol': symbol, 'startTime': cursor, 'endTime': start_today - 1, 'limit': 1000}))
                if not data:
                    break
                for row in data:
                    if row.get('symbol') != symbol:
                        raise ValueError('Wrong symbol')
                    events[int(row['fundingTime'])] = float(row['fundingRate'])
                nxt = max(int(r['fundingTime']) for r in data) + 1
                if nxt <= cursor:
                    raise ValueError('Funding pagination stalled')
                cursor = nxt
                if len(data) < 1000:
                    break
            days = {}
            for t, v in sorted(events.items()):
                days.setdefault(epoch_day(t), []).append(v)
            nf = 0
            rep = []
            for day, vals in sorted(days.items()):
                nf += s.put('binance_futures', 'funding_rate_daily', asset, day, math.fsum(vals), 0); rep.append([day, len(vals), math.fsum(vals), 'NOT_PROVEN_FROM_EVENT_COUNT_ALONE'])
            write_merged_report(s.root / f'reports/funding_event_counts_binance_{asset}.csv', ['date', 'event_count', 'sum_rates', 'completeness'], rep)
            s.log('binance_futures', 'funding_rate_daily', asset, 'OK', f'{nf} days from {len(events)} actual settlement events')
        except Exception as exc:
            s.log('binance_futures', 'funding_rate_daily', asset, 'FAIL', 'GEO_BLOCKED_OR_ERROR: ' + repr(exc)[:400])
        # short-history statistics (documented: recent ~30 days only). timestamp = end of period per docs => date = day of (timestamp - 1ms)
        for metric, path, key in (('open_interest', 'openInterestHist', 'sumOpenInterest'), ('open_interest_usd', 'openInterestHist', 'sumOpenInterestValue'),
                                  ('taker_buy_sell_ratio', 'takerlongshortRatio', 'buySellRatio'), ('long_short_ratio', 'globalLongShortAccountRatio', 'longShortRatio')):
            try:
                data = s.request('binance_futures', metric, asset, f'https://fapi.binance.com/futures/data/{path}?symbol={symbol}&period=1d&limit=500')
                n = 0; first = None
                for row in data:
                    d = epoch_day(int(row['timestamp']) - 1); first = min(first, d) if first else d
                    n += s.put('binance_futures', metric, asset, d, row[key], 0)
                s.log('binance_futures', metric, asset, 'PARTIAL', f'{n} rows, first date {first}; endpoint serves ~30 days only; period-end timestamp mapped to the day it closes')
            except Exception as exc:
                s.log('binance_futures', metric, asset, 'FAIL', 'GEO_BLOCKED_OR_ERROR: ' + repr(exc)[:400])


def collect_bybit(s: Store) -> None:
    for metric, url in (('funding_rate_daily', 'https://api.bybit.com/v5/market/funding-rate-history?category=linear&symbol=BTCUSDT&limit=200'),
                        ('spot_close', 'https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=D&limit=1000')):
        try:
            s.request('bybit', metric, 'btcusdt', url)
            s.log('bybit', metric, 'btcusdt', 'FAIL', 'Unexpected 200; parser not implemented (endpoint was geo-blocked during development)')
        except Exception as exc:
            s.log('bybit', metric, 'btcusdt', 'FAIL', 'GEO_BLOCKED_OR_ERROR: ' + repr(exc)[:600])


# ---------------------------------------------------------------- OKX (fallback venue)
def okx_page(s: Store, source, metric, asset, base_url: str, after_key: str, ts_index, stop_before_ms: int | None = None) -> list:
    """Paginate backwards with `after=<oldest ts>` until an empty page (or, incrementally, until older than stop_before_ms)."""
    rows = []; after = None; seen = set()
    for _ in range(400):
        if stop_before_ms is not None and after is not None and after < stop_before_ms:
            break
        url = base_url + (f'&after={after}' if after else '')
        obj = s.request(source, metric, asset, url)
        if obj.get('code') != '0':
            raise ValueError(f'OKX error code {obj.get("code")}: {obj.get("msg")}')
        data = obj.get('data') or []
        if not data:
            break
        for r in data:
            ts = int(ts_index(r))
            if ts in seen:
                raise ValueError('Duplicate timestamp in OKX pagination')
            seen.add(ts); rows.append(r)
        oldest = min(int(ts_index(r)) for r in data)
        if after is not None and oldest >= after:
            raise ValueError('OKX pagination stalled')
        after = oldest
        time.sleep(0.15)
    return rows


def collect_okx(s: Store) -> None:
    # --- daily UTC candles: spot (fallback for spot_close/spot_volume) and perpetual swap (for basis)
    for inst, asset, kind in (('BTC-USDT', 'btcusdt', 'spot'), ('ETH-USDT', 'ethusdt', 'spot'), ('BTC-USDT-SWAP', 'btcusdt', 'perp'), ('ETH-USDT-SWAP', 'ethusdt', 'perp')):
        prefix = 'spot' if kind == 'spot' else 'perp'
        try:
            last = s.last_date('okx', f'{prefix}_close', asset) if INCREMENTAL else None
            stop = int(dt.datetime.combine(dt.date.fromisoformat(last) - dt.timedelta(days=3), dt.time(), UTC).timestamp() * 1000) if last else None
            rows = okx_page(s, 'okx', f'{prefix}_ohlcv', asset, f'https://www.okx.com/api/v5/market/history-candles?instId={inst}&bar=1Dutc&limit=100', 'after', lambda r: r[0], stop)
            n = 0; unconfirmed = 0
            for r in rows:
                ts, o, h, l, c, vol, volccy, volq, confirm = r[:9]
                if confirm != '1':
                    unconfirmed += 1; continue
                o, h, l, c = map(float, (o, h, l, c))
                if min(o, h, l, c) <= 0 or h < max(o, c, l) or l > min(o, c, h):
                    raise ValueError('Invalid OHLC geometry')
                d = epoch_day(int(ts))
                n += s.put('okx', f'{prefix}_close', asset, d, c, 0)
                s.put('okx', f'{prefix}_open', asset, d, o, 0); s.put('okx', f'{prefix}_high', asset, d, h, 0); s.put('okx', f'{prefix}_low', asset, d, l, 0)
                s.put('okx', f'{prefix}_volume', asset, d, vol, 0)          # base-asset volume (same unit as Binance kline volume)
                s.put('okx', f'{prefix}_volume_quote', asset, d, volq, 0)   # quote (USDT) volume
            for m in (f'{prefix}_close', f'{prefix}_open', f'{prefix}_high', f'{prefix}_low', f'{prefix}_volume', f'{prefix}_volume_quote'):
                s.log('okx', m, asset, 'OK', f'{inst} 1Dutc confirmed bars: {n}; unconfirmed skipped: {unconfirmed}; FALLBACK venue because Binance 451/Bybit 403')
        except Exception as exc:
            s.log('okx', f'{prefix}_close', asset, 'FAIL', repr(exc))
    # --- funding events (actual settlements summed per UTC day; never synthesised to 3/day)
    for inst, asset in (('BTC-USDT-SWAP', 'btcusdt'), ('ETH-USDT-SWAP', 'ethusdt')):
        try:
            rows = okx_page(s, 'okx', 'funding_events', asset, f'https://www.okx.com/api/v5/public/funding-rate-history?instId={inst}&limit=100', 'after', lambda r: r['fundingTime'])
            days: dict[str, list] = {}
            for r in rows:
                if r.get('instId') != inst:
                    raise ValueError('Wrong instId in funding response')
                rate = r.get('realizedRate') or r.get('fundingRate')
                days.setdefault(epoch_day(int(r['fundingTime'])), []).append(float(rate))
            n = 0; rep = []
            for day, vals in sorted(days.items()):
                if day >= s.day:
                    continue
                n += s.put('okx', 'funding_rate_daily', asset, day, math.fsum(vals), 0)
                rep.append([day, len(vals), math.fsum(vals), 'NOT_PROVEN_FROM_EVENT_COUNT_ALONE'])
            write_merged_report(s.root / f'reports/funding_event_counts_okx_{asset}.csv', ['date', 'event_count', 'sum_rates', 'completeness'], rep)
            first = min(days) if days else None
            s.log('okx', 'funding_rate_daily', asset, 'PARTIAL', f'{n} days from {len(rows)} settlement events; first event day {first}; OKX public history is SHORT (~3 months); FALLBACK venue')
        except Exception as exc:
            s.log('okx', 'funding_rate_daily', asset, 'FAIL', repr(exc))
    # --- OKX "rubik" statistics: different definitions from Binance per-symbol fields => NEW metric names, asset = coin
    for ccy, asset in (('BTC', 'btc'), ('ETH', 'eth')):
        for metric, url, parse in (
            ('okx_oi_usd_all_contracts', f'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy={ccy}&period=1D', lambda r: (r[0], r[1])),
            ('okx_contract_volume_usd', f'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy={ccy}&period=1D', lambda r: (r[0], r[2])),
            ('okx_long_short_account_ratio', f'https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy={ccy}&period=1D', lambda r: (r[0], r[1])),
            ('okx_taker_buy_usd', f'https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy={ccy}&instType=CONTRACTS&period=1D', lambda r: (r[0], r[1])),
            ('okx_taker_sell_usd', f'https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy={ccy}&instType=CONTRACTS&period=1D', lambda r: (r[0], r[2])),
        ):
            try:
                obj = s.request('okx', metric, asset, url)
                if obj.get('code') != '0':
                    raise ValueError(f'OKX error {obj.get("code")}: {obj.get("msg")}')
                data = obj['data']; n = 0
                for r in data:
                    ts, val = parse(r)
                    # ts semantics (period start vs end) not proven from docs => conservative lag 1 day
                    n += s.put('okx', metric, asset, epoch_day(int(ts)), val, 1)
                first = min(epoch_day(int(r[0])) for r in data) if data else None
                s.log('okx', metric, asset, 'PARTIAL', f'{n} rows; first date {first}; endpoint returns only the recent window ({len(data)} rows); period boundary semantics unverified => lag 1')
            except Exception as exc:
                s.log('okx', metric, asset, 'FAIL', repr(exc))


# ---------------------------------------------------------------- DefiLlama
def collect_defillama(s: Store) -> None:
    def pegged_usd(obj: dict, key: str):
        v = obj.get(key)
        if isinstance(v, dict):
            return v.get('peggedUSD')
        return None
    targets = [('all', 'stablecoin_mcap')] + list(LLAMA_CHAINS.items())
    for chain, metric in targets:
        try:
            data = s.request('defillama', metric, '', f'https://stablecoins.llama.fi/stablecoincharts/{chain}')
            if not isinstance(data, list) or not data:
                raise ValueError('Unexpected stablecoincharts shape')
            n = 0; miss = 0
            for row in data:
                val = pegged_usd(row, 'totalCirculatingUSD')
                if val is None:
                    miss += 1; continue
                n += s.put('defillama', metric, '', epoch_day(int(row['date']), 's'), val, 1)
            s.log('defillama', metric, '', 'OK', f'{n} rows (totalCirculatingUSD.peggedUSD = USD value of USD-pegged stablecoins); {miss} rows without the key; units USD; NOT net inflow')
        except Exception as exc:
            s.log('defillama', metric, '', 'FAIL', repr(exc))
    try:
        data = s.request('defillama', 'total_tvl', '', 'https://api.llama.fi/v2/historicalChainTvl')
        n = sum(s.put('defillama', 'total_tvl', '', epoch_day(int(r['date']), 's'), r['tvl'], 1) for r in data)
        s.log('defillama', 'total_tvl', '', 'OK', f'{n} rows; USD stock; delta(TVL) is NOT inflow (price revaluation inside)')
    except Exception as exc:
        s.log('defillama', 'total_tvl', '', 'FAIL', repr(exc))
    for metric, url in (('dex_volume_usd', 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true'),
                        ('protocol_fees_usd', 'https://api.llama.fi/overview/fees?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true')):
        try:
            obj = s.request('defillama', metric, '', url)
            chart = obj.get('totalDataChart')
            if not isinstance(chart, list) or not chart:
                raise ValueError('totalDataChart missing')
            n = sum(s.put('defillama', metric, '', epoch_day(int(t), 's'), v, 1) for t, v in chart)
            s.log('defillama', metric, '', 'PARTIAL', f'{n} rows aggregated across all listed protocols; early zeros are provider coverage gaps, not activity; adapter coverage grows over time (survivorship of listing)')
        except Exception as exc:
            s.log('defillama', metric, '', 'FAIL', repr(exc))


# ---------------------------------------------------------------- Farside (HTML table; parentheses = negative)
def parse_farside_table(html: str) -> tuple[list[str], list[list]]:
    """Return (tickers, rows[date, values..., total]) from the first <table class="etf">. No JS executed."""
    import html as htmlmod
    m = re.search(r'<table class="etf">(.*?)</table>', html, re.S)
    if not m:
        raise ValueError('No <table class="etf"> in response (Cloudflare challenge or layout change)')
    t = m.group(1)
    # header: on /bitcoin-etf-flow-all-data one row [Date, tickers..., Total]; on /btc and /eth the ticker names sit in
    # the second thead row while "Total" is the last cell of the first row. Column count must match either way.
    heads = None
    thead = re.search(r'<thead>(.*?)</thead>', t, re.S)
    head_rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', thead.group(1) if thead else t, re.S):
        head_rows.append([htmlmod.unescape(re.sub(r'<[^>]+>', '', h)).replace('\xa0', ' ').strip() for h in re.findall(r'<th[^>]*>(.*?)</th>', tr, re.S)])
    for i, cells in enumerate(head_rows):
        if cells and cells[-1] == 'Total':
            if sum(1 for c in cells[1:-1] if c.isalpha()) >= 1:
                heads = ['Date'] + cells[1:]
            elif i + 1 < len(head_rows) and len(head_rows[i + 1]) == len(cells):
                heads = ['Date'] + head_rows[i + 1][1:-1] + ['Total']
            break
    if heads is None:
        raise ValueError(f'No ticker header row with Total column found: {head_rows[:2]}')
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        cells = [htmlmod.unescape(re.sub(r'<[^>]+>', '', c)).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(cells) != len(heads):
            continue
        try:
            day = dt.datetime.strptime(cells[0], '%d %b %Y').date().isoformat()
        except ValueError:
            continue  # Total/Average/Maximum summary rows
        vals = []
        for c in cells[1:]:
            c = c.replace(',', '').replace('*', '')
            if c in ('-', ''):
                vals.append(None); continue
            neg = c.startswith('(') and c.endswith(')')
            v = float(c.strip('()'))
            vals.append(-v if neg else v)
        rows.append([day] + vals)
    return heads, rows


def collect_farside(s: Store) -> None:
    pages = (('https://farside.co.uk/bitcoin-etf-flow-all-data/', 'btc', 'all_data'), ('https://farside.co.uk/btc/', 'btc', 'recent'), ('https://farside.co.uk/eth/', 'eth', 'eth'))
    for url, asset, kind in pages:
        try:
            html = s.request('farside', 'etf_flow_musd', asset, url, 'html')
            heads, rows = parse_farside_table(html)
            if heads[0] != 'Date' or heads[-1] != 'Total':
                raise ValueError(f'Unexpected header layout {heads}')
            n = 0; mism = 0; check = []
            for r in rows:
                day, vals, total = r[0], r[1:-1], r[-1]
                if total is None:
                    continue
                ssum = math.fsum(v for v in vals if v is not None)
                ok = abs(ssum - total) <= max(0.6, 0.002 * abs(total))
                if not ok:
                    mism += 1
                check.append([day, ssum, total, ok])
                if kind == 'recent' and s.db.execute("SELECT 1 FROM series WHERE source='farside' AND metric='etf_flow_musd' AND asset=? AND date=?", (asset, day)).fetchone():
                    continue  # all_data page already supplied this day; recent page only fills gaps
                n += s.put('farside', 'etf_flow_musd', asset, day, total, 1)
            with (s.root / f'reports/farside_total_check_{asset}_{kind}.csv').open('w', newline='', encoding='utf-8') as fh:
                w = csv.writer(fh); w.writerow(['date', 'sum_tickers', 'total_column', 'within_tolerance']); w.writerows(check)
            first = min(r[0] for r in rows) if rows else None; last = max(r[0] for r in rows) if rows else None
            s.log('farside', 'etf_flow_musd', asset, 'OK' if not mism else 'PARTIAL', f'{kind}: {len(rows)} table rows {first}..{last}, {n} written (Total column, US$m, parentheses=negative); ticker-sum mismatches: {mism}; obtained with a plain GET (curl UA got 403, urllib UA got 200); no challenge bypass')
        except Exception as exc:
            s.log('farside', 'etf_flow_musd', asset, 'FAIL', 'BLOCKED_OR_PARSE: ' + repr(exc)[:400] + ' | per spec: no alternative ETF-flow provider')


# ---------------------------------------------------------------- derived canonical fields (documented derivations only)
def derive(s: Store) -> None:
    """perp_spot_basis = perp_close/spot_close - 1 on the same venue and day (OKX fallback; lag 0)."""
    for asset in ('btcusdt', 'ethusdt'):
        rows = s.db.execute("""SELECT p.date, p.value, q.value FROM series p JOIN series q ON p.date=q.date AND q.source='okx' AND q.metric='spot_close' AND q.asset=p.asset
                               WHERE p.source='okx' AND p.metric='perp_close' AND p.asset=?""", (asset,)).fetchall()
        n = sum(s.put('okx', 'perp_spot_basis', asset, d, pv / sv - 1, 0) for d, pv, sv in rows if sv)
        s.log('okx', 'perp_spot_basis', asset, 'OK' if n else 'FAIL', f'{n} rows derived from OKX perp/spot daily closes (same venue, same UTC day); FALLBACK venue')


# ---------------------------------------------------------------- CoinGecko (verbatim failures kept)
def collect_coingecko(s: Store) -> None:
    for metric, asset, url in (('PriceUSD', 'btc', 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&interval=daily'),
                               ('global', '', 'https://api.coingecko.com/api/v3/global')):
        last = None
        for attempt in range(3):
            try:
                obj = s.request('coingecko', metric, asset, url)
                s.log('coingecko', metric, asset, 'PARTIAL', 'HTTP 200 raw saved; not written to series (primary source already supplied PriceUSD; global has no history)')
                last = None; break
            except Exception as exc:
                last = repr(exc)[:500]; time.sleep(25)
        if last:
            s.log('coingecko', metric, asset, 'FAIL', f'after 3 attempts: {last}')


# ---------------------------------------------------------------- blockchain.info fallback (only for CM-unavailable metrics)
def collect_blockchain_info(s: Store) -> None:
    mapping = (('difficulty', 'DiffMean'), ('transaction-fees-usd', 'FeeTotUSD'), ('miners-revenue', 'RevUSD'))
    for chart, metric in mapping:
        have = s.db.execute("SELECT COUNT(*) FROM series WHERE source='coinmetrics' AND metric=? AND asset='btc'", (metric,)).fetchone()[0]
        if have:
            s.log('blockchain_info', metric, 'btc', 'UNAVAILABLE', 'Primary (coinmetrics) already supplied this metric; fallback not written'); continue
        try:
            obj = s.request('blockchain_info', metric, 'btc', f'https://api.blockchain.info/charts/{chart}?timespan=all&format=json&sampled=false')
            vals = obj.get('values')
            if not isinstance(vals, list) or not vals:
                raise ValueError('values missing')
            n = 0
            for r in vals:
                n += s.put('blockchain_info', metric, 'btc', epoch_day(int(r['x']), 's'), r['y'], 1)
            s.log('blockchain_info', metric, 'btc', 'PARTIAL', f'{n} rows from chart {chart} (unit {obj.get("unit")}, period {obj.get("period")}); FALLBACK source, definition differs from Coin Metrics {metric} (see DEFINITIONS_AUDIT)')
        except Exception as exc:
            s.log('blockchain_info', metric, 'btc', 'FAIL', repr(exc))


SOURCES = {
    'alternative_me': collect_alternative_me, 'fred': collect_fred, 'coinmetrics': collect_coinmetrics,
    'binance': collect_binance, 'bybit': collect_bybit, 'okx': collect_okx, 'defillama': collect_defillama,
    'farside': collect_farside, 'coingecko': collect_coingecko, 'blockchain_info': collect_blockchain_info, 'derive': derive,
}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', choices=list(SOURCES) + ['all'], required=True)
    p.add_argument('--root', default=None)
    p.add_argument('--full', action='store_true', help='re-download complete histories instead of incremental updates')
    args = p.parse_args()
    global INCREMENTAL
    INCREMENTAL = not args.full
    root = Path(args.root) if args.root else Path(__file__).resolve().parents[1]
    s = Store(root)
    names = list(SOURCES) if args.source == 'all' else [args.source]
    try:
        for name in names:
            print(f'=== {name} ===', flush=True)
            SOURCES[name](s)
    finally:
        s.finish()
    return 1 if s.failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
