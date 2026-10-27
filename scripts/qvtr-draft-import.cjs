#!/usr/bin/env node
'use strict';
/** QAVENTRA (QVTR/USDT) — one separate private draft, never ECLAVO.
 * Read-only preflight is the default. With explicit owner approval, --create
 * creates at most one private QVTR draft; no publish, timer, balance or trade.
 * Requires VOLTEX_API and VOLTEX_ADMIN_TOKEN from the authorized environment.
 * ECLAVO ECLV / 2026-11-03 is intentionally not an old-symbol conflict.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.resolve(__dirname, '../config/test-markets/qvtr-20261028.draft.json');
const MIN_LEAD_MS = 60_000;

const base = (name, value) => {
  const url = new URL(value);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.search || url.hash) throw new Error(`${name} must be an https origin`);
  return url.origin;
};
/** The stored draft without what the store assigns on creation. */
const comparable = (draft) => { const { simulationProfile: _p, wickModel: _w, ...rest } = draft; return rest; };
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])])) : value;
const state = (listing) => listing.activeVersion === null ? 'draft (never published)'
  : `published v${listing.activeVersion}, timer ${listing.countdown ? listing.countdown.state : 'none (runs)'}`;

async function main() {
  const create = process.argv.includes('--create');
  const token = process.env.VOLTEX_ADMIN_TOKEN || '';
  if (!process.env.VOLTEX_API || !token) throw new Error('set VOLTEX_API and VOLTEX_ADMIN_TOKEN');
  const api = base('VOLTEX_API', process.env.VOLTEX_API);
  const market = process.env.VOLTEX_MARKET ? base('VOLTEX_MARKET', process.env.VOLTEX_MARKET) : null;
  const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { schemaVersion: _schema, ...config } = file;
  const call = async (p, init = {}) => {
    const response = await fetch(`${api}/api/v1${p}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) throw new Error(`admin access refused (${response.status}): use a current admin session token`);
    return { status: response.status, body };
  };

  console.log(`candidate: ${file.name} ${file.symbol}/USDT, ${file.listingAt} (display ${file.displayTimeZone}), price ${file.initialPrice}, seed ${file.seed} (${file.seedMode}), tradable ${file.tradable}`);
  const listed = await call('/admin/listings');
  if (listed.status !== 200 || !Array.isArray(listed.body?.listings)) throw new Error(`GET /admin/listings answered ${listed.status} ${JSON.stringify(listed.body)?.slice(0, 200)}`);
  const listings = listed.body.listings;
  const serverTime = Number(listed.body.serverTime) || Date.now();
  console.log(`admin store: ${listings.length} listing(s): ${listings.map((l) => l.symbol).join(', ') || '—'}`);
  const qvtr = listings.filter((l) => l.symbol === file.symbol);
  const seedElsewhere = listings.filter((l) => l.symbol !== file.symbol && (l.draft?.seed === file.seed || l.active?.seed === file.seed));
  for (const l of qvtr) console.log(`  ${file.symbol}: ${l.id} — ${state(l)}, draft revision ${l.draftRevision}, ${same(comparable(l.draft), file) ? 'SAME configuration as the file' : 'DIFFERENT configuration from the file'}`);
  for (const l of seedElsewhere) console.log(`  seed ${file.seed} also used by ${l.symbol} (${l.id})`);
  const left = Date.parse(file.listingAt) - serverTime;
  console.log(`time to the listing instant: ${(left / 3_600_000).toFixed(1)} h by the server clock`);
  if (market) {
    const response = await fetch(`${market}/market/listings`, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
    const pairs = ((await response.json().catch(() => null))?.assets || []).map((a) => a.pair);
    console.log(`public catalogue: ${pairs.join(', ') || '—'}`);
  }

  const conflict = qvtr.some((l) => !same(comparable(l.draft), file)) || qvtr.length > 1 || seedElsewhere.length > 0 || left < MIN_LEAD_MS;
  if (!create) {
    console.log(conflict ? 'PREFLIGHT: STOP — resolve the lines above first' : qvtr.length ? 'PREFLIGHT: OK — the draft is already there, nothing to import' : 'PREFLIGHT: OK — no QVTR; run again with --create to import one private draft');
    return conflict ? 2 : 0;
  }
  if (conflict) { console.log('NOT CREATED: stop — resolve the lines above first'); return 2; }
  if (qvtr.length === 1) { console.log(`NOT CREATED: already imported as ${qvtr[0].id}; nothing sent`); return 0; }

  const created = await call('/admin/listings', { method: 'POST', body: JSON.stringify({ config }) });
  if (created.status !== 201) {
    console.log(`NOT CREATED: ${created.status} ${created.body?.error ?? ''} ${created.body?.message ?? ''}`.trim());
    return created.status === 409 ? 2 : 1;
  }
  const draft = created.body.draft;
  if (!same(comparable(draft), file)) { console.log(`CREATED ${created.body.id}, BUT the stored draft differs from the file — check it before anything else`); return 3; }
  console.log(`CREATED one private draft ${created.body.id} (revision ${created.body.draftRevision}), seed ${draft.seed}, profile ${draft.simulationProfile}; not published, no timer`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
