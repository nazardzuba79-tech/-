import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openStore } from './store.mjs';
import { TwelveDataQuotes } from './provider.mjs';
import { check, SimError, SYMBOLS, submit, cancel, configure, setTestBalances, applyQuote } from './engine.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const API = '/__stocks_simulator/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export async function createSimulatorServer({ port = 4436, dataPath, dist = resolve(ROOT, 'frontend/dist'), provider = new TwelveDataQuotes(), now = Date.now, autoPoll = true } = {}) {
  check(dataPath, 'LOCAL_LEDGER_PATH_REQUIRED');
  const store = await openStore(dataPath, { now });
  const token = randomBytes(32).toString('hex'); let selected = 'AAPL', refreshing = false, lastStart = 0, cursor = 0;
  const sourceErrors = {}; let address;
  const status = () => ({ ...store.read(), source: { mode: provider.apiKey ? 'personal-key' : 'public-aapl-trial', errors: { ...sourceErrors } } });
  async function refresh(symbol = selected) {
    if (refreshing || now() - lastStart < 8000) return;
    refreshing = true; lastStart = now();
    try {
      const quote = await provider.quote(symbol);
      await store.transact((state, timestamp) => applyQuote(state, quote, timestamp)); delete sourceErrors[symbol];
    } catch (error) {
      sourceErrors[symbol] = error instanceof SimError ? error.code : 'PROVIDER_UNAVAILABLE';
      // A failed refresh invalidates execution admission immediately; keep last price for inspection only.
      await store.transact(state => { if (state.quotes[symbol]) state.quotes[symbol].receivedAt = 0; }).catch(() => {});
    } finally { refreshing = false; }
  }
  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body));
  }
  const server = http.createServer(async (req, res) => {
    try {
      check(req.headers.host === `127.0.0.1:${address.port}`, 'HOST_FORBIDDEN');
      check(!req.headers.origin || req.headers.origin === `http://127.0.0.1:${address.port}`, 'ORIGIN_FORBIDDEN');
      check(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'ORIGIN_FORBIDDEN');
      const url = new URL(req.url, `http://127.0.0.1:${address.port}`);
      if (url.pathname.startsWith(API)) {
        if (req.method === 'GET' && url.pathname === API + 'state') {
          const symbol = url.searchParams.get('symbol'); if (symbol) { check(SYMBOLS.includes(symbol), 'INVALID_PAIR'); selected = symbol; }
          send(res, 200, { ...status(), token }); return;
        }
        if (req.method === 'GET' && url.pathname === API + 'health') { send(res, 200, { ok: true, isolated: true, version: 1 }); return; }
        check(req.method === 'POST', 'METHOD_NOT_ALLOWED');
        const supplied = req.headers['x-stocks-token'];
        check(typeof supplied === 'string' && supplied.length === token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)), 'TOKEN_REQUIRED');
        check(req.headers['content-type']?.startsWith('application/json'), 'JSON_REQUIRED');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; check(size <= 8192, 'BODY_TOO_LARGE'); chunks.push(chunk); }
        let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SimError('INVALID_JSON'); }
        let result;
        if (url.pathname === API + 'orders') result = (await store.transact((s, t) => submit(s, input, t))).result;
        else if (url.pathname === API + 'cancel') result = (await store.transact((s, t) => cancel(s, input.id, t))).result;
        else if (url.pathname === API + 'settings') await store.transact(s => configure(s, input));
        else if (url.pathname === API + 'balances') await store.transact((s, t) => setTestBalances(s, input, t));
        else if (url.pathname === API + 'refresh') { check(SYMBOLS.includes(input.symbol), 'INVALID_PAIR'); selected = input.symbol; await refresh(selected); }
        else throw new SimError('ROUTE_NOT_FOUND');
        send(res, 200, { ...status(), result }); return;
      }
      // Do not proxy /api, /v1 or any other financial/backend route.
      check(req.method === 'GET' && !/^\/(api|v1|v2|admin)(\/|$)/.test(url.pathname), 'ROUTE_NOT_FOUND');
      let relative; try { relative = decodeURIComponent(url.pathname); } catch { throw new SimError('ROUTE_NOT_FOUND'); }
      let path = resolve(dist, '.' + relative); check(path.startsWith(dist + sep) || path === dist, 'ROUTE_NOT_FOUND');
      if (!extname(path)) path = resolve(dist, 'index.html');
      const info = await stat(path); check(info.isFile(), 'ROUTE_NOT_FOUND');
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); res.end(await readFile(path));
    } catch (error) { if (!res.headersSent) send(res, error.code === 'ENOENT' || error.code === 'ROUTE_NOT_FOUND' ? 404 : error instanceof SimError ? 422 : 500, { error: error instanceof SimError ? error.code : 'LOCAL_SERVICE_ERROR' }); else res.end(); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); }).catch(async e => { await store.close(); throw e; });
  address = server.address();
  const timer = autoPoll ? setInterval(() => {
    const s = store.read(); const symbols = [...new Set([selected, ...s.orders.filter(o => o.status === 'OPEN').map(o => o.symbol), ...Object.values(s.positions).filter(p => Number(p.quantity) > 0).map(p => p.symbol)])];
    const eligible = provider.apiKey ? symbols : symbols.filter(x => x === 'AAPL');
    if (eligible.length) void refresh(eligible[cursor++ % eligible.length]);
  }, 10_000) : null;
  if (autoPoll) void refresh();
  return { server, store, port: address.port, refresh, async close() { if (timer) clearInterval(timer); await new Promise(ok => server.close(ok)); while (refreshing) await new Promise(ok => setTimeout(ok, 20)); await store.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The launcher requires an explicit path outside financial storage; never reads DATABASE_URL.
  const dataPath = process.env.STOCKS_SIM_DATA;
  check(dataPath && !/\.sqlite$|\.db$/i.test(dataPath), 'LOCAL_LEDGER_PATH_REQUIRED');
  const app = await createSimulatorServer({ port: Number(process.env.STOCKS_SIM_PORT || 4436), dataPath: resolve(dataPath), provider: new TwelveDataQuotes({ apiKey: process.env.TWELVE_DATA_API_KEY || '' }) });
  console.log(`Stocks local simulator: http://127.0.0.1:${app.port}/stocks/XNGS%3AAAPL`);
  let closing = false; const stop = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
