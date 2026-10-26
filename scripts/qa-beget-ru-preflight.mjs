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
const PROBES = [
  ['homepage', '/', 'html'],
  ['login-f5', '/login', 'html'],
  ['trade-f5', '/trade?pair=BTC%2FUSDT', 'html'],
  ['futures-f5', '/futures', 'html'],
  ['api-pairs', '/api/v1/pairs', 'json'],
  ['market-listings', '/market/listings', 'json'],
];
const DIRECT_HOSTS = [
  'api.voltextech.net', 'market.voltextech.net', 'notify.voltextech.net',
  'ws.kraken.com', 'stream.bybit.com', 'api.bybit.com', 'api.bytick.com',
];
const htmlAssets = new Set();

async function check(name, path, expected, inspectAssets = false) {
  const requestUrl = new URL(path, base);
  try {
    const response = await fetch(requestUrl, {
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
    const body = await response.text();
    if (expected === 'json') JSON.parse(body);
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
    checks.push({ name, path, status: 'FAIL', error: String(err.message ?? err) });
  }
}

for (const [name, path, type] of PROBES)
  await check(name, path, type, name === 'homepage');
for (const path of [...htmlAssets].slice(0, 8))
  await check('html-asset', path, 'asset');

const report = {
  origin: base.origin,
  checkedAt: new Date().toISOString(),
  networkProof: 'NOT ESTABLISHED: run from a documented Russian ISP/ASN without VPN',
  checks,
  bundleDirectDependencyHints: [...browserDependencies],
  limitations: [
    'HTML/asset/API public GET probes only; no login, trading or WebSocket tests',
    'Only assets directly referenced by initial HTML are scanned; lazy bundles need browser DevTools inspection',
    'A PASS does not prove access from Russian operators or regulatory/provider compliance',
  ],
};
console.log(JSON.stringify(report, null, 2));
if (checks.some(c => c.status === 'FAIL') || !htmlAssets.size) process.exitCode = 1;
