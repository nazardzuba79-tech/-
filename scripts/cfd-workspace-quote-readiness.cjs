'use strict';

// QA-only observer. It never fetches, refreshes, substitutes or mutates market data.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const READY_TIMEOUT_MS = 45_000; // The existing selected-chart quote wait, not a new global timeout.
const DIAGNOSTIC_DRAIN_MS = 1_000;
// Matches both display hooks' readDisplayJson contract, not the shorter HTTP
// max-age that the server may choose for its first partial snapshot.
const DISPLAY_REFRESH_MS = 6 * 60 * 60 * 1_000;
const REQUIRED_STATS = ['price', 'change', 'high', 'low', 'updated', 'status'];
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const positive = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) > 0;
const timestamp = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const quoteFields = ['symbol', 'price', 'provider', 'providerSymbol', 'providerTimestamp', 'fetchedAt', 'asOf', 'maxQuoteAgeMs', 'status', 'stale', 'marketClosed', 'displayOnly', 'executionAllowed'];
const quoteProjection = row => row ? Object.fromEntries(quoteFields.map(k => [k, row[k] ?? null])) : null;

function displayNumber(text) {
  const normalized = typeof text === 'string' ? text.replace(/^≈\s*/, '').trim() : '';
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(normalized)) return null;
  return { value: Number(normalized.replaceAll(',', '')), decimals: (normalized.split('.')[1] || '').length };
}

function evaluateSelectedQuote({ symbol, dom, ticker, daily, now }) {
  const reasons = [];
  const require = (condition, reason) => { if (!condition) reasons.push(reason); };
  require(dom?.requestedSymbol === symbol && dom?.activeSymbol === symbol && dom?.headerSymbol === symbol, 'SELECTED_SYMBOL_MISMATCH');
  require(ticker?.complete === true && ticker.status === 200 && !ticker.error, 'TICKER_RESPONSE_NOT_COMPLETE');
  const rows = Array.isArray(ticker?.body?.tickers) ? ticker.body.tickers.filter(row => row?.symbol === symbol) : [];
  const row = rows.length === 1 ? rows[0] : null;
  require(!!row && positive(row.price), 'SELECTED_QUOTE_UNAVAILABLE');
  require([row?.provider, row?.providerSymbol, ticker?.body?.source].every(value => typeof value === 'string' && value.trim() !== ''), 'QUOTE_SOURCE_UNVERIFIED');
  require(row?.displayOnly === true && row?.executionAllowed === false, 'NOT_DISPLAY_ONLY');
  // The display route emits live/stale/market_closed; the UI labels these sampled.
  require(['live', 'stale', 'market_closed'].includes(row?.status), 'QUOTE_STATUS_UNAVAILABLE');
  const asOf = row?.asOf, fetchedAt = row?.fetchedAt, capturedAt = ticker?.body?._display?.capturedAt;
  for (const [name, response] of [['TICKER', ticker], ['DAILY', daily]]) {
    const envelope = response?.body?._display;
    require(envelope?.mode === 'snapshot' && envelope.refreshMs === DISPLAY_REFRESH_MS &&
      typeof envelope.capturedAt === 'number' && Number.isFinite(envelope.capturedAt) && envelope.capturedAt > 0 && envelope.capturedAt <= now,
    name + '_SNAPSHOT_ENVELOPE_INVALID');
  }
  for (const [name, value] of [['asOf', asOf], ['fetchedAt', fetchedAt], ['capturedAt', capturedAt]]) {
    require(typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now, 'INVALID_' + name);
  }
  // Sampled/closed display quotes retain their true age; this is not execution admission.
  const tickerPrice = displayNumber(dom?.ticker), ticketPrice = displayNumber(dom?.ticket);
  require(!!tickerPrice && !!ticketPrice && tickerPrice.value > 0 && tickerPrice.value === ticketPrice.value, 'DOM_PRICE_UNAVAILABLE_OR_MISMATCH');
  require(!!tickerPrice && positive(row?.price) && Math.abs(tickerPrice.value - Number(row.price)) <= 0.5 * 10 ** -tickerPrice.decimals + Number.EPSILON * Number(row.price), 'DOM_PRICE_NOT_OBSERVED_QUOTE');
  require(REQUIRED_STATS.every(key => dom?.stats?.includes(key)) && !!dom?.status && dom.status !== 'unknown', 'SELECTED_STATISTICS_NOT_READY');
  require(daily?.complete === true && daily.status === 200 && !daily.error && daily.body?.symbol === symbol && daily.body?.interval === '1d', 'DAILY_RESPONSE_NOT_READY');
  const bars = Array.isArray(daily?.body?.bars) ? daily.body.bars : [];
  const valid = bars.filter(bar => {
    const time = timestamp(bar?.openTime), values = ['open', 'high', 'low', 'close'].map(k => bar?.[k]);
    const [open, high, low, close] = values.map(Number);
    return Number.isFinite(time) && time > 0 && values.every(positive) && high >= Math.max(open, low, close) && low <= Math.min(open, high, close);
  }).map(bar => ({ ...bar, time: timestamp(bar.openTime) })).sort((a, b) => a.time - b.time);
  const current = valid.find(bar => bar.time <= asOf && asOf < bar.time + 86_400_000);
  const previous = current && valid.filter(bar => bar.time < current.time && current.time - bar.time <= 5 * 86_400_000 && bar.isOpen !== true).at(-1);
  require(valid.length === bars.length && new Set(valid.map(bar => bar.time)).size === valid.length && !!current && !!previous, 'DAILY_QUOTE_SESSION_UNVERIFIED');
  return {
    ready: reasons.length === 0, reasons,
    epoch: reasons.length ? null : hash({ source: ticker.body.source, row: quoteProjection(row), snapshot: ticker.body._display, daily: daily.body }),
    quote: quoteProjection(row), providerAgeMs: Number.isFinite(asOf) ? now - asOf : null,
    snapshotAgeMs: Number.isFinite(capturedAt) ? now - capturedAt : null,
    session: current?.time ?? null, previousSession: previous?.time ?? null,
  };
}

const sameQuoteEpoch = (before, after) => before?.ready === true && after?.ready === true && typeof before.epoch === 'string' && before.epoch === after.epoch;

async function observeSelectedQuote(page, { origin, record }) {
  const entries = [], byRequest = new Map(), pending = new Set(), network = [], networkIds = new Set();
  // Chart diagnostics are separately bounded and never participate in quote readiness.
  const charts = [], chartPending = new Set();
  let chartSequence = 0, chartOverflow = false, chartIncomplete = false;
  let sequence = 0, overflow = false, incomplete = false;
  const classify = url => {
    const u = new URL(url);
    if (u.origin !== origin) return null;
    if (u.pathname === '/api/v1/cfd/display/tickers') return { kind: 'ticker' };
    const match = u.pathname.match(/^\/api\/v1\/cfd\/display\/candles\/([A-Z0-9]+)$/);
    if (!match) return null;
    const interval = u.searchParams.get('interval'), limit = u.searchParams.get('limit');
    return interval === '1d' && limit === '20' ? { kind: 'daily', symbol: match[1] }
      : { kind: 'chart', symbol: match[1], requestedInterval: interval, requestedLimit: limit };
  };
  page.on('request', request => {
    const kind = classify(request.url()); if (!kind) return;
    const isChart = kind.kind === 'chart', target = isChart ? charts : entries;
    if (target.length >= 256) { if (isChart) chartOverflow = true; else overflow = true; return; }
    const entry = { sequence: isChart ? ++chartSequence : ++sequence, ...kind, url: request.url(), method: request.method(), resourceType: request.resourceType(), startedAt: Date.now(), complete: false };
    target.push(entry); byRequest.set(request, entry);
  });
  page.on('requestfailed', request => {
    const entry = byRequest.get(request); if (entry) Object.assign(entry, { endedAt: Date.now(), error: request.failure()?.errorText || 'REQUEST_FAILED' });
  });
  page.on('response', response => {
    const entry = byRequest.get(response.request()); if (!entry) return;
    const isChart = entry.kind === 'chart', pendingBodies = isChart ? chartPending : pending;
    entry.status = response.status(); entry.responseAt = Date.now(); entry.fromServiceWorker = response.fromServiceWorker();
    const task = (async () => {
      const headers = await response.allHeaders();
      entry.headers = Object.fromEntries(['cache-control', 'age', 'etag', 'x-voltex-refresh-seconds', 'content-type'].map(key => [key, headers[key] ?? null]));
      const body = await response.body(); entry.bytes = body.length; entry.bodySha256 = hash(body);
      if (body.length > 2_000_000) throw Error('QUOTE_TRACE_BODY_LIMIT');
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); }
      catch (error) { if (isChart) throw Error('CHART_TRACE_JSON_PARSE'); throw error; }
      if (!isChart) Object.defineProperty(entry, 'body', { value: parsed, enumerable: false });
      entry.snapshot = parsed?._display ?? null;
      entry.data = isChart ? { symbol: parsed?.symbol ?? null, providerSymbol: parsed?.providerSymbol ?? null,
        interval: parsed?.interval ?? null, source: parsed?.source ?? null, barCount: Array.isArray(parsed?.bars) ? parsed.bars.length : null,
        // Preserve the public API error code, not arbitrary response text or headers.
        responseError: typeof parsed?.error === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(parsed.error) ? parsed.error : null }
        : entry.kind === 'ticker' ? { source: parsed?.source ?? null, rows: Array.isArray(parsed?.tickers) ? parsed.tickers.map(quoteProjection) : null }
        : { symbol: parsed?.symbol, interval: parsed?.interval, bars: parsed?.bars };
      entry.timing = response.request().timing(); entry.complete = true;
    })().catch(error => { entry.error = String(error?.message || error).slice(0, 300); })
      .finally(() => { entry.endedAt = Date.now(); pendingBodies.delete(task); });
    pendingBodies.add(task);
  });
  // CDP is observational: cache provenance and initiators, not an intercepted request path.
  const cdp = await page.context().newCDPSession(page);
  const addNetwork = event => { if (network.length >= 1024) overflow = true; else network.push(event); };
  cdp.on('Network.requestWillBeSent', event => {
    const kind = classify(event.request.url); if (!kind || kind.kind === 'chart') return;
    if (overflow || networkIds.size >= 256) { overflow = true; return; }
    networkIds.add(event.requestId);
    addNetwork({ event: 'request', requestId: event.requestId, timestamp: event.timestamp, wallTime: event.wallTime,
      url: event.request.url, method: event.request.method, initiator: event.initiator });
  });
  cdp.on('Network.responseReceived', event => {
    if (!networkIds.has(event.requestId)) return;
    addNetwork({ event: 'response', requestId: event.requestId, timestamp: event.timestamp, status: event.response.status,
      fromDiskCache: event.response.fromDiskCache ?? false, fromServiceWorker: event.response.fromServiceWorker ?? false,
      fromPrefetchCache: event.response.fromPrefetchCache ?? false, protocol: event.response.protocol });
  });
  for (const event of ['requestServedFromCache', 'loadingFinished', 'loadingFailed']) cdp.on('Network.' + event, data => {
    if (networkIds.has(data.requestId)) addNetwork({ event, ...data });
  });
  await cdp.send('Network.enable');
  const evidence = { entries, network, charts, checkpoints: [], readiness: [], get overflow() { return overflow; }, get incomplete() { return incomplete; },
    get chartOverflow() { return chartOverflow; }, get chartIncomplete() { return chartIncomplete; } }; record(evidence);
  const snapshot = async symbol => {
    const dom = await page.evaluate(() => {
      const bar = document.querySelector('[data-cfd-stats]');
      let cache = null;
      try {
        const raw = localStorage.getItem('voltex.public-display.v1');
        if (raw && raw.length <= 2_000_000) cache = JSON.parse(raw).filter(([key]) => key.includes('/cfd/display/')).map(([key, item]) => ({ key, at: item.at, expiresAt: item.expiresAt, ttl: item.ttl, snapshot: item.value?._display ?? null }));
      } catch { cache = 'UNREADABLE'; }
      return { requestedSymbol: new URL(location.href).searchParams.get('symbol'), activeSymbol: document.querySelector('.cfd-option.active')?.getAttribute('data-cfd-symbol'),
        headerSymbol: document.querySelector('.cfd-selected-instrument .cfd-symbol')?.textContent?.trim(), ticker: document.querySelector('.cfd-ticker-price')?.textContent?.trim(),
        ticket: document.querySelector('.cfd-referencePrice')?.textContent?.trim(), stats: [...(bar?.querySelectorAll('[data-cfd-stat]') || [])].map(e => e.getAttribute('data-cfd-stat')),
        status: bar?.querySelector('[data-cfd-status]')?.getAttribute('data-cfd-status'),
        chartState: document.querySelector('.cfd-chart-area [data-chart-state]')?.getAttribute('data-chart-state') ?? null, cache };
    });
    const ticker = entries.filter(entry => entry.kind === 'ticker').at(-1), daily = entries.filter(entry => entry.kind === 'daily' && entry.symbol === symbol).at(-1), now = Date.now();
    const verdict = evaluateSelectedQuote({ symbol, dom, ticker, daily, now });
    if (overflow || incomplete) { verdict.ready = false; verdict.reasons.push(overflow ? 'QUOTE_TRACE_OVERFLOW' : 'QUOTE_TRACE_INCOMPLETE'); verdict.epoch = null; }
    return { ...verdict, at: now, symbol, dom, tickerSequence: ticker?.sequence ?? null, dailySequence: daily?.sequence ?? null };
  };
  const checkpoint = async (symbol, label) => { const value = { label, ...await snapshot(symbol) }; evidence.checkpoints.push(value); return value; };
  const wait = async symbol => {
    const start = Date.now(), monotonicStart = performance.now(), deadline = start + READY_TIMEOUT_MS;
    const remaining = () => READY_TIMEOUT_MS - (performance.now() - monotonicStart);
    let last;
    do {
      let timer;
      try { last = await Promise.race([snapshot(symbol), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('DOM_OBSERVATION_DEADLINE')), Math.max(0, remaining())); })]); }
      catch (error) { last = { ready: false, reasons: [String(error.message).slice(0, 300)], at: Date.now() }; break; }
      finally { clearTimeout(timer); }
      if (last.ready && remaining() >= 0) { evidence.readiness.push({ startedAt: start, deadline, ...last }); return last; }
      if (remaining() <= 0) break;
      // Only samples existing page/response state. No network work or quote refresh.
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, remaining()))));
    } while (remaining() > 0);
    evidence.readiness.push({ startedAt: start, deadline, ...last, ready: false });
    throw Error('SELECTED_CFD_QUOTE_NOT_READY ' + symbol + ': ' + (last?.reasons || []).join(','));
  };
  const settle = async (timeoutMs = DIAGNOSTIC_DRAIN_MS) => {
    const budget = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(DIAGNOSTIC_DRAIN_MS, timeoutMs)) : DIAGNOSTIC_DRAIN_MS;
    let timer;
    try {
      await Promise.race([Promise.allSettled([...pending, ...chartPending]), new Promise(resolve => { timer = setTimeout(resolve, budget); })]);
    } finally { clearTimeout(timer); }
    if (pending.size) incomplete = true;
    if (chartPending.size) chartIncomplete = true;
    evidence.chartDrain = { complete: !chartIncomplete, pending: chartPending.size };
    const result = { complete: !incomplete, pending: pending.size };
    evidence.drain = result;
    return result;
  };
  return { snapshot, checkpoint, wait, evidence, settle };
}

module.exports = { READY_TIMEOUT_MS, REQUIRED_STATS, evaluateSelectedQuote, sameQuoteEpoch, observeSelectedQuote };
