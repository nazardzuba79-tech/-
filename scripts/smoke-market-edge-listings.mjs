#!/usr/bin/env node
/**
 * Post-deploy smoke of the market-edge Worker and its managed-listings store.
 * Read-only: GET requests only; nothing is created, published or allocated.
 *
 *   node scripts/smoke-market-edge-listings.mjs <base-url> [--expect-version public-display-edge-v10] [--require-admin]
 *
 * LISTINGS_STORE_TOKEN (optional, from the environment only) proves the admin
 * store answers the server's secret. The token is never printed.
 * Exit code 0 = every check passed; the last line says whether the admin
 * store is connected, not configured, or refusing the token.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? '').replace(/\/$/, '');
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined; };
const expectVersion = flag('expect-version') ?? 'public-display-edge-v10';
const requireAdmin = flag('require-admin') === true;
const token = process.env.LISTINGS_STORE_TOKEN ?? '';
if (!/^https?:\/\/[^/?#]+$/.test(base)) { console.error('usage: smoke-market-edge-listings.mjs <base-url>'); process.exit(2); }

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
async function get(path, headers = {}) {
  const response = await fetch(`${base}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, headers: response.headers, text, json };
}

const health = await get('/health');
check('health version', health.json?.ok === true && health.json?.service === 'voltex-market-edge' && health.json?.version === expectVersion,
  `${health.json?.version ?? health.status} (expected ${expectVersion})`);

const catalogue = await get('/market/listings');
check('public listings catalogue', catalogue.status === 200 && Array.isArray(catalogue.json?.assets), `${catalogue.status}, ${catalogue.json?.assets?.length ?? '?'} published`);
check('public catalogue never carries a seed or owner allocation', !/"seed"|ownerAllocation/.test(catalogue.text));
check('public catalogue is readable cross-origin', catalogue.headers.get('access-control-allow-origin') === '*');

const nrx = await get('/market/nrx');
check('existing NRX edge unchanged', nrx.status === 200, String(nrx.status));

const browser = await get('/internal/listings', { Origin: 'https://voltextech.net' });
check('admin store refuses a browser Origin', [403, 503].includes(browser.status) && !browser.headers.get('access-control-allow-origin'), String(browser.status));

const anonymous = await get('/internal/listings');
const notConfigured = anonymous.status === 503 && anonymous.json?.error === 'store_not_configured';
check('admin store refuses a request without the secret', anonymous.status === 401 || notConfigured, String(anonymous.status));

let state = notConfigured ? 'NOT CONFIGURED (the Worker has no LISTINGS_STORE_TOKEN)' : 'configured (secret not tested here)';
if (token && !notConfigured) {
  const admin = await get('/internal/listings', { Authorization: `Bearer ${token}` });
  const connected = admin.status === 200 && Array.isArray(admin.json?.listings);
  check('admin store accepts the server secret', connected, String(admin.status));
  state = connected ? `CONNECTED (${admin.json.listings.length} listings)` : admin.status === 401 ? 'TOKEN MISMATCH' : `ERROR ${admin.status}`;
}
if (requireAdmin) check('admin store connected', state.startsWith('CONNECTED'), state);
console.log(`listings admin store: ${state}`);
process.exit(failed ? 1 : 0);
