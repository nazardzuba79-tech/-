// Local fixtures only. This is not a production identity, funding, or quote adapter.
import http from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, openSync, closeSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from '../services/stocks-global/server.mjs';
import { identityResolver } from '../services/stocks-global/identity.mjs';
import { createLocalStocksProxy } from '../services/stocks-global/local-proxy.mjs';
import { openAccounts } from '../services/stocks-global/accounts.mjs';
import { CATALOG, TIMEFRAMES } from '../services/stocks-global/catalog.mjs';
import { decimal, units, SimError } from '../services/stocks-global/engine.mjs';

export const FIXTURE_ISSUER = 'voltex-local-two-trader-fixture-v1';
export const FIXTURE_TRADERS = Object.freeze([
  Object.freeze({ issuer: FIXTURE_ISSUER, subject: 'fixture-trader-alpha' }),
  Object.freeze({ issuer: FIXTURE_ISSUER, subject: 'fixture-trader-beta' }),
]);
export const FIXTURE_STARTING_USDT = Object.freeze(['731.25000000', '129.87500000']);
export const FIXTURE_INSTRUMENTS = Object.freeze(['BYBIT:AAPLXUSDT', 'BYBIT:NVDAXUSDT']);
const VIEWER = 'fixture-viewer-gamma';
const MARKER = { schema: 1, fixtureOnly: true, issuer: FIXTURE_ISSUER, accounts: FIXTURE_TRADERS.map(x => x.subject), initialUsdt: FIXTURE_STARTING_USDT };
const CSP = "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const validPort = value => Number.isInteger(value) && value >= 0 && value <= 65535;
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const closeHttp = async server => {
  if (!server?.listening) return;
  server.closeIdleConnections();
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
};
const listen = async (server, port) => { server.listen(port, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
function guarded(req, origin) {
  return ['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    && req.headers.host === new URL(origin).host
    && (!req.headers.origin || req.headers.origin === origin)
    && (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']));
}
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw Error('FIXTURE_BODY_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function prepareDirectory(dataDir) {
  if (!isAbsolute(dataDir) || !/^voltex-stocks-two-trader-[A-Za-z0-9_-]+$/.test(basename(dataDir))) throw Error('DEDICATED_FIXTURE_DIRECTORY_REQUIRED');
  if (!existsSync(dirname(dataDir)) || lstatSync(dirname(dataDir)).isSymbolicLink()) throw Error('FIXTURE_PARENT_REQUIRED');
  if (!existsSync(dataDir)) {
    // Provision off to the side. A partial initialization is never adopted or reset.
    const staging = dataDir + '-initializing-' + randomBytes(8).toString('hex');
    mkdirSync(staging);
    const store = openAccounts(resolve(staging, 'accounts.sqlite'));
    try {
      for (let i = 0; i < FIXTURE_TRADERS.length; i++) {
        const account = store.forPrincipal(FIXTURE_TRADERS[i]);
        await account.transact(state => {
          state.wallets.USDT.cash = FIXTURE_STARTING_USDT[i];
          state.wallets.USDC.cash = '0.00000000';
        });
      }
    } finally { store.close(); }
    writeFileSync(resolve(staging, 'fixture-only.json'), JSON.stringify(MARKER, null, 2) + '\n', { flag: 'wx' });
    renameSync(staging, dataDir);
  }
  if (lstatSync(dataDir).isSymbolicLink() || !lstatSync(dataDir).isDirectory()) throw Error('DEDICATED_FIXTURE_DIRECTORY_REQUIRED');
  for (const file of ['fixture-only.json', 'accounts.sqlite']) {
    if (!existsSync(resolve(dataDir, file)) || !lstatSync(resolve(dataDir, file)).isFile() || lstatSync(resolve(dataDir, file)).isSymbolicLink()) throw Error('FIXTURE_DIRECTORY_NOT_RECOGNIZED');
  }
  if (JSON.stringify(JSON.parse(readFileSync(resolve(dataDir, 'fixture-only.json'), 'utf8'))) !== JSON.stringify(MARKER)) throw Error('FIXTURE_DIRECTORY_NOT_RECOGNIZED');
  return resolve(dataDir, 'accounts.sqlite');
}

function fixtureHub(audit) {
  let sequence = 0;
  const prices = new Map(FIXTURE_INSTRUMENTS.map((id, i) => [id, i === 0 ? '100' : '40']));
  const requireId = id => { if (!prices.has(id)) throw new SimError('SOURCE_UNAVAILABLE'); return CATALOG.find(i => i.id === id); };
  return {
    metrics: { fixtureOnly: true, providerCalls: 0 },
    setPrice(id, value) { requireId(id); if (units(value) <= 0n) throw Error('INVALID_FIXTURE_PRICE'); prices.set(id, decimal(units(value))); },
    async catalogue() { audit.catalogueReads++; return FIXTURE_INSTRUMENTS.map(id => ({ ...requireId(id), name: '[LOCAL FIXTURE] ' + requireId(id).name, domain: null, online: true, exists: true, fixtureOnly: true })); },
    async quote(id) {
      const item = requireId(id), at = Date.now(), sell = decimal(units(prices.get(id))), buy = decimal(units(sell) + units('0.1'));
      audit.quoteReads++;
      return { instrumentId: id, provider: item.provider, nativeCurrency: 'USDT', fixtureOnly: true,
        bid: sell, ask: buy, last: sell, verified: true, marketOpen: true, eventId: 'LOCAL-FIXTURE-' + (++sequence),
        timestamp: at, receivedAt: at, capacity: '100.00000000', prices: { USDT: { buy, sell } }, fx: {}, change24h: 0, volume: '0', multiplier: null };
    },
    async history(id, interval, before) {
      const item = requireId(id); if (!TIMEFRAMES.includes(interval)) throw new SimError('INVALID_TIMEFRAME');
      audit.historyReads++;
      const step = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400 }[interval];
      // The HTTP history API accepts milliseconds; candle.time is seconds.
      // An exclusive older cutoff must retain the immediately preceding bar,
      // including the chart's oldest.time * 1000 - 1 pagination request.
      const upperMs = before == null ? Date.now() : Number(before);
      if (!Number.isSafeInteger(upperMs) || upperMs < step * 40 * 1000 || upperMs > Date.now()) throw new SimError('INVALID_REQUEST');
      const anchor = (before == null ? Math.floor : Math.ceil)(upperMs / (step * 1000)) * step, price = Number(prices.get(id));
      return { instrumentId: id, interval, provider: item.provider, currency: 'USDT', fixtureOnly: true,
        receivedAt: Date.now(), delaySeconds: 0, candles: Array.from({ length: 40 }, (_, i) => ({ time: anchor - (40 - i) * step, open: price, high: price + 1, low: Math.max(price - 1, price / 2), close: price, volume: 0 })) };
    },
  };
}

function landing() {
  return `<!doctype html><html><meta charset="utf-8"><title>Stocks local fixtures</title><body style="background:#10151d;color:#edf2fa;font:16px system-ui;padding:32px"><h1>Stocks — LOCAL FIXTURES ONLY</h1><p>All quotes and identities are synthetic. No real market requests, deposits, or external orders.</p><p>Two independent existing fixture ledgers: alpha initially 731.25 USDT; beta initially 129.875 USDT. Restart preserves trades and balances.</p><p>The Wallet read seam uses the same fixture ledger; it is not the production DemoBalance integration.</p><p><a href="/__stocks_fixture/wallet" style="color:#ffe99a">Fixture Wallet</a> reads the current fixture session without creating another balance.</p><div id="accounts">${['alpha', 'beta', 'viewer'].map(account => `<button data-account="${account}" style="margin:8px;padding:12px">Open ${account}</button>`).join('')}</div><p id="error"></p><script>document.querySelectorAll('[data-account]').forEach(button=>button.onclick=async()=>{try{const r=await fetch('/__stocks_fixture/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:button.dataset.account})});if(!r.ok)throw Error('Local login failed');const data=await r.json();localStorage.setItem('exchange_token',data.token);location.assign('/stocks/BYBIT%3AAAPLXUSDT');}catch(e){document.querySelector('#error').textContent=e.message;}});</script></body></html>`;
}

function fixtureWalletPage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stocks Fixture Wallet</title><body style="background:#10151d;color:#edf2fa;font:16px system-ui;margin:0;padding:24px;overflow-wrap:anywhere"><main style="max-width:760px;margin:auto"><h1>Fixture Wallet — test only</h1><p>Reads the same local Stocks SQLite ledger. This is NOT the production DemoBalance integration and does not show real funds.</p><nav><a href="/stocks/BYBIT%3AAAPLXUSDT" style="color:#ffe99a">Stocks terminal</a> · <a href="/__stocks_fixture/" style="color:#ffe99a">Switch fixture account</a></nav><p id="wallet-status" role="status">Loading the current fixture session…</p><dl id="wallet-values" hidden><dt>Fixture account</dt><dd id="wallet-account"></dd><dt>Test USDT cash</dt><dd id="wallet-cash"></dd><dt>Available test USDT</dt><dd id="wallet-available"></dd><dt>Reserved test USDT</dt><dd id="wallet-reserved"></dd></dl><button id="wallet-refresh" type="button" style="padding:10px 18px">Refresh fixture balance</button><p>No funding, deposits, transfers or withdrawals are available here. A viewer has no trading ledger or spendable balance.</p></main><script>
let activeRequest, generation=0;
const status=document.querySelector('#wallet-status'), values=document.querySelector('#wallet-values'), refresh=document.querySelector('#wallet-refresh');
function addDecimal(a,b){const parse=value=>{if(!/^\\d+\\.\\d{8}$/.test(value))throw Error('Invalid fixture balance');return BigInt(value.replace('.',''));};const sum=(parse(a)+parse(b)).toString().padStart(9,'0');return sum.slice(0,-8)+'.'+sum.slice(-8);}
async function readWallet(){
  const current=++generation;activeRequest?.abort();const controller=new AbortController();activeRequest=controller;const token=localStorage.getItem('exchange_token');values.hidden=true;refresh.disabled=true;status.textContent='Loading the current fixture session…';
  const deadline=setTimeout(()=>controller.abort(),10000);
  try{
    if(!token)throw Error('Choose a fixture account on the local landing page.');
    const response=await fetch('/api/v1/demo/vta',{method:'GET',headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',signal:controller.signal});
    const result=await response.json();if(current!==generation||token!==localStorage.getItem('exchange_token'))return;
    if(!response.ok)throw Error(result.error||'Fixture balance unavailable');
    if(result.fixtureOnly!==true||result.fixtureCashSource!=='SAME_STOCKS_SQLITE_LEDGER'||result.liveDemoBalanceBridge!==false)throw Error('Unexpected wallet source; no balance displayed');
    const balance=result.balances.find(item=>item.asset==='USDT');if(!balance)throw Error('Fixture USDT balance unavailable');
    document.querySelector('#wallet-account').textContent=result.account.id;
    document.querySelector('#wallet-cash').textContent=addDecimal(balance.available,balance.locked);
    document.querySelector('#wallet-available').textContent=balance.available;
    document.querySelector('#wallet-reserved').textContent=balance.locked;
    values.hidden=false;status.textContent=result.account.active?'Same fixture ledger; read only.':'Viewer: no funded trading account.';
  }catch(error){if(current===generation)status.textContent=error.name==='AbortError'?'Fixture balance request interrupted. Refresh to retry.':error.message;}
  finally{clearTimeout(deadline);if(current===generation)refresh.disabled=false;}
}
refresh.onclick=readWallet;window.addEventListener('storage',event=>{if(event.key==='exchange_token')void readWallet();});window.addEventListener('pagehide',()=>{generation++;activeRequest?.abort();});void readWallet();
</script></body></html>`;
}

export async function startTwoTraderPreview({ dataDir, dist, port = 0, stocksPort = 0, authorityPort = 0 } = {}) {
  if (![port, stocksPort, authorityPort].every(validPort)) throw Error('INVALID_LOCAL_PORT');
  if (typeof dist !== 'string' || !isAbsolute(dist) || !existsSync(resolve(dist, 'index.html'))) throw Error('BUILT_FRONTEND_REQUIRED');
  if (typeof dataDir !== 'string') throw Error('DEDICATED_FIXTURE_DIRECTORY_REQUIRED');
  const accountsPath = await prepareDirectory(dataDir);
  const lockPath = resolve(dataDir, 'preview.lock'), lock = openSync(lockPath, 'wx');
  writeFileSync(lock, 'LOCAL FIXTURE PROCESS ' + process.pid + '\n'); closeSync(lock);
  const audit = { fixtureOnly: true, identityChecks: 0, quoteReads: 0, historyReads: 0, catalogueReads: 0, stocksPosts: 0, blockedFinancialWrites: 0, walletReads: 0, externalRequests: 0 };
  const sessions = new Map(), hub = fixtureHub(audit);
  let authority, stocks, gateway, authorityOrigin, origin, closed = false;
  const identify = req => {
    const session = sessions.get(req.headers.authorization);
    if (!session || Date.now() - session.at > 60 * 60 * 1000) { sessions.delete(req.headers.authorization); return null; }
    return session.subject;
  };
  const close = async () => {
    if (closed) return; closed = true;
    await closeHttp(gateway);
    await stocks?.close();
    await closeHttp(authority);
    sessions.clear();
    unlinkSync(lockPath);
  };
  try {
    // Verify existing account bindings without reinitializing anything.
    const store = openAccounts(accountsPath);
    try { for (const principal of FIXTURE_TRADERS) store.forPrincipal(principal, { existingOnly: true }).readState(); }
    finally { store.close(); }
    authority = http.createServer((req, res) => {
      if (!guarded(req, authorityOrigin)) return json(res, 403, { error: 'LOCAL_FIXTURE_ONLY' });
      audit.identityChecks++;
      const subject = identify(req);
      if (req.method !== 'GET' || req.url !== '/api/v1/me' || !subject) return json(res, 401, { error: 'AUTH_REQUIRED' });
      json(res, 200, { id: subject });
    });
    authorityOrigin = await listen(authority, authorityPort);
    const authenticate = identityResolver({ endpoint: authorityOrigin + '/api/v1/me', issuer: FIXTURE_ISSUER });
    stocks = await createServer({ port: stocksPort, accountsPath, authenticate, tradePrincipals: FIXTURE_TRADERS, autoPoll: true, hub, dist, accountDiagnostics: true });
    const stocksOrigin = `http://127.0.0.1:${stocks.port}`;
    const proxy = createLocalStocksProxy({ origin: () => origin, stocksOrigin: () => stocksOrigin });
    const distReal = realpathSync(dist);
    const readState = async req => {
      const response = await fetch(stocksOrigin + '/__stocks_global/state', { headers: { Authorization: req.headers.authorization }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      return { status: response.status, value: await response.json() };
    };
    gateway = http.createServer(async (req, res) => {
      try {
        if (!guarded(req, origin)) return json(res, 403, { error: 'LOCAL_FIXTURE_ONLY' });
        res.setHeader('Content-Security-Policy', CSP); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Stocks-Fixture-Only', 'true');
        const url = new URL(req.url, origin);
        if (url.pathname === '/__stocks_fixture/login' && req.method === 'POST') {
          if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'LOCAL_FIXTURE_ONLY' });
          const input = await body(req), subject = new Map([['alpha', FIXTURE_TRADERS[0].subject], ['beta', FIXTURE_TRADERS[1].subject], ['viewer', VIEWER]]).get(input?.account);
          if (!subject || Object.keys(input).length !== 1) return json(res, 400, { error: 'INVALID_FIXTURE_ACCOUNT' });
          if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
          const token = 'fixture-' + randomBytes(32).toString('hex'); sessions.set('Bearer ' + token, { subject, at: Date.now() });
          return json(res, 200, { token, fixtureOnly: true });
        }
        if (req.url.startsWith('/__stocks_global/')) { if (req.method === 'POST') audit.stocksPosts++; return proxy(req, res); }
        if (url.pathname.startsWith('/api/')) {
          const subject = identify(req); if (!subject) return json(res, 401, { error: 'AUTH_REQUIRED' });
          if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout') { sessions.delete(req.headers.authorization); return json(res, 200, { status: 'ok' }); }
          if (req.method !== 'GET') { audit.blockedFinancialWrites++; return json(res, 403, { error: 'FINANCIAL_WRITES_BLOCKED' }); }
          if (url.search) return json(res, 400, { error: 'FIXTURE_QUERY_FORBIDDEN' });
          if (url.pathname === '/api/v1/me') return json(res, 200, { id: subject, email: subject + '@fixture.invalid', isAdmin: false, role: 'USER', kycStatus: 'NONE' });
          if (url.pathname === '/api/v1/demo/vta') {
            audit.walletReads++; const state = await readState(req); if (state.status !== 200) return json(res, state.status, state.value);
            const wallet = state.value.wallets?.USDT, cash = wallet?.cash ?? '0.00000000', reserved = wallet?.reserved ?? '0.00000000';
            return json(res, 200, { fixtureOnly: true, fixtureCashSource: 'SAME_STOCKS_SQLITE_LEDGER', liveDemoBalanceBridge: false,
              account: { id: state.value.account.id, scope: 'SIMULATION_SPOT', cashPolicy: 'SHARED_DEMO_BALANCE', active: state.value.account.canTrade === true },
              asOf: Date.now(), valuationSource: 'VOLTORA_SIMULATION', totalValueUsd: cash,
              balances: [{ asset: 'USDT', available: decimal(units(cash) - units(reserved)), locked: reserved, priceUsd: '1', valueUsd: cash }], sales: [],
              conversionNote: 'Local fixture valuation only: one synthetic USDT is one fixture USD; no exchange rate claim.' });
          }
          if (url.pathname === '/api/v1/private-trading/access') return json(res, 200, { allowed: false, nativeAvailable: false });
          if (['/api/v1/balances', '/api/v1/futures/balances', '/api/v1/deposits/me', '/api/v1/withdrawals/me', '/api/v1/trades/me'].includes(url.pathname)) return json(res, 200, []);
          if (url.pathname === '/api/v1/wallet/overview') return json(res, 200, { real: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 }, estimated: [], estimatedTotalUsd: 0, estimatedBreakdown: [], valuationComplete: true, unpricedAssets: [], btcPriceUsd: null, fixtureOnly: true });
          if (url.pathname === '/api/v1/wallet/performance') return json(res, 200, { periods: {}, ageDays: 0, startedOn: null });
          return json(res, 404, { error: 'OUTSIDE_FIXTURE_SCOPE' });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        if (url.pathname === '/' || url.pathname === '/__stocks_fixture/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(landing()); }
        if (url.pathname === '/__stocks_fixture/wallet' && !url.search) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fixtureWalletPage()); }
        const path = resolve(distReal, '.' + decodeURIComponent(url.pathname));
        const inside = relative(distReal, path); if (inside.startsWith('..' + sep) || inside === '..' || isAbsolute(inside)) return json(res, 403, { error: 'LOCAL_FIXTURE_ONLY' });
        if (existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path).startsWith(distReal + sep) && MIME[extname(path)]) {
          res.writeHead(200, { 'Content-Type': MIME[extname(path)] }); return res.end(readFileSync(path));
        }
        if (!/^\/(stocks(?:\/|$)|wallet(?:\/|$)|login$)/.test(url.pathname)) return json(res, 404, { error: 'OUTSIDE_FIXTURE_SCOPE' });
        const banner = '<div id="local-stocks-fixture-banner" style="position:relative;z-index:99999;background:#332b10;color:#ffe99a;padding:8px;font:12px system-ui">LOCAL FIXTURES: synthetic prices and accounts; no market or funding connection. <a href="/__stocks_fixture/" style="color:inherit">Switch fixture account</a> · <a href="/__stocks_fixture/wallet" style="color:inherit">Fixture Wallet</a></div>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(readFileSync(resolve(distReal, 'index.html'), 'utf8').replace(/(<body[^>]*>)/i, '$1' + banner));
      } catch { if (!res.headersSent) json(res, 500, { error: 'LOCAL_FIXTURE_ERROR' }); else res.destroy(); }
    });
    origin = await listen(gateway, port);
    return { origin, stocksOrigin, fixtureOnly: true, accountsPath, audit, close, setFixturePrice: (id, value) => hub.setPrice(id, value), accountMetrics: () => stocks.accountMetrics() };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = Object.fromEntries(process.argv.slice(2).map(arg => { const at = arg.indexOf('='); if (!arg.startsWith('--') || at < 0) throw Error('Use --data-dir=ABSOLUTE --dist=ABSOLUTE --port=4440'); return [arg.slice(2, at), arg.slice(at + 1)]; }));
  if (Object.keys(options).some(key => !['data-dir', 'dist', 'port', 'stocks-port', 'authority-port'].includes(key))) throw Error('UNKNOWN_PREVIEW_OPTION');
  const app = await startTwoTraderPreview({ dataDir: options['data-dir'], dist: options.dist, port: Number(options.port ?? 4440), stocksPort: Number(options['stocks-port'] ?? 0), authorityPort: Number(options['authority-port'] ?? 0) });
  console.log(JSON.stringify({ fixtureOnly: true, preview: app.origin, marketData: 'SYNTHETIC_LOCAL_FIXTURES', externalRequests: 0 }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
