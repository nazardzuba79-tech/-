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
// Strong from the Worker, or weak (W/"…") once Cloudflare has compressed the response: both are valid.
const etag = read.headers.get('etag') ?? '';
const version = /^(?:W\/)?"([0-9a-f]{64})"$/.exec(etag)?.[1] ?? null;
check('revalidated on every open', read.headers.get('cache-control') === 'no-cache' && version !== null, etag || 'no ETag');
const entries = Array.isArray(read.json?.entries) ? read.json.entries : null;
check('shape {version, entries}', typeof read.json?.version === 'string' && entries !== null);
check('active destinations only', !!entries && entries.every((e) => e.enabled === true && typeof e.address === 'string' && e.address.length > 0));
check('no private fields', !/"(baseline|overrides|status|revision)"/.test(read.text));

check('ETag names the catalogue version', version !== null && version === read.json?.version);
// Revalidate exactly as a browser does: the ETag as received, W/ included.
const again = await call('/public/deposit-catalogue', { headers: { Origin: site, 'If-None-Match': etag } });
check('unchanged catalogue costs a 304 (ETag sent back as received)', again.status === 304 && again.text === '', `${again.status}, sent ${etag.startsWith('W/') ? 'weak' : 'strong'}`);
check('304 keeps CORS, ETag and no-cache', again.headers.get('access-control-allow-origin') === site
  && again.headers.get('cache-control') === 'no-cache' && (again.headers.get('etag') ?? '').endsWith(`"${version}"`));
const other = etag.startsWith('W/') ? `"${version}"` : `W/"${version}"`;
const otherForm = await call('/public/deposit-catalogue', { headers: { Origin: site, 'If-None-Match': other } });
check('the other strong/weak form of the same version also costs a 304', otherForm.status === 304, String(otherForm.status));
const stale = await call('/public/deposit-catalogue', { headers: { Origin: site, 'If-None-Match': `W/"${'0'.repeat(64)}", "${'1'.repeat(64)}"` } });
check('a different version gets the full catalogue', stale.status === 200 && stale.json?.version === version, String(stale.status));
const broken = await call('/public/deposit-catalogue', { headers: { Origin: site, 'If-None-Match': `W/"${version}` } });
check('a malformed If-None-Match never produces a 304', broken.status === 200, String(broken.status));
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
