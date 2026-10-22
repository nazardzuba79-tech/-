#!/usr/bin/env node
'use strict';
/**
 * VOLTEX public, anonymous, GET-only release evidence.
 * Detects whether the current Pages JavaScript actually contains the exact
 * Admin Listings fail-closed UI phrases shipped in PR #585.
 * This does not imply that the Hetzner API has the countdown capability.
 * No login, cookies, writes, private addresses, secrets, or production actions.
 */
const { URL } = require('node:url');
const ORIGIN = 'https://voltextech.net';
const API = 'https://api.voltextech.net';
const MARKET = 'https://market.voltextech.net';
const EXPECTED_OLD_SHA = '2e7acf158000404133db85723bac13695215e25c';
const MAX_FILES = 110, MAX_BYTES = 30 * 1024 * 1024, MAX_FILE = 3 * 1024 * 1024;
const queue = [], seen = new Set(), notes = [];
let total = 0, found = null;
const need = ['Первая публикация закрыта:', 'Черновик и предпросмотр доступны.'];
const assert = (ok, name) => { if (!ok) throw Error('BLOCKED: ' + name); console.log('PASS ' + name); };
async function read(url, max = MAX_FILE) {
  const r = await fetch(url, {
    method: 'GET', redirect: 'error',
    headers: { Accept: '*/*', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error('HTTP ' + r.status + ' at ' + new URL(url).pathname);
  const size = Number(r.headers.get('content-length') ?? 0);
  if (size > max) throw Error('Oversized response ' + new URL(url).pathname);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > max) throw Error('Oversized response body ' + new URL(url).pathname);
  return { text: bytes.toString('utf8'), type: r.headers.get('content-type') ?? '' };
}
const asset = value => {
  try {
    const u = new URL(value, ORIGIN + '/');
    if (u.origin !== ORIGIN || !/^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(u.pathname)) return null;
    return u.origin + u.pathname;
  } catch { return null; }
};
function enqueue(source) {
  // Vite emits both absolute /assets/foo.js and relative assets/foo.js in its entry and import maps.
  for (const hit of source.matchAll(/\/?assets\/[a-zA-Z0-9_.-]+\.js/g)) {
    const u = asset('/' + hit[0].replace(/^\//, ''));
    if (u && !seen.has(u) && !queue.includes(u)) queue.push(u);
  }
}
(async () => {
  const api = JSON.parse((await read(API + '/health', 80000)).text);
  console.log('API revision=' + String(api.commit ?? 'null'));
  assert(api.status === 'ok', 'API health');
  assert(api.commit === EXPECTED_OLD_SHA, 'expected live API remains old (no timer): review if changed');

  const market = JSON.parse((await read(MARKET + '/market/listings', 500000)).text);
  assert(Array.isArray(market.assets), 'public listings catalogue JSON');
  const catalogue = JSON.stringify(market.assets);
  assert(catalogue.includes('AITH'), 'AITH public listing remains');
  assert(!catalogue.includes('TYVN'), 'TYVN has not been published');

  const html = (await read(ORIGIN + '/', 700000)).text;
  assert(/<script\b/i.test(html), 'live Pages document serves JavaScript');
  // Initial HTML references the entry JS. Follow its import map to the Admin Listings lazy chunk.
  enqueue(html);
  const initial = queue.length;
  assert(initial > 0, 'hashed Vite assets found in live Pages HTML');

  while (queue.length && seen.size < MAX_FILES && total < MAX_BYTES && !found) {
    const url = queue.shift();
    if (seen.has(url)) continue; seen.add(url);
    const { text, type } = await read(url);
    total += Buffer.byteLength(text, 'utf8');
    if (!/(javascript|ecmascript|text\/plain)/i.test(type)) throw Error('Non-JavaScript asset: ' + new URL(url).pathname + ', type=' + type);
    if (need.every(x => text.includes(x))) {
      found = new URL(url).pathname;
      break;
    }
    enqueue(text);
  }
  console.log(JSON.stringify({ jsFilesInspected: seen.size, bytesInspected: total, entryScripts: initial, liveAdminChunk: found, truncated: queue.length > 0 && !found }));
  assert(Boolean(found), 'PR #585 first-publication guard and draft/preview warning are present in LIVE Pages JS');
  console.log('PUBLIC UI PASS only: no claim of protected server-side timer, authenticated browser behavior, Docker image or backup.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
