#!/usr/bin/env node
/**
 * Read-only VOLTEX Beget gateway preflight. Node >=22, no dependencies.
 * Does NOT establish Russian reachability: execute it on a confirmed
 * Russian-network probe and attach the probe's ASN/provider evidence.
 * Never provides credentials or submits financial requests.
 *
 * Usage: node scripts/qa-beget-ru-preflight.mjs https://EXISTING-GATEWAY-FQDN
 */
import { URL } from 'node:url';

const raw = process.argv[2];
let base;
try {
  if (!raw) throw new Error('missing origin');
  base = new URL(raw);
  if (base.protocol !== 'https:' || !base.hostname || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash)
    throw new Error('expected only an HTTPS origin without credentials, path, query or fragment');
} catch (err) {
  console.error('Usage: node scripts/qa-beget-ru-preflight.mjs https://EXISTING-GATEWAY-FQDN');
  console.error(String(err.message ?? err));
  process.exit(2);
}

const checks = [];
const browserDependencies = new Set();
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
let decodedBytes = 0, requests = 0, originBlocked = null;
if (Object.keys(process.env).some(key => /^(HTTP|HTTPS|ALL)_PROXY$/i.test(key) && process.env[key])) {
  console.error('CONFIGURED_PROXY_TRANSPORT_REQUIRED: native Node fetch must not ignore a configured proxy');
  process.exit(2);
}
const PROBES = [
  ['homepage', '/', 'html'],
  ['login-f5', '/login', 'html'],
  ['register-f5', '/register', 'html'],
  ['trade-f5', '/trade?pair=BTC%2FUSDT', 'html'],
  ['futures-f5', '/futures', 'html'],
  ['wallet-f5', '/wallet', 'html'],
  ['api-symbols', '/api/v1/market/external/symbols', 'json'],
  ['api-ticker', '/api/v1/market/external/tickers/BTC-USDT', 'json'],
  ['api-candles', '/api/v1/market/external/candles/BTC-USDT?interval=1h&limit=2', 'json'],
  ['market-listings', '/market/listings', 'json'],
];
const DIRECT_HOSTS = [
  'api.voltextech.net', 'market.voltextech.net', 'notify.voltextech.net',
  'ws.kraken.com', 'stream.bybit.com', 'api.bybit.com', 'api.bytick.com',
];
const htmlAssets = new Set();

async function boundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength; decodedBytes += value.byteLength;
      if (size > MAX_BODY_BYTES || decodedBytes > MAX_TOTAL_BYTES) throw new Error('RESPONSE_BUDGET_EXCEEDED');
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function validateJson(name, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.hasOwn(data, 'error')) throw new Error('INVALID_API_ENVELOPE');
  if (name === 'api-symbols' && (!Array.isArray(data.symbols) || !data.symbols.length
    || !data.symbols.every(s => typeof s === 'string' || (s && typeof s.pair === 'string')))) throw new Error('SYMBOLS_UNAVAILABLE');
  if (name === 'api-ticker' && (data.ticker?.pair !== 'BTC/USDT' || !(Number(data.ticker.lastPrice) > 0)
    || !Number.isFinite(Number(data.ticker.lastPrice)))) throw new Error('TICKER_UNAVAILABLE');
  if (name === 'api-candles' && (data.pair !== 'BTC/USDT' || data.interval !== '1h'
    || !Array.isArray(data.candles) || !data.candles.length || !data.candles.every(c =>
      Number.isFinite(c.time) && c.time > 0 && ['open', 'high', 'low', 'close'].every(k => Number.isFinite(c[k]) && c[k] > 0)
      && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)
      && Number.isFinite(c.volume) && c.volume >= 0))) throw new Error('CANDLES_UNAVAILABLE');
  if (name === 'market-listings' && !Array.isArray(data.assets)) throw new Error('INVALID_LISTINGS_ENVELOPE');
}

async function check(name, path, expected, inspectAssets = false) {
  if (originBlocked) { checks.push({ name, path, status: 'NOT_RUN', reason: 'ORIGIN_UNREACHABLE', causeCode: originBlocked }); return; }
  if (decodedBytes >= MAX_TOTAL_BYTES) { checks.push({ name, path, status: 'NOT_RUN', reason: 'RESPONSE_BUDGET_EXCEEDED' }); return; }
  const requestUrl = new URL(path, base);
  try {
    requests++;
    const response = await fetch(requestUrl, {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer',
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: { Accept: expected === 'json' ? 'application/json' : '*/*' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status !== 200) throw new Error('http_' + response.status);
    if (expected === 'html' && !contentType.includes('text/html'))
      throw new Error('not_html:' + contentType);
    if (expected === 'json' && !contentType.includes('json'))
      throw new Error('not_json:' + contentType);
    if (expected === 'asset' && !/javascript|css/.test(contentType))
      throw new Error('not_js_or_css:' + contentType);
    const body = await boundedText(response);
    if (expected === 'html' && !/\bid=["']root["']/.test(body)) throw new Error('NOT_VOLTEX_APP_SHELL');
    if (expected === 'json') {
      let data;
      try { data = JSON.parse(body); } catch { throw new Error('INVALID_JSON'); }
      validateJson(name, data);
    }
    if (inspectAssets) {
      const pattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
      for (const match of body.matchAll(pattern)) {
        const candidate = new URL(match[1], base);
        if (candidate.origin !== base.origin || !/\.(?:js|css)(?:\?|$)/i.test(candidate.pathname)) continue;
        htmlAssets.add(candidate.pathname);
      }
    }
    if (expected === 'asset') {
      for (const host of DIRECT_HOSTS) if (body.includes(host)) browserDependencies.add(host);
    }
    checks.push({ name, path, status: 'PASS', http: 200 });
  } catch (err) {
    const code = String(err.cause?.code ?? err.code ?? err.name ?? 'UNKNOWN').replace(/[^A-Z0-9_]/gi, '').slice(0, 64);
    checks.push({ name, path, status: 'FAIL', error: String(err.message ?? err), causeCode: code });
    if (name === 'homepage' && /ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT|CERT_|SELF_SIGNED|ECONNREFUSED|ECONNRESET|TimeoutError/.test(code)) originBlocked = code;
  }
}

for (const [name, path, type] of PROBES)
  await check(name, path, type, name === 'homepage');
for (const path of [...htmlAssets].slice(0, 8))
  await check('html-asset', path, 'asset');
if (!originBlocked && !htmlAssets.size) checks.push({ name: 'initial-assets', path: '/', status: 'FAIL', error: 'NO_INITIAL_JS_CSS' });

const report = {
  origin: base.origin,
  checkedAt: new Date().toISOString(),
  networkProof: 'NOT ESTABLISHED: run from a documented Russian ISP/ASN without VPN',
  checks,
  measured: { requests, decodedBytes, maxBodyBytes: MAX_BODY_BYTES, maxTotalBytes: MAX_TOTAL_BYTES },
  bundleDirectDependencyHints: [...browserDependencies],
  limitations: [
    'HTML/asset/API public GET probes only; no login, trading or WebSocket tests',
    'Only assets directly referenced by initial HTML are scanned; lazy bundles need browser DevTools inspection',
    'A PASS does not prove access from Russian operators or regulatory/provider compliance',
    'No authenticated account, logout, deposit address, withdrawal, KYC, Telegram or support submission is exercised',
    'Ticker/candle response shape is checked; quote freshness and actual WebSocket updates remain NOT_VERIFIED',
  ],
};
console.log(JSON.stringify(report, null, 2));
if (checks.some(c => c.status === 'FAIL') || !htmlAssets.size) process.exitCode = 1;
