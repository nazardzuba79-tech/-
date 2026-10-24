import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VENUE_DISCOVERY, WATCH_LIST, classify, withTicker, withCandles, discover, renderTable } from './venue-discovery.mjs';

// Captured venue bodies only (testing/fixtures/venues/FIXTURES.md). Metadata subsets keep the
// venue's rows for the watch list unchanged; nothing below is generated.
const dir = new URL('./testing/fixtures/venues/discovery/', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const AT = '2026-10-20T17:25:35Z';
const META = {
  // The Bybit 403 body is CloudFront HTML, kept as text evidence; the runner stores a non-JSON body as null.
  bybit: { status: 403, body: null, at: AT, text: readFileSync(new URL('bybit_instruments_http403.html', dir), 'utf8') },
  binance: { status: 200, body: json('binance_exchangeInfo_subset.json'), at: AT },
  bitget: { status: 200, body: json('bitget_symbols_subset.json'), at: AT },
  bingx: { status: 200, body: json('bingx_symbols_subset.json'), at: AT },
  gate: { status: 200, body: json('gate_currency_pairs_subset.json'), at: AT },
  mexc: { status: 200, body: json('mexc_exchangeInfo_subset.json'), at: AT },
  kucoin: { status: 200, body: json('kucoin_symbols_subset.json'), at: AT },
  okx: { status: 200, body: json('okx_instruments_subset.json'), at: AT },
  kraken: { status: 200, body: json('kraken_assetpairs_tokenized_subset.json'), at: '2026-10-20T17:34:14Z' },
};
const TICKER = { bingx: 'bingx_ticker24hr_AAPLX-USDT.json', okx: 'okx_ticker_XAAPL-USDT.json', bitget: 'bitget_tickers_RAAPLUSDT.json', kucoin: 'kucoin_stats_AAPLX-USDT.json', kraken: 'kraken_ticker_AAPLxUSD.json' };
const CANDLES = { bingx: 'bingx_kline_AAPLX-USDT_15m_limit5.json', okx: 'okx_candles_XAAPL-USDT_15m_limit5.json', bitget: 'bitget_candles_RAAPLUSDT_15min_limit5.json', kucoin: 'kucoin_candles_AAPLX-USDT_15min.json', kraken: 'kraken_ohlc_AAPLxUSD_15_subset.json' };

test('nine venues classify the watch list from their own metadata; a blocked venue is NOT_VERIFIED with its HTTP code', () => {
  assert.deepEqual(Object.keys(VENUE_DISCOVERY), ['bybit', 'binance', 'bitget', 'bingx', 'gate', 'mexc', 'kucoin', 'okx', 'kraken']);
  const rows = Object.fromEntries(Object.keys(META).map(v => [v, classify(v, META[v])]));
  const pick = (v, t) => rows[v].find(r => r.ticker === t);
  for (const r of rows.bybit) { assert.equal(r.status, 'NOT_VERIFIED'); assert.equal(r.http, 403); assert.equal(r.venueSymbol, null); assert.equal(r.sourceType, 'unavailable'); }
  assert.deepEqual(WATCH_LIST.map(t => pick('binance', t).venueSymbol), ['AAPLBUSDT', 'NVDABUSDT', 'TSLABUSDT', 'MSFTBUSDT', 'SPYBUSDT', 'QQQBUSDT']);
  assert.deepEqual(pick('binance', 'MSFT'), { ...pick('binance', 'MSFT'), status: 'TRADING', venueStatus: 'TRADING', issuer: 'bstocks', base: 'MSFTB', quote: 'USDT', tickSize: '0.01000000', lotSize: '0.00100000', minNotional: '5.00000000', sourceType: 'spot-token', adapter: 'MarketHub (built-in)' });
  assert.deepEqual(WATCH_LIST.map(t => [pick('gate', t).venueSymbol, pick('gate', t).status]), [['AAPLX_USDT', 'TRADING'], ['NVDAX_USDT', 'TRADING'], ['TSLAX_USDT', 'TRADING'], [null, 'UNAVAILABLE'], ['SPYX_USDT', 'TRADING'], ['QQQX_USDT', 'TRADING']]);
  assert.equal(pick('gate', 'AAPL').baseName, 'Apple xStock'); assert.equal(pick('gate', 'AAPL').venueStatus, 'tradable');
  assert.deepEqual(WATCH_LIST.map(t => pick('mexc', t).venueSymbol), ['AAPLXUSDT', 'NVDAXUSDT', 'TSLAXUSDT', null, 'SPYXUSDT', null]);
  assert.equal(pick('mexc', 'AAPL').contractAddress, 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'); assert.equal(pick('mexc', 'AAPL').venueStatus, '1');
  assert.deepEqual(WATCH_LIST.map(t => pick('bingx', t).venueSymbol), ['AAPLX-USDT', 'NVDAX-USDT', 'TSLAX-USDT', null, 'SPYX-USDT', 'QQQB-USDT']);
  assert.equal(pick('bingx', 'QQQ').base, 'QQQB', 'BingX lists the bStocks-family QQQB, not an xStocks QQQX; the row says which');
  assert.deepEqual(WATCH_LIST.map(t => [pick('okx', t).venueSymbol, pick('okx', t).status]), [['XAAPL-USDT', 'TRADING'], ['XNVDA-USDT', 'TRADING'], ['XTSLA-USDT', 'TRADING'], ['XMSFT-USDT', 'TRADING'], ['XSPY-USDT', 'TRADING'], ['XQQQ-USDT', 'TRADING']]);
  assert.equal(pick('okx', 'AAPL').issuer, 'NOT_VERIFIED'); assert.equal(pick('okx', 'AAPL').instCategory, '3'); assert.equal(pick('okx', 'AAPL').openType, 'pre_quote');
  assert.deepEqual(WATCH_LIST.map(t => pick('bitget', t).venueSymbol), ['RAAPLUSDT', 'RNVDAUSDT', 'RTSLAUSDT', 'RMSFTUSDT', 'RSPYUSDT', 'RQQQUSDT']);
  assert.equal(pick('bitget', 'AAPL').sourceType, 'unified-share-equivalent'); assert.equal(pick('bitget', 'AAPL').base, 'rAAPL'); assert.equal(pick('bitget', 'AAPL').adapter, 'discovery only');
  assert.deepEqual(WATCH_LIST.map(t => pick('kucoin', t).venueSymbol), ['AAPLX-USDT', null, 'TSLAX-USDT', null, null, null]);
  assert.equal(pick('kucoin', 'AAPL').market, 'Stocks');
  assert.deepEqual(WATCH_LIST.map(t => [pick('kraken', t).venueSymbol, pick('kraken', t).quote]), [['AAPLxUSD', 'ZUSD'], ['NVDAxUSD', 'ZUSD'], ['TSLAxUSD', 'ZUSD'], ['MSFTxUSD', 'ZUSD'], ['SPYxUSD', 'ZUSD'], ['QQQxUSD', 'ZUSD']]);
  assert.equal(pick('kraken', 'MSFT').status, 'TRADING');
  // Identity is per venue: the same underlying is five different venue symbols and three issuer families.
  assert.deepEqual(['binance', 'gate', 'okx', 'bitget', 'kraken'].map(v => [pick(v, 'AAPL').base, pick(v, 'AAPL').issuer]), [['AAPLB', 'bstocks'], ['AAPLX', 'xstocks'], ['XAAPL', 'NOT_VERIFIED'], ['rAAPL', 'bitget-rtoken'], ['AAPLx', 'xstocks']]);
  assert.ok(Object.values(rows).flat().every(r => r.rights === 'DATA_RIGHTS_UNVERIFIED'));
});

test('ticker and candle readers keep venue values verbatim, detect order and never fill a failed read', () => {
  for (const [v, name] of Object.entries(TICKER)) {
    const row = withTicker(classify(v, META[v], ['AAPL'])[0], { status: 200, body: json(name), at: AT });
    assert.ok(row.ticker24h && typeof row.ticker24h.last === 'string' && Number(row.ticker24h.last) > 0, v);
    assert.ok(row.spreadPct === null || row.spreadPct >= 0, v);
  }
  const bingx = withTicker(classify('bingx', META.bingx, ['AAPL'])[0], { status: 200, body: json(TICKER.bingx), at: AT });
  assert.deepEqual(bingx.ticker24h, { last: '341.57', bid: '341.46', ask: '341.56', volume: '119.03', quoteVolume: '40710.55', ts: 1792517655154 });
  const kraken = withTicker(classify('kraken', META.kraken, ['AAPL'])[0], { status: 200, body: json(TICKER.kraken), at: AT });
  assert.deepEqual(kraken.ticker24h, { last: '340.69', bid: '340.86', ask: '340.87', volume: '601.589769', quoteVolume: null, ts: null });
  for (const [v, name] of Object.entries(CANDLES)) {
    const row = withCandles(classify(v, META[v], ['AAPL'])[0], { status: 200, body: json(name), at: AT });
    assert.equal(row.candlesOk, true, v); assert.equal(row.lastCandle[0], 1792517400000, `${v}: newest 15m candle opens 17:30Z whichever order the venue uses`);
  }
  const okx = withCandles(classify('okx', META.okx, ['AAPL'])[0], { status: 200, body: json(CANDLES.okx), at: AT });
  assert.deepEqual(okx.lastCandle, [1792517400000, '341.44', '341.44', '341.44', '341.44', '0.20752']); assert.equal(okx.candleOrder, 'desc');
  const kucoin = withCandles(classify('kucoin', META.kucoin, ['AAPL'])[0], { status: 200, body: json(CANDLES.kucoin), at: AT });
  assert.deepEqual(kucoin.lastCandle, [1792517400000, '342.71', '342.71', '342.71', '342.71', '0.001'], 'KuCoin rows are [time, open, close, high, low, volume, turnover]');
  const failed = withTicker(withCandles(classify('okx', META.okx, ['AAPL'])[0], { status: 500, body: null, at: AT }), { status: 429, body: null, at: AT });
  assert.equal(failed.ticker24h, null); assert.equal(failed.candlesOk, false); assert.equal(failed.lastCandle, null); assert.equal(failed.tickerHttp, 429); assert.equal(failed.candleHttp, 500);
  const broken = withCandles(classify('bitget', META.bitget, ['AAPL'])[0], { status: 200, body: json('bitget_orderbook_RAAPLUSDT_code40502.json'), at: AT });
  assert.equal(broken.candlesOk, false, 'a venue error body (code 40502) is not a candle set');
});

test('discover() is bounded: one metadata read per venue, two reads per listed symbol, no retry, raw bodies returned', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'manual'); assert.equal(init.method, 'GET');
    const u = new URL(url);
    if (u.hostname === 'api.bybit.com') return new Response(META.bybit.text, { status: 403 });
    if (u.pathname.endsWith('/exchangeInfo') && u.hostname === 'data-api.binance.vision') return Response.json(META.binance.body);
    if (u.pathname === '/api/v4/spot/currency_pairs') return Response.json(META.gate.body);
    if (u.pathname === '/api/v4/spot/tickers') return Response.json(JSON.parse(readFileSync(new URL('../gate/tickers_AAPLX_USDT.json', dir), 'utf8')));
    if (u.pathname === '/api/v4/spot/candlesticks') return Response.json(JSON.parse(readFileSync(new URL('../gate/candlesticks_AAPLX_USDT_15m_limit5.json', dir), 'utf8')));
    return new Response('upstream', { status: 503 });
  };
  const result = await discover({ fetchImpl, venues: ['bybit', 'binance', 'gate'], tickers: ['AAPL'], now: () => 1792518100000, delayMs: 0 });
  assert.equal(result.checkedAt, '2026-10-20T17:41:40.000Z');
  const hosts = calls.map(u => new URL(u).hostname);
  assert.deepEqual([hosts.filter(h => h === 'api.bybit.com').length, hosts.filter(h => h === 'data-api.binance.vision').length, hosts.filter(h => h === 'api.gateio.ws').length], [1, 3, 3]);
  for (const v of ['bybit', 'binance', 'gate']) assert.equal(calls.find(u => u.includes(VENUE_DISCOVERY[v].host)), VENUE_DISCOVERY[v].metadataUrl, `${v}: metadata is read first`);
  assert.equal(calls.filter(u => u.includes('bybit')).length, 1, 'a 403 is reported, not retried');
  assert.equal(result.requests.length, 7); assert.ok(result.requests.every(r => typeof r.text === 'string' && r.body === undefined));
  const by = Object.fromEntries(result.rows.map(r => [r.venue, r]));
  assert.equal(by.bybit.status, 'NOT_VERIFIED'); assert.equal(by.bybit.http, 403);
  assert.equal(by.binance.status, 'TRADING'); assert.equal(by.binance.tickerHttp, 503); assert.equal(by.binance.ticker24h, null); assert.equal(by.binance.candlesOk, false);
  assert.equal(by.gate.ticker24h.last, '340.83'); assert.equal(by.gate.candlesOk, true); assert.equal(by.gate.lastCandle[0], 1792517400000);
  const table = renderTable(result.rows);
  assert.match(table, /\| Bybit \| AAPL \| unavailable \| xstocks \| — \| — \| NOT_VERIFIED \| 403 \|/);
  assert.match(table, /\| Gate \| AAPL \| spot-token \| xstocks \| AAPLX_USDT \| AAPLX\/USDT \| TRADING \(tradable\) \| 200 \|/);
});
