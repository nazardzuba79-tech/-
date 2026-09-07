/** LOCAL WALLET PRESENTATION QA ONLY.
 * Serves the real production-built frontend and unchanged JWT/session guard.
 * Account/market reads are explicit in-memory test fixtures, never real funds.
 * Every write is rejected, including portfolio snapshots and financial submits.
 * No production account, database, external market request, email or execution.
 * Only the app's existing public font/icon hosts are allowed for visual parity.
 *
 * Build the normal frontend (VITE_API_URL unset) and backend first, then:
 *   node scripts/qa-wallet-ux.cjs --self-test
 *   node scripts/qa-wallet-ux.cjs --port 4184
 * Optional QA_FRONTEND_DIST / QA_BACKEND_DIST select existing local builds.
 * Open the printed random bootstrap URL; actual /wallet and F5 then work.
 * This script does not launch/control a browser or change application markup.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { randomBytes, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || path.join(root, 'frontend/dist'));
const backendDist = path.resolve(process.env.QA_BACKEND_DIST || path.join(root, 'dist'));
const output = path.join(root, 'outputs/wallet-ux-qa');
const selfTest = process.argv.includes('--self-test');
const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : selfTest ? 0 : 4184;
assert.ok(Number.isInteger(port) && port >= 0 && port <= 65535, 'Valid loopback port required');
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
const express = require('express');
const jwt = require('jsonwebtoken');
const { requireAuth } = require(path.join(backendDist, 'api/middleware/auth.js'));
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function fixtures() {
  const spot = [
    { asset: 'BTC', available: '268.5', locked: '2.5', priceUsd: 80450.25, valueUsd: 21802017.75 },
    { asset: 'USDT', available: '32726245', locked: '0', priceUsd: 1, valueUsd: 32726245 },
    { asset: 'XRP', available: '1200000', locked: '0', priceUsd: 2.85, valueUsd: 3420000 },
    { asset: 'ETH', available: '0.00412', locked: '0', priceUsd: 4321.09, valueUsd: 17.8028908 },
    { asset: 'SOL', available: '0', locked: '0', priceUsd: 167.42, valueUsd: 0 },
  ];
  const futures = [{ asset: 'USDT', available: '2450.10', locked: '0', priceUsd: 1, valueUsd: 2450.1 }];
  const spotValueUsd = spot.reduce((sum, row) => sum + row.valueUsd, 0);
  const totalValueUsd = spotValueUsd + futures[0].valueUsd;
  const overview = {
    real: { spot, futures, spotValueUsd, futuresValueUsd: futures[0].valueUsd, totalValueUsd },
    presentation: null, displaySpotUsd: spotValueUsd, displayFuturesUsd: futures[0].valueUsd,
    displayTotalUsd: totalValueUsd, btcPriceUsd: spot[0].priceUsd,
  };
  const names = { BTC: 'Bitcoin', USDT: 'Tether', XRP: 'XRP', ETH: 'Ethereum', SOL: 'Solana' };
  const changes = { BTC: 1.24, USDT: 0, XRP: -2.13, ETH: 0.65, SOL: 3.45 };
  const rankings = spot.map((row, index) => ({ symbol: row.asset, name: names[row.asset], rank: index + 1,
    image: '', categories: [], price: row.priceUsd, changePercent24h: changes[row.asset],
    changePercent7d: null, changePercent30d: null, volume24h: 0, marketCap: null, sparkline: [] }));
  // Explicit QA chart fixture. This is not financial-service or return-method QA.
  const periods = Object.fromEntries(['7d', '30d', '90d', '1y', 'all'].map((period, i) => {
    const pnl = [432.25, 1284.5, 3682.1, 10982.05, 13420.75][i];
    const points = Array.from({ length: 8 }, (_, day) => ({ date: `2026-09-${String(day + 1).padStart(2, '0')}`,
      equity: totalValueUsd - pnl + pnl * day / 7 }));
    return [period, { period, available: true, startDate: points[0].date, endDate: points.at(-1).date,
      startEquity: totalValueUsd - pnl, endEquity: totalValueUsd, absolutePnl: pnl,
      percent: pnl / (totalValueUsd - pnl) * 100, points }];
  }));
  const deposits = [
    { id: 'qa-deposit-done', asset: 'USDT', chain: 'tron', txHash: null, amount: '12000', confirmations: 20, status: 'CREDITED', createdAt: '2026-09-07T12:00:00.000Z' },
    { id: 'qa-deposit-pending', asset: 'BTC', chain: 'bitcoin', txHash: null, amount: '0.0123', confirmations: 1, status: 'PENDING', createdAt: '2026-09-06T12:00:00.000Z' },
    { id: 'qa-deposit-rejected', asset: 'USDT', chain: 'tron', txHash: null, amount: '15', confirmations: 20, status: 'BELOW_MINIMUM', createdAt: '2026-09-05T12:00:00.000Z' },
  ];
  const withdrawals = [
    { id: 'qa-withdraw-done', asset: 'XRP', network: 'native', toAddress: 'LOCAL-QA-NOT-A-REAL-ADDRESS', amount: '3500', status: 'SENT', rejectionReason: null, createdAt: '2026-09-07T10:00:00.000Z' },
    { id: 'qa-withdraw-pending', asset: 'USDT', network: 'TRC20', toAddress: 'LOCAL-QA-NOT-A-REAL-ADDRESS', amount: '250', status: 'PENDING', rejectionReason: null, createdAt: '2026-09-06T10:00:00.000Z' },
    { id: 'qa-withdraw-rejected', asset: 'ETH', network: 'native', toAddress: 'LOCAL-QA-NOT-A-REAL-ADDRESS', amount: '0.001', status: 'REJECTED', rejectionReason: 'Isolated QA fixture', createdAt: '2026-09-05T10:00:00.000Z' },
  ];
  const trades = [
    { id: 'qa-history-buy', pair: 'BTC/USDT', side: 'BUY', price: '80450.25', quantity: '0.1', executedAt: '2026-09-07T08:00:00.000Z' },
    { id: 'qa-history-sell', pair: 'XRP/USDT', side: 'SELL', price: '2.85', quantity: '1500', executedAt: '2026-09-06T08:00:00.000Z' },
  ];
  return { overview, rankings, performance: { ageDays: 400, startedOn: '2025-08-04', periods }, deposits, withdrawals, trades };
}

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Build the normal frontend first');
  fs.mkdirSync(output, { recursive: true });
  const run = fs.mkdtempSync(path.join(output, 'run-'));
  const fixture = fixtures();
  const initialHash = sha(fixture);
  const userId = 'local-wallet-qa-viewer';
  const sid = 'local-wallet-' + randomBytes(12).toString('hex');
  const session = { id: sid, userId, revokedAt: null, lastSeenAt: new Date() };
  const db = { session: {
    async findUnique({ where }) { return where.id === sid ? session : null; },
    async update({ data }) { Object.assign(session, data); return session; },
  } };
  const token = jwt.sign({ sub: userId, sid }, process.env.JWT_SECRET, { expiresIn: '12h' });
  const auth = requireAuth(db);
  const app = express();
  app.disable('x-powered-by');
  const journal = [], bootstrapKey = randomBytes(20).toString('hex');
  let origin;
  const snapshot = () => ({ environment: 'LOCAL TEST FIXTURES ONLY', fixtureSha256: sha(fixture), initialHash,
    unchanged: sha(fixture) === initialHash, writes: 'All denied; never financial success', requests: journal });
  const persist = () => fs.writeFileSync(path.join(run, 'journal.json'), JSON.stringify(snapshot(), null, 2));
  app.use((req, res, next) => {
    const ownOrigin = origin || `http://127.0.0.1:${port}`;
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        || req.headers.host !== new URL(ownOrigin).host
        || (req.headers.origin && req.headers.origin !== ownOrigin)
        || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Loopback same-origin QA only' });
    // Blocks accidental production VITE_API_URL and all financial network.
    // Only unchanged public Google fonts and CryptoIcon hosts are allowed.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://cdn.jsdelivr.net https://raw.githubusercontent.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const requestPath = req.originalUrl.split('?')[0], method = req.method;
    res.on('finish', () => {
      if (!requestPath.startsWith('/api/') && requestPath !== '/__qa/state') return;
      journal.push({ at: new Date().toISOString(), method, path: requestPath, status: res.statusCode });
      persist();
    });
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(403).json({ error: 'LOCAL QA: financial submissions and all writes are disabled.' });
    next();
  });
  app.get('/api/v1/me', auth, (_req, res) => res.json({ id: userId, displayName: 'Local Wallet QA',
    email: 'wallet-qa@example.invalid', isAdmin: false, avatarUrl: null, kycStatus: 'NOT_STARTED',
    twoFactorEnabled: false, createdAt: '2025-08-04T00:00:00.000Z' }));
  app.get('/api/v1/wallet/overview', auth, (_req, res) => res.json(fixture.overview));
  app.get('/api/v1/wallet/performance', auth, (_req, res) => res.json(fixture.performance));
  app.get('/api/v1/balances', auth, (_req, res) => res.json(fixture.overview.real.spot));
  app.get('/api/v1/futures/balances', auth, (_req, res) => res.json(fixture.overview.real.futures));
  app.get('/api/v1/wallet/portfolio-history', auth, (_req, res) => res.json({ points: [] }));
  app.get('/api/v1/deposits/me', auth, (_req, res) => res.json(fixture.deposits));
  app.get('/api/v1/withdrawals/me', auth, (_req, res) => res.json(fixture.withdrawals));
  app.get('/api/v1/trades/me', auth, (_req, res) => res.json(fixture.trades));
  app.get(['/api/v1/products', '/api/v1/purchases/me'], auth, (_req, res) => res.json([]));
  app.get('/api/v1/deposit-chains', auth, (_req, res) => res.json([{ chain: 'tron', nativeAsset: 'TRX', tokens: ['USDT'] }]));
  app.get('/api/v1/deposit-address/tron', auth, (_req, res) => res.json({ chain: 'tron',
    address: 'QA-ONLY-NOT-A-VALID-DEPOSIT-ADDRESS', supportedAssets: ['USDT'], note: 'Local test fixture. Never send funds.' }));
  app.get('/api/v1/market/external/rankings', (_req, res) => res.json({ source: 'LOCAL TEST FIXTURE', rankings: fixture.rankings }));
  app.get('/api/v1/support/conversations/mine', auth, (_req, res) => res.json({ conversation: null, messages: [] }));
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', environment: 'LOCAL TEST FIXTURES ONLY' }));
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside isolated Wallet QA scope', path: req.path }));
  app.get('/__qa/bootstrap/:key', (req, res) => {
    if (req.params.key !== bootstrapKey) return res.sendStatus(404);
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>LOCAL WALLET QA</title><script>if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('exchange_token',${JSON.stringify(token)});localStorage.setItem('exchange_lang','ru');localStorage.removeItem('exchange_hide_balance');location.replace('/wallet');}</script>`);
  });
  app.get('/__qa/state', auth, (_req, res) => res.json(snapshot()));
  app.use(express.static(dist, { index: false, redirect: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const ready = { status: 'READY', origin, bootstrap: `${origin}/__qa/bootstrap/${bootstrapKey}`, run,
    fixture: 'LOCAL ONLY: BTC271 (2.5 locked), USDT32726245, XRP1200000, ETH0.00412, SOL0',
    frontendIndexSha256: sha(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')) };
  fs.writeFileSync(path.join(run, 'ready.json'), JSON.stringify(ready, null, 2));
  console.log(JSON.stringify(ready));
  if (!selfTest) { persist(); return; }
  const checks = [];
  const call = async (route, method = 'GET', authorized = true, extraHeaders = {}) => {
    const res = await fetch(origin + route, { method, headers: { ...(authorized ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders } });
    return { status: res.status, headers: res.headers, raw: await res.text() };
  };
  try {
    assert.equal((await call('/api/v1/wallet/overview', 'GET', false)).status, 401); checks.push('actual JWT/session guard rejects unauthenticated reads');
    const overview = await call('/api/v1/wallet/overview');
    assert.equal(overview.status, 200); assert.deepEqual(JSON.parse(overview.raw), fixture.overview); checks.push('authoritative fixture overview values returned without normalization');
    assert.equal(Number(fixture.overview.real.spot[0].available) + Number(fixture.overview.real.spot[0].locked), 271);
    assert.equal(fixture.overview.real.spot[1].available, '32726245'); assert.equal(fixture.overview.real.spot[2].available, '1200000'); checks.push('large quantities, locked amount, dust and zero fixtures intact');
    for (const route of ['/api/v1/wallet/performance', '/api/v1/balances', '/api/v1/futures/balances', '/api/v1/deposit-chains', '/api/v1/deposit-address/tron']) assert.equal((await call(route)).status, 200);
    checks.push('existing modal and performance read contracts respond');
    for (const [route, count] of [['/api/v1/deposits/me', 3], ['/api/v1/withdrawals/me', 3], ['/api/v1/trades/me', 2]]) {
      const response = await call(route); assert.equal(response.status, 200); assert.equal(JSON.parse(response.raw).length, count);
    }
    checks.push('populated read-only history covers incoming/outgoing, pending/rejected/completed transactions');
    for (const [method, route] of [['POST', '/api/v1/withdrawals'], ['POST', '/api/v1/futures/transfer'], ['POST', '/api/v1/wallet/portfolio-snapshot'], ['DELETE', '/api/v1/balances'], ['PUT', '/api/v1/me']]) {
      const response = await call(route, method); assert.equal(response.status, 403); assert.match(response.raw, /all writes are disabled/);
    }
    checks.push('withdrawal, transfer, snapshot and arbitrary writes denied, never fake success');
    assert.equal((await call('/api/v1/balances', 'GET', true, { Origin: 'https://voltextech.net' })).status, 403); checks.push('cross-origin use rejected');
    assert.equal(sha(fixture), initialHash); checks.push('fixture financial values unchanged after denied submissions');
    for (const route of ['/wallet', '/wallet?action=deposit', '/wallet?action=withdraw', '/wallet?action=transfer']) {
      const response = await call(route); assert.equal(response.status, 200); assert.equal(sha(response.raw), ready.frontendIndexSha256);
      assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    }
    checks.push('direct-load/F5/deep links serve exact built entry, same-origin network restriction');
    assert.ok(journal.some(entry => entry.path === '/api/v1/withdrawals' && entry.method === 'POST' && entry.status === 403));
    checks.push('journal records actual original request paths/status without tokens or request bodies');
    const report = { status: 'PASS', checks, ...snapshot() };
    fs.writeFileSync(path.join(run, 'self-test.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { persist(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
