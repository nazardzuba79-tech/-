#!/usr/bin/env node
/**
 * Post-deploy smoke of the deposit-catalogue Worker's public read.
 * Read-only: GET/HEAD requests plus refused write attempts that the Worker
 * must reject before touching storage. Nothing is seeded or changed.
 *
 *   node scripts/smoke-deposit-public.mjs <worker-origin> [--site-origin https://voltextech.net]
 *
 * Prints only counts and asset/network names, never an address or a secret.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? '').replace(/\/$/, '');
const i = args.indexOf('--site-origin');
const site = i >= 0 ? args[i + 1] : 'https://voltextech.net';
if (!/^https?:\/\/[^/?#]+$/.test(base) || !/^https?:\/\/[^/?#]+$/.test(site)) { console.error('usage: smoke-deposit-public.mjs <worker-origin> [--site-origin <origin>]'); process.exit(2); }

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
async function call(path, init = {}) {
  const response = await fetch(`${base}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000), ...init });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, headers: response.headers, text, json };
}

const read = await call('/public/deposit-catalogue', { headers: { Origin: site } });
check('public catalogue answers the site', read.status === 200, String(read.status));
check('CORS names the site exactly', read.headers.get('access-control-allow-origin') === site, read.headers.get('access-control-allow-origin') ?? 'none');
check('revalidated on every open', read.headers.get('cache-control') === 'no-cache' && /^"[0-9a-f]{64}"$/.test(read.headers.get('etag') ?? ''));
const entries = Array.isArray(read.json?.entries) ? read.json.entries : null;
check('shape {version, entries}', typeof read.json?.version === 'string' && entries !== null);
check('active destinations only', !!entries && entries.every((e) => e.enabled === true && typeof e.address === 'string' && e.address.length > 0));
check('no private fields', !/"(baseline|overrides|status|revision)"/.test(read.text));

const again = await call('/public/deposit-catalogue', { headers: { Origin: site, 'If-None-Match': read.headers.get('etag') ?? '' } });
check('unchanged catalogue costs a 304', again.status === 304, String(again.status));
const foreign = await call('/public/deposit-catalogue', { headers: { Origin: 'https://example.invalid' } });
check('foreign origin refused without CORS', foreign.status === 403 && !foreign.headers.get('access-control-allow-origin'), String(foreign.status));
for (const method of ['PUT', 'POST', 'DELETE']) {
  const write = await call('/public/deposit-catalogue', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check(`public ${method} refused`, write.status === 405, String(write.status));
}
const privateRead = await call('/receiving-address-catalogue');
check('private catalogue needs the server secret', privateRead.status === 401, privateRead.status === 503 ? '503: the Worker has no DEPOSIT_CATALOGUE_STORE_TOKEN' : String(privateRead.status));

if (entries) console.log(`active destinations: ${entries.length} (${entries.map((e) => `${e.asset}/${e.networkId}`).join(', ') || 'none'})`);
process.exit(failed ? 1 : 0);
