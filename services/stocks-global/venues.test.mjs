import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MarketHub, BINANCE_HOSTS } from './market.mjs';
import { VENUES, venuesFromEnv } from './venues.mjs';
import { CATALOG, VENUE_CATALOG, instrument, rankedSources } from './catalog.mjs';

// Every body below is a captured venue response (testing/fixtures/venues/FIXTURES.md). Exact URL
// routing: a request the adapter was not designed to make gets 404, so the tests prove that no
// other request, venue or value stands in for a missing one.
const dir = new URL('./testing/fixtures/venues/', import.meta.url);
const body = name => readFileSync(new URL(name, dir), 'utf8');
const GATE = 'https://api.gateio.ws/api/v4', MEXC = 'https://api.mexc.com/api/v3';
const ROUTES = {
  ...Object.fromEntries(['AAPLX','NVDAX','TSLAX','SPYX','QQQX'].flatMap(p => [[`${GATE}/spot/currency_pairs/${p}_USDT`, [`gate/currency_pairs_${p}_USDT.json`, 200]], [`${GATE}/spot/tickers?currency_pair=${p}_USDT`, [`gate/tickers_${p}_USDT.json`, 200]]])),
  [`${GATE}/spot/currency_pairs/MSFTX_USDT`]: ['gate/currency_pairs_MSFTX_USDT.http400.json', 400],
  [`${GATE}/spot/order_book?currency_pair=AAPLX_USDT&limit=1&with_id=true`]: ['gate/order_book_AAPLX_USDT_limit1.json', 200],
  [`${GATE}/spot/candlesticks?currency_pair=AAPLX_USDT&interval=15m&limit=600`]: ['gate/candlesticks_AAPLX_USDT_15m_limit600.json', 200],
  [`${GATE}/spot/candlesticks?currency_pair=AAPLX_USDT&interval=1d&limit=600`]: ['gate/candlesticks_AAPLX_USDT_1d_limit600.json', 200],
  [`${MEXC}/exchangeInfo?symbols=AAPLXUSDT,NVDAXUSDT,TSLAXUSDT,SPYXUSDT`]: ['mexc/exchangeInfo_slice.json', 200],
  ...Object.fromEntries(['AAPLX','NVDAX','TSLAX','SPYX'].map(p => [`${MEXC}/ticker/24hr?symbol=${p}USDT`, [`mexc/ticker24hr_${p}USDT.json`, 200]])),
  [`${MEXC}/depth?symbol=AAPLXUSDT&limit=1`]: ['mexc/depth_AAPLXUSDT_limit1.json', 200],
  [`${MEXC}/klines?symbol=AAPLXUSDT&interval=15m&limit=500`]: ['mexc/klines_AAPLXUSDT_15m_limit500.json', 200],
  [`${MEXC}/klines?symbol=AAPLXUSDT&interval=1d&limit=500`]: ['mexc/klines_AAPLXUSDT_1d_limit500.json', 200],
};
const NOW = 1792518100000; // 2026-10-20T17:41:40Z, after every capture
const router = (log = [], overrides = {}) => async url => { log.push(url); const hit = overrides[url] ?? ROUTES[url]; if (!hit) return new Response('{"error":"not captured"}', { status: 404 }); const [name, status] = hit; return new Response(typeof name === 'string' ? body(name) : JSON.stringify(name), { status }); };
const hub = (venues, log, overrides) => new MarketHub({ now: () => NOW, venues, fetchImpl: router(log, overrides) });

test('venues are off by default: the catalogue is unchanged, venue ids resolve but refuse, venue hosts are forbidden', async () => {
  const log = []; const h = hub([], log);
  const rows = await h.catalogue();
  assert.deepEqual(rows.map(r => r.id), CATALOG.map(i => i.id));
  assert.equal(log.filter(u => /gateio|mexc/.test(u)).length, 0);
  assert.equal(instrument('GATE:AAPLX_USDT').issuer, 'xstocks');
  await assert.rejects(h.quote('GATE:AAPLX_USDT'), /DATA_RIGHTS_UNVERIFIED/);
  await assert.rejects(h.history('MEXC:AAPLXUSDT', '15m'), /DATA_RIGHTS_UNVERIFIED/);
  await assert.rejects(h.request(`${GATE}/spot/time`), /SOURCE_FORBIDDEN/);
  assert.equal(log.filter(u => /gateio|mexc/.test(u)).length, 0, 'a refused venue read never reaches the network');
  assert.throws(() => new MarketHub({ venues: ['bybit'] }), /VENUE_UNKNOWN/);
  assert.throws(() => new MarketHub({ venues: ['toString'] }), /VENUE_UNKNOWN/);
  assert.deepEqual(venuesFromEnv({}), []);
  assert.throws(() => venuesFromEnv({ STOCKS_VENUES_ENABLED: 'gate' }), /DATA_RIGHTS_UNVERIFIED/);
  assert.throws(() => venuesFromEnv({ STOCKS_VENUES_ENABLED: 'okx', STOCKS_VENUE_RIGHTS_CONFIRMED: 'okx' }), /VENUE_UNKNOWN/);
  assert.deepEqual(venuesFromEnv({ STOCKS_VENUES_ENABLED: 'gate, mexc', STOCKS_VENUE_RIGHTS_CONFIRMED: 'mexc,gate' }), ['gate', 'mexc']);
});

test('Gate adapter: captured metadata, ticker, book and candles map to native fields; MSFTX stays absent; an uncaptured page is refused', async () => {
  const log = []; const h = hub(['gate'], log);
  const rows = await h.catalogue();
  assert.deepEqual(rows.slice(CATALOG.length).map(r => r.id), VENUE_CATALOG.filter(i => i.provider === 'gate').map(i => i.id));
  const aapl = rows.find(r => r.id === 'GATE:AAPLX_USDT');
  assert.equal(aapl.exists, true); assert.equal(aapl.online, true); assert.equal(aapl.venueStatus, 'tradable'); assert.equal(aapl.sourceError, null);
  assert.deepEqual(aapl.filters, { pricePrecision: 2, amountPrecision: 3, minBase: '0.001', minQuote: '3' });
  assert.equal(aapl.display.price, '340.83000000'); assert.equal(aapl.display.change24h, -0.53);
  assert.equal(log.filter(u => u.startsWith(GATE)).length, 10, 'five pair reads and five ticker reads');
  assert.equal(rows.some(r => r.asset === 'MSFTX'), false, 'Gate lists no MSFT xStock; nothing is invented for it');
  const q = await h.quote('GATE:AAPLX_USDT', { includeUsdc: false });
  assert.equal(q.bid, '340.89000000'); assert.equal(q.ask, '340.96000000'); assert.equal(q.last, '340.83000000');
  assert.equal(q.timestamp, 1792518024584); assert.equal(q.eventId, '148326244'); assert.equal(q.provider, 'gate'); assert.equal(q.nativeCurrency, 'USDT');
  assert.equal(q.volume, '69.83500000'); assert.equal(q.marketOpen, true); assert.equal(q.verified, true);
  assert.deepEqual(q.prices, { USDT: { buy: '340.96000000', sell: '340.89000000' } });
  const page = await h.history('GATE:AAPLX_USDT', '15m'), native = JSON.parse(body('gate/candlesticks_AAPLX_USDT_15m_limit600.json'));
  assert.equal(native.length, 600); assert.equal(page.candles.length, 300); assert.equal(page.provider, 'gate');
  // Gate rows are [t, quote volume, close, high, low, open, base amount, closed]; the page is the last 300.
  for (const [n, c] of page.candles.entries()) { const r = native[300 + n]; assert.deepEqual(c, { time: Number(r[0]), open: Number(r[5]), high: Number(r[3]), low: Number(r[4]), close: Number(r[2]), volume: Number(r[6]) }); }
  assert.ok(page.candles.every((c, n) => !n || page.candles[n - 1].time < c.time), 'ascending, no duplicates');
  const daily = await h.history('GATE:AAPLX_USDT', '1D'), nativeDaily = JSON.parse(body('gate/candlesticks_AAPLX_USDT_1d_limit600.json'));
  assert.equal(nativeDaily.length, 476); assert.equal(daily.candles.length, 300); assert.equal(daily.candles.at(-1).time, Number(nativeDaily.at(-1)[0]));
  assert.equal(log.filter(u => u.startsWith(GATE)).length, 13, 'catalogue 10, book 1 (the quote ticker is the cached catalogue read), candles 2');
  assert.equal((await h.history('GATE:AAPLX_USDT', '15m', NOW - 86400000)).candles.length, 300, 'a cursor inside the admitted 600-row window is served from it');
  await assert.rejects(h.history('GATE:AAPLX_USDT', '15m', Number(native[0][0]) * 1000 - 1), /SOURCE_HTTP_404/, 'a page older than the window that the venue did not serve is an error, not a filled gap');
  await assert.rejects(h.history('GATE:AAPLX_USDT', '2h'), /UNSUPPORTED_TIMEFRAME/);
});

test('MEXC adapter: one batched metadata read, fraction change converted, 500-row cap honoured, unknown symbol is exists:false', async () => {
  const log = []; const h = hub(['mexc'], log);
  const rows = await h.catalogue();
  assert.equal(log.filter(u => u.startsWith(`${MEXC}/exchangeInfo`)).length, 1);
  const aapl = rows.find(r => r.id === 'MEXC:AAPLXUSDT');
  assert.equal(aapl.online, true); assert.equal(aapl.venueStatus, '1'); assert.deepEqual(aapl.filters, { pricePrecision: 2, amountPrecision: 3, maxQuote: '2000000' });
  assert.equal(aapl.display.price, '342.11000000'); assert.equal(aapl.display.change24h, -0.39); assert.equal(aapl.display.timestamp, 1792517654993);
  const q = await h.quote('MEXC:AAPLXUSDT', { includeUsdc: false });
  assert.equal(q.bid, '341.45000000'); assert.equal(q.ask, '341.55000000'); assert.equal(q.last, '342.11000000');
  assert.equal(q.timestamp, 1792518022267); assert.equal(q.eventId, '508420568'); assert.equal(q.change24h, -0.39); assert.equal(q.volume, '209.49100000');
  const page = await h.history('MEXC:AAPLXUSDT', '15m'), native = JSON.parse(body('mexc/klines_AAPLXUSDT_15m_limit500.json'));
  assert.ok(log.at(-1).endsWith('&limit=500'), 'the hub asks for 600 rows; the adapter caps at the venue maximum');
  assert.equal(native.length, 500); assert.equal(page.candles.length, 300);
  for (const [n, c] of page.candles.entries()) { const r = native[200 + n]; assert.deepEqual(c, { time: r[0] / 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) }); }
  assert.equal(h.historyRanges.size, 0, 'a 500-row response never establishes the 600-row reusable window');
  assert.equal((await h.history('MEXC:AAPLXUSDT', '1D')).candles.length, 300);
  assert.equal(instrument('MEXC:MSFTXUSDT'), undefined, 'MEXC has no MSFT xStock pair and none is configured');
  assert.deepEqual(VENUES.mexc.parseInstrument(JSON.parse(body('mexc/exchangeInfo_MSFTXUSDT.json')), { sourceSymbol: 'MSFTXUSDT' }, NOW), { exists: false, online: false, venueStatus: null, multiplier: null, checkedAt: NOW, filters: null });
});

test('identity and priority: AAPLB, AAPLX and each venue stay distinct; a failed source is an error, never another source', async () => {
  const ids = ['BINANCE:AAPLBUSDT', 'BYBIT:AAPLXUSDT', 'GATE:AAPLX_USDT', 'MEXC:AAPLXUSDT'].map(instrument);
  assert.deepEqual(ids.map(i => [i.provider, i.asset, i.issuer]), [['binance', 'AAPLB', 'bstocks'], ['bybit', 'AAPLX', 'xstocks'], ['gate', 'AAPLX', 'xstocks'], ['mexc', 'AAPLX', 'xstocks']]);
  assert.equal(new Set([...CATALOG, ...VENUE_CATALOG].map(i => i.id)).size, CATALOG.length + VENUE_CATALOG.length);
  assert.ok(CATALOG.every(i => i.issuer === (i.provider === 'moex' ? 'moex' : i.provider === 'bybit' ? 'xstocks' : 'bstocks')));
  const log = []; const h = hub(['gate', 'mexc'], log, { [`${GATE}/spot/order_book?currency_pair=AAPLX_USDT&limit=1&with_id=true`]: [{ message: 'upstream' }, 500] });
  const rows = await h.catalogue();
  assert.deepEqual(rankedSources('AAPL', rows).map(r => [r.id, r.listed, r.online, r.sourceError]), [['BINANCE:AAPLBUSDT', true, false, 'SOURCE_HTTP_404'], ['GATE:AAPLX_USDT', true, true, null], ['MEXC:AAPLXUSDT', true, true, null], ['BYBIT:AAPLXUSDT', true, false, 'SOURCE_HTTP_404']]);
  assert.deepEqual(rankedSources('MSFT', rows).map(r => r.id), ['BINANCE:MSFTBUSDT']);
  await assert.rejects(h.quote('GATE:AAPLX_USDT', { includeUsdc: false }), /SOURCE_HTTP_500/);
  const mexc = await h.quote('MEXC:AAPLXUSDT', { includeUsdc: false });
  assert.equal(mexc.instrumentId, 'MEXC:AAPLXUSDT'); assert.equal(mexc.provider, 'mexc');
  assert.equal(log.filter(u => u.includes('order_book')).length, 1, 'the Gate failure triggered no retry on another venue');
});

test('a venue ticker failure after a good metadata read is recorded as the venue error, not hidden and not filled', async () => {
  const h = hub(['gate'], [], { [`${GATE}/spot/tickers?currency_pair=QQQX_USDT`]: [{ message: 'upstream' }, 502] });
  const rows = await h.catalogue(), qqq = rows.find(r => r.id === 'GATE:QQQX_USDT'), aapl = rows.find(r => r.id === 'GATE:AAPLX_USDT');
  assert.equal(qqq.online, true); assert.equal(qqq.display, null); assert.equal(qqq.sourceError, 'SOURCE_HTTP_502');
  assert.equal(aapl.display.price, '340.83000000'); assert.equal(aapl.sourceError, 'SOURCE_HTTP_502', 'the error is per venue, as for Bybit and Binance');
});

test('Binance host option: default unchanged; the documented market-data host serves the same paths; anything else is refused', async () => {
  assert.deepEqual(BINANCE_HOSTS, ['api.binance.com', 'data-api.binance.vision']);
  assert.throws(() => new MarketHub({ binanceHost: 'api.binance.vision' }), /SOURCE_FORBIDDEN/);
  const seen = []; const def = new MarketHub({ now: () => NOW, fetchImpl: async url => { seen.push(url); return new Response('{}', { status: 404 }); } });
  await def.catalogue(); assert.ok(seen.some(u => u.startsWith('https://api.binance.com/api/v3/exchangeInfo?symbols=')));
  await assert.rejects(def.request('https://data-api.binance.vision/api/v3/time'), /SOURCE_HTTP_404/, 'both official hosts pass the allowlist');
  // Captured bodies: the exchangeInfo and ticker/24hr subsets hold the venue's rows for the watch list.
  const info = JSON.parse(body('discovery/binance_exchangeInfo_subset.json')), tickers = JSON.parse(body('binance-vision/ticker24hr_slice.json'));
  const log = []; const vision = new MarketHub({ now: () => NOW, binanceHost: 'data-api.binance.vision', fetchImpl: async url => {
    log.push(url); const u = new URL(url); if (u.hostname !== 'data-api.binance.vision') return new Response('{}', { status: 404 });
    if (u.pathname === '/api/v3/exchangeInfo') return Response.json(info);
    if (u.pathname === '/api/v3/ticker/24hr') { const one = u.searchParams.get('symbol'); return Response.json(one ? tickers.find(t => t.symbol === one) : tickers); }
    if (u.pathname === '/api/v3/trades' && u.searchParams.get('symbol') === 'AAPLBUSDT') return new Response(body('binance-vision/trades_AAPLBUSDT_limit1.json'));
    if (u.pathname === '/api/v3/klines' && u.searchParams.get('symbol') === 'AAPLBUSDT') return new Response(body('binance-vision/klines_AAPLBUSDT_15m_limit5.json'));
    return new Response('{}', { status: 404 }); } });
  const rows = await vision.catalogue(), aapl = rows.find(r => r.id === 'BINANCE:AAPLBUSDT');
  assert.equal(aapl.online, true); assert.equal(aapl.display.price, '341.46000000');
  assert.equal(rows.find(r => r.id === 'BINANCE:MSFTBUSDT').online, true, 'MSFT bStock is listed and TRADING');
  const q = await vision.quote('BINANCE:AAPLBUSDT', { includeUsdc: false });
  assert.equal(q.last, '341.46000000'); assert.equal(q.timestamp, 1792517630647); assert.equal(q.eventId, '696349');
  const page = await vision.history('BINANCE:AAPLBUSDT', '15m');
  assert.equal(page.candles.length, 5); assert.equal(page.candles.at(-1).close, 341.42);
  assert.ok(log.every(u => u.startsWith('https://data-api.binance.vision/') || !u.includes('binance')));
});
