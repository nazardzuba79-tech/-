#!/usr/bin/env node
'use strict';
/**
 * ECLAVO (ECLV/USDT): ONE private Draft in Admin → Listings from
 * config/test-markets/eclv-20261103.draft.json, through the same request the
 * form sends (POST /api/v1/admin/listings). It never publishes, never touches
 * a timer and never edits or deletes an existing listing.
 *
 * Read-only by default (preflight): what the store already holds for ECLV and
 * the old candidate ZRNTH, whether the seed is used elsewhere, the public
 * catalogue, and the time left before the listing instant.
 *
 *   VOLTEX_API=https://api.voltextech.net VOLTEX_MARKET=https://market.voltextech.net \
 *   VOLTEX_ADMIN_TOKEN=<an admin session token> node scripts/eclv-draft-import.cjs [--create]
 *
 * --create (only with the owner's go):
 *   - an ECLV listing exists → nothing is sent; same configuration = already
 *     imported (exit 0), anything else = stop (exit 2);
 *   - a ZRNTH listing exists → stop (exit 2): the owner decides about it;
 *   - otherwise exactly one POST; the stored draft must equal the file, seed
 *     included (exit 3 if not).
 * Exit 1: configuration, network or authorisation problem. The token is read
 * from the environment only and is never printed.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.resolve(__dirname, '../config/test-markets/eclv-20261103.draft.json');
const OLD_SYMBOLS = ['ZRNTH'];
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
  const eclv = listings.filter((l) => l.symbol === file.symbol);
  const old = listings.filter((l) => OLD_SYMBOLS.includes(l.symbol));
  const seedElsewhere = listings.filter((l) => l.symbol !== file.symbol && (l.draft?.seed === file.seed || l.active?.seed === file.seed));
  for (const l of eclv) console.log(`  ${file.symbol}: ${l.id} — ${state(l)}, draft revision ${l.draftRevision}, ${same(comparable(l.draft), file) ? 'SAME configuration as the file' : 'DIFFERENT configuration from the file'}`);
  for (const l of old) console.log(`  old candidate ${l.symbol}: ${l.id} — ${state(l)}`);
  for (const l of seedElsewhere) console.log(`  seed ${file.seed} also used by ${l.symbol} (${l.id})`);
  const left = Date.parse(file.listingAt) - serverTime;
  console.log(`time to the listing instant: ${(left / 3_600_000).toFixed(1)} h by the server clock`);
  if (market) {
    const response = await fetch(`${market}/market/listings`, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
    const pairs = ((await response.json().catch(() => null))?.assets || []).map((a) => a.pair);
    console.log(`public catalogue: ${pairs.join(', ') || '—'}`);
  }

  const conflict = eclv.some((l) => !same(comparable(l.draft), file)) || eclv.length > 1 || old.length > 0 || seedElsewhere.length > 0 || left < MIN_LEAD_MS;
  if (!create) {
    console.log(conflict ? 'PREFLIGHT: STOP — resolve the lines above first' : eclv.length ? 'PREFLIGHT: OK — the draft is already there, nothing to import' : 'PREFLIGHT: OK — no ECLV / ZRNTH; run again with --create to import one private draft');
    return conflict ? 2 : 0;
  }
  if (conflict) { console.log('NOT CREATED: stop — resolve the lines above first'); return 2; }
  if (eclv.length === 1) { console.log(`NOT CREATED: already imported as ${eclv[0].id}; nothing sent`); return 0; }

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
