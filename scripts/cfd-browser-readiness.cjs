'use strict';

// Warm the real, uncached public routes before a cold browser takes its
// six-hour display snapshot. No alternative data or financial route is used.
const RETRY_DELAYS_MS = [0, 1000, 2000];
const REQUEST_TIMEOUT_MS = 8000;
const INTERVAL = '1h';
const LIMIT = 320;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const positiveNumber = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value)) && Number(value) > 0;

function validBarCount(body, symbol) {
  if (body?.symbol !== symbol || body.interval !== INTERVAL || !Array.isArray(body.bars)) return 0;
  const times = new Set();
  for (const bar of body.bars) {
    if (!bar || typeof bar !== 'object') continue;
    const time = typeof bar.openTime === 'number' ? bar.openTime : Date.parse(bar.openTime);
    const values = ['open', 'high', 'low', 'close'].map(key => bar[key]);
    const [open, high, low, close] = values.map(Number);
    if (!Number.isFinite(time) || time <= 0 || times.has(time)
      || !values.every(positiveNumber)
      || high < Math.max(open, low, close) || low > Math.min(open, high, close)) continue;
    times.add(time);
  }
  return times.size;
}

async function waitForCfdBrowserReadiness(origin, { fetchFn = fetch, sleep = pause, now = Date.now, record = () => {} } = {}) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password
    || base.pathname !== '/' || base.search || base.hash) throw new Error('CFD QA readiness requires its loopback origin');

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt - 1]) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    const startedAt = now(), result = { attempt, requests: [], passed: false };
    const read = async pathname => {
      const request = { path: pathname, status: null }, started = now();
      result.requests.push(request);
      try {
        const response = await fetchFn(base.origin + pathname, {
          headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        request.status = response.status;
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'HTTP ' + response.status);
        return body;
      } catch (error) {
        request.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally { request.elapsedMs = now() - started; }
    };
    try {
      const quotes = await read('/api/v1/cfd/tickers');
      const priced = Array.isArray(quotes?.tickers) ? quotes.tickers.filter(row => row && typeof row.symbol === 'string'
        && /^[A-Z]{6}$/.test(row.symbol) && positiveNumber(row.price)) : [];
      const selected = priced.find(row => row.symbol === 'XAUUSD') ?? priced[0];
      if (!selected) throw new Error('No real priced CFD row');
      result.selectedSymbol = selected.symbol;
      result.reloadSymbol = selected.symbol === 'WTIUSD' ? 'XAUUSD' : 'WTIUSD';
      result.candles = await Promise.all([result.selectedSymbol, result.reloadSymbol].map(async symbol => {
        const path = '/api/v1/cfd/candles/' + encodeURIComponent(symbol) + '?interval=' + INTERVAL + '&limit=' + LIMIT;
        try {
          const body = await read(path), bars = validBarCount(body, symbol);
          return { symbol, bars, ...(bars < 2 ? { error: 'Missing, invalid or mismatched CFD bars' } : {}) };
        } catch (error) { return { symbol, bars: 0, error: error instanceof Error ? error.message : String(error) }; }
      }));
      if (result.candles.some(item => item.bars < 2)) throw new Error('Real CFD chart data is not ready');
      result.passed = true;
    } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
    result.elapsedMs = now() - startedAt;
    record(result);
    if (result.passed) return result;
  }
  throw new Error('CFD public-route readiness failed after ' + RETRY_DELAYS_MS.length + ' bounded attempts; see readiness diagnostics');
}

module.exports = { waitForCfdBrowserReadiness };
