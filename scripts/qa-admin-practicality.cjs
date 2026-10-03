/** Actual built /admin UI with synthetic localhost APIs only. No production access.
 * QA_FRONTEND_DIST chooses the frozen baseline/candidate bundle; QA_VARIANT labels evidence.
 * QA_PREVIEW=1 serves the same fixtures on QA_PORT (default 4402) until stopped.
 * Browser network denies every request outside this local server, including WebSockets.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const variant = process.env.QA_VARIANT || 'after';
const dist = path.resolve(root, process.env.QA_FRONTEND_DIST || 'frontend/dist');
const out = path.resolve(root, process.env.QA_OUT || `output/admin-practicality/${variant}`);
fs.mkdirSync(out, { recursive: true });
const now = new Date().toISOString();
const ago = hours => new Date(Date.now() - hours * 3600000).toISOString();
const state = { failures: {}, calls: [], writes: [], unexpected: [], delays: {}, catalogueRevision: 1, session: 'admin', backend: 'modern' };
const users = Array.from({ length: Number(process.env.QA_USERS || 40) }, (_, i) => ({
  id: `qa-user-${i + 1}`, email: `client.${String(i + 1).padStart(2, '0')}@example.invalid`, displayName: `Тестовый пользователь ${i + 1}`,
  isAdmin: false, role: 'USER', createdAt: ago(i < 3 ? i + 1 : 48 + i), registrationIp: null, lastLoginAt: ago(i + 1),
  isBlocked: i === 7, blockedAt: i === 7 ? ago(12) : null, blockedReason: i === 7 ? 'Тестовая проверка' : null,
  kycStatus: i < 4 ? 'PENDING' : i < 10 ? 'APPROVED' : 'NOT_STARTED',
  adminPassword: null, password: null,
  balances: [{ asset: 'USDT', available: `${1500 + i * 125}.25000000`, locked: `${i * 10}.00000000` }, { asset: 'BTC', available: '0.02500000', locked: '0.00100000' }],
  latestKyc: i < 4 ? { id: `qa-kyc-${i + 1}`, userId: `qa-user-${i + 1}`, fullName: `Тестовый клиент ${i + 1}`, country: 'UA', dateOfBirth: '1990-01-01', documentType: 'PASSPORT', status: 'PENDING', createdAt: ago(i + 1), documentUrl: null, reviewedAt: null, rejectionReason: null } : null,
}));
const admin = { id: 'qa-admin', email: 'operator@example.invalid', displayName: 'Оператор', isAdmin: true, role: 'ADMIN', kycStatus: 'APPROVED' };
const wallets = [['bitcoin', 'BTC', []], ['ethereum', 'ETH', ['USDT', 'USDC']], ['tron', 'TRX', ['USDT']], ['solana', 'SOL', []], ['bsc', 'BNB', []], ['ton', 'TON', []]].map(([chain, nativeAsset, tokens]) => ({
  chain, nativeAsset, tokens, nativeDepositsSupported: chain !== 'tron', address: chain === 'ethereum' || chain === 'bsc' ? `0x${'1'.repeat(40)}` : `FIXTURE_${chain.toUpperCase()}_ADDRESS_NOT_FOR_PAYMENT`,
  defaultAddress: null, envConfigured: true, isOverridden: true, updatedAt: now, updatedByAdminId: admin.id,
}));
const withdrawals = Array.from({ length: 8 }, (_, i) => ({ id: `qa-withdrawal-${i + 1}`, userId: users[i].id, userEmail: users[i].email, asset: i === 1 ? 'BTC' : 'USDT', network: i === 1 ? 'bitcoin' : 'ethereum', chain: i === 1 ? 'bitcoin' : 'ethereum', toAddress: wallets[i === 1 ? 0 : 1].address, amount: i === 1 ? '0.01500000' : '750.50000000', status: ['PENDING', 'PENDING', 'APPROVED', 'SENT'][i % 4], createdAt: ago(i + 1), updatedAt: now, txHash: i % 4 === 3 ? 'ab'.repeat(32) : null, rejectionReason: null, balanceHeld: true }));
const transfer = (id, index, status = 'READY') => ({ id, userId: status === 'UNATTRIBUTED' ? null : users[index].id, userEmail: status === 'UNATTRIBUTED' ? null : users[index].email, chain: 'tron', asset: 'USDT', txHash: `${index}${'ab'.repeat(31)}0`, amount: status === 'AWAITING_TOPUP' ? '275.00' : '650.00', confirmations: 24, minConfirmations: 20, finalized: true, verified: true, networkConfirmed: true, verifyError: null, recipientAddress: wallets[2].address, blockTimestamp: ago(2), firstDetectedAt: ago(1), creditedAt: null, batchId: null, revision: 1, source: 'WATCHER', state: status, claims: [], ignoredAt: null, ignoredReason: null, ignoredNote: null, ignoredByAdminId: null });
const rows = [transfer('qa-transfer-1', 0), transfer('qa-transfer-2', 1, 'AWAITING_TOPUP'), transfer('qa-transfer-3', 2, 'UNATTRIBUTED')];
const packages = rows.slice(0, 2).map(row => ({ key: `${row.userId}|tron|USDT`, userId: row.userId, userEmail: row.userEmail, chain: 'tron', asset: 'USDT', transfers: [row], total: row.amount, unconfirmedTotal: '0', unconfirmedCount: 0, minDepositUsd: 500, usdValue: row.amount, usdPolicy: 'USD_PEGGED_POLICY', priceUsd: '1', pricedAt: now, minimumReached: row.state === 'READY', remaining: row.state === 'READY' ? '0' : '225.00', remainingUsd: row.state === 'READY' ? '0' : '225.00', state: row.state, reviewReason: null, token: 'fixture-preview-token', transferCount: 1, latestAt: ago(1) }));
const watcher = { chain: 'tron', enabled: true, running: false, lastRunStartedAt: ago(1), lastRunFinishedAt: ago(1), lastSuccessAt: ago(1), lastRunOk: true, lastRunTrigger: 'SCHEDULE', lastScheduledRunAt: ago(1), lastAdminOpenRunAt: null, nextScheduledRunAt: now, adminOpenDueToday: false, lastRunSummary: { newTransfers: 2, pagesRead: 1, providerCalls: 1 }, providerStatus: 'OK', unverifiedOrUnfinalized: 0, cursors: [], policy: { timeZone: 'Europe/Kyiv', slots: ['07:00', '13:00', '19:00'], dayStart: '07:00', nightStart: '22:00', dedupeMinutes: 30, pageSize: 50, maxPagesPerRun: 5, overlapMinutes: 10, initialBackfillDays: 1 } };
const queue = () => ({ asOf: now, minDepositUsd: 500, counts: { CREDITED: 0, NEEDS_REVIEW: 0, UNATTRIBUTED: 1, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 1, READY: 1, IGNORED: 0, uncreditedTotal: 3, truncated: false }, packageCounts: { AWAITING_TOPUP: 1, READY: 1, NEEDS_REVIEW: 0 }, packages, rows, creditedBatches: [], watcher });
const activity = () => ({ asOf: now, minDepositUsd: 500, packages, totalUsers: users.length, newUsers24h: 3, pendingKyc: 4, counts: { UNATTRIBUTED: 1, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 1, READY: 1, NEEDS_REVIEW: 0 }, awaitingConfirmationsByUser: {} });
const audit = Array.from({ length: process.env.QA_BENCH ? users.length * 3 : 46 }, (_, i) => ({ id: `qa-audit-${i + 1}`, userId: users[i % users.length].id, userEmail: users[i % users.length].email, performedByAdminEmail: admin.email, action: ['KYC_APPROVED', 'TREASURY_WALLET_UPDATED', 'WITHDRAWAL_APPROVED', 'BALANCE_ADJUSTED'][i % 4], createdAt: ago(i), metadata: { performedByAdminId: admin.id, asset: 'USDT', amount: '100.00000000', reason: 'Тестовая операция' } }));
const otc = Array.from({ length: 45 }, (_, i) => ({ id: `qa-otc-${i + 1}`, number: `OTC-${String(i + 1).padStart(5, '0')}`, status: ['RESERVED', 'OFFERED', 'ACCEPTED', 'PICKUP_READY'][i % 4], version: 1, offerVersion: 1, userId: users[i % users.length].id, user: users[i % users.length], country: 'UA', cityId: 'kyiv', asset: 'USDT', quantity: '1500.00000000', fiat: 'USD', reservedQuantity: '1500.00000000', createdAt: ago(i + 1), updatedAt: now, cancelRequested: false }));
const catalogue = () => ({ revision: `fixture-revision-${state.catalogueRevision}`, rankingAvailable: true, assets: wallets.map((w, i) => ({ assetId: w.nativeAsset.toLowerCase(), asset: w.nativeAsset, name: w.chain === 'bitcoin' ? 'Bitcoin' : w.chain === 'ethereum' ? 'Ethereum' : w.nativeAsset, rank: i + 1, top: true })), entries: wallets.map(w => ({ assetId: w.nativeAsset.toLowerCase(), asset: w.nativeAsset, networkId: w.chain, networkName: w.chain === 'bitcoin' ? 'Bitcoin' : w.chain === 'ethereum' ? 'Ethereum' : w.chain, standard: 'Native', address: w.address, memo: '', memoLabel: '', memoAllowed: false, enabled: true, status: 'configured' })) });
function paged(items, query) { const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(100, Number(query.pageSize) || 20); return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, totalPages: Math.max(1, Math.ceil(items.length / pageSize)), asOf: now }; }
const fixtureHistory = (user, kind) => process.env.QA_BENCH ? Array.from({length:50},(_,i)=>({id:'qa-'+kind+'-'+user.id+'-'+i,userId:user.id,createdAt:ago(i),asset:'USDT',chain:'tron',amount:'100.00000000',status:kind==='orders'?'FILLED':'COMPLETED',pair:'BTC/USDT',side:'BUY',type:'LIMIT',originalQuantity:'0.01',remainingQuantity:'0',productName:'Fixture product'})) : [];
const profile = user => ({ ...user, demoBalances: [{ asset: 'VTA', available: '1200.00000000', locked: '0.00000000' }], deposits: fixtureHistory(user,'deposits'), withdrawals: withdrawals.filter(w => w.userId === user.id), orders: fixtureHistory(user,'orders'), purchases: fixtureHistory(user,'purchases'), kycSubmissions: user.latestKyc ? [user.latestKyc] : [], asOf: now });
const app = express(); app.use(express.json());
app.use((_req,res,next)=>{ res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-src 'none'"); next(); });
app.get('/__qa/state', (_, res) => res.json(state));
app.post('/__qa/state', (req, res) => { Object.assign(state, req.body); res.json({ ok: true }); });
app.use('/__qa/evidence', express.static(path.resolve(root, 'output/admin-practicality')));
app.use('/__qa/compatibility-evidence', express.static(path.resolve(root, 'output/admin-api-compatibility')));
app.get('/__qa/admin-api-comparison', (_, res) => res.sendFile(path.join(__dirname, 'admin-api-compatibility-comparison.html')));
app.use('/api/v1', (req, res, next) => {
  state.calls.push({ method: req.method, path: req.path, query: req.query, at: Date.now() });
  if (state.backend === 'legacy' && req.method === 'GET' && (/^\/admin\/(?:users|withdrawals|clients|audit-log)\/page$/.test(req.path) || /^\/admin\/users\/[^/]+\/(?:profile|history)$/.test(req.path) || req.path === '/admin/work-summary')) {
    // Production-style legacy routing can mistake "page" for a user ID.
    return res.status(404).json({ error: req.path === '/admin/users/page' ? 'User not found' : 'Not found' });
  }
  const fail = state.failures[req.path];
  if (fail === 'hang') return;
  if (fail) return res.status(Number(fail) || 500).json({ error: 'Тестовая недоступность данных' });
  if (req.method !== 'GET') state.writes.push({ method: req.method, path: req.path, body: req.body });
  if (state.delays[req.path]) return setTimeout(next, state.delays[req.path]);
  next();
});
app.get('/api/v1/me', (_, res) => state.session === 'admin' ? res.json(admin) : res.status(403).json({ error: 'Доступ запрещён' }));
app.get('/api/v1/admin/users/page', (req, res) => { let list = users; const q = String(req.query.search || '').toLowerCase(); if (q) list = list.filter(u => `${u.email} ${u.id}`.toLowerCase().includes(q)); if (req.query.status === 'blocked') list = list.filter(u => u.isBlocked); if (req.query.status === 'active') list = list.filter(u => !u.isBlocked); if (req.query.status === 'kyc-pending') list = list.filter(u => u.kycStatus === 'PENDING'); if (req.query.status === 'new') list = list.slice(0, 3); const field=req.query.sort||'createdAt'; list=[...list].sort((a,b)=>String(a[field]||'').localeCompare(String(b[field]||''))*(req.query.direction==='asc'?1:-1)); res.json(paged(list, req.query)); });
app.get('/api/v1/admin/users', (_, res) => res.json(users));
// Synthetic receipts only: lets the local preview exercise uncertain-response recovery.
const adjustmentReceipts = new Map();
app.get('/api/v1/admin/users/:id/balance-adjustments/:key', (req, res) => {
  const receipt = adjustmentReceipts.get(`${req.params.id}:${req.params.key}`);
  receipt ? res.json(receipt.response) : res.status(404).json({ error: 'Операция ещё не найдена' });
});
app.post('/api/v1/admin/users/:id/balance-adjustments', (req, res) => {
  const user = users.find(u => u.id === req.params.id), { asset, amount, reason, idempotencyKey } = req.body;
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const key = `${user.id}:${idempotencyKey}`, payload = JSON.stringify({ asset, amount, reason });
  if (adjustmentReceipts.has(key)) { const receipt = adjustmentReceipts.get(key); return receipt.payload === payload ? res.json(receipt.response) : res.status(409).json({ error: 'Ключ уже использован' }); }
  const balance = user.balances.find(b => b.asset === asset);
  if (!balance || !/^[+-]?\d+(?:\.\d{1,18})?$/.test(String(amount)) || !String(reason || '').trim() || !idempotencyKey) return res.status(400).json({ error: 'Проверьте данные операции' });
  const scaled = value => { const text = String(value), sign = text.startsWith('-') ? -1n : 1n, [whole, decimal = ''] = text.replace(/^[+-]/, '').split('.'); return sign * (BigInt(whole) * 10n ** 18n + BigInt(decimal.padEnd(18, '0'))); };
  const before = balance.available, after = scaled(before) + scaled(amount);
  if (after < 0n || scaled(amount) === 0n) return res.status(400).json({ error: 'Недостаточно доступного остатка или нулевая сумма' });
  balance.available = `${after / 10n ** 18n}.${String(after % 10n ** 18n).padStart(18, '0')}`;
  const response = { status: 'APPLIED', operationId: idempotencyKey, userId: user.id, account: 'SPOT', asset, amount, reason, availableBefore: before, available: balance.available, locked: balance.locked, createdAt: new Date().toISOString() };
  adjustmentReceipts.set(key, { payload, response });
  if (state.lostAdjustmentReply) { state.lostAdjustmentReply = false; return res.status(200).type('application/json').send('{'); }
  res.json(response);
});
app.get('/api/v1/admin/users/:id/history', (req, res) => { const user = users.find(u => u.id === req.params.id); if (!user) return res.status(404).json({ error: 'Пользователь не найден' }); const kind = req.query.kind; const data = kind === 'audit' ? audit.filter(a => a.userId === user.id) : kind === 'kyc' ? (user.latestKyc ? [user.latestKyc] : []) : kind === 'withdrawals' ? withdrawals.filter(w => w.userId === user.id) : []; res.json(paged(data, req.query)); });
app.get(['/api/v1/admin/users/:id/profile', '/api/v1/admin/users/:id'], (req, res) => { const user = users.find(u => u.id === req.params.id); user ? res.json(req.path.endsWith('/profile') ? {...user,demoBalances:[{asset:'VTA',available:'1200.00000000',locked:'0.00000000'}],asOf:now} : profile(user)) : res.status(404).json({ error: 'Пользователь не найден' }); });
app.get('/api/v1/admin/clients/page', (req, res) => {const query=String(req.query.search||'').toLowerCase();res.json(paged(users.filter(u=>(!req.query.status||req.query.status==='all'||u.kycStatus===req.query.status)&&(!query||`${u.email} ${u.id}`.toLowerCase().includes(query))), req.query));});
app.get('/api/v1/admin/clients', (_, res) => res.json(users));
app.get('/api/v1/kyc/admin/delivery', (_, res) => res.json({ mode: 'EDGE_EMAIL', configured: true, recipient: 'review@example.invalid' }));
app.get('/api/v1/kyc/:id/document', (_, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="280"><rect width="600" height="280" fill="#eef0ff"/><text x="30" y="140" font-size="24">Synthetic QA document</text></svg>'));
app.get('/api/v1/admin/wallets', (_, res) => res.json(wallets));
app.get('/api/v1/admin/deposit-catalogue', (_, res) => res.json(catalogue()));
app.put('/api/v1/admin/deposit-catalogue', (_, res) => res.json({ revision: `fixture-revision-${++state.catalogueRevision}` }));
app.get('/api/v1/admin/deposit-queue', (_, res) => res.json(queue()));
app.get('/api/v1/admin/deposit-watch', (_, res) => res.json(watcher));
app.post('/api/v1/admin/deposit-watch/open', (_, res) => res.json({ ran: false, skipped: 'NOT_DUE' }));
app.get('/api/v1/admin/deposit-packages/preview', (req, res) => res.json({ ...packages.find(p => p.userId === req.query.userId), balanceAvailable: '1500.25', balanceAfter: '2150.25' }));
app.get('/api/v1/admin/deposit-address-copies', (_, res) => res.json({ asOf: now, items: [], nextCursor: null }));
app.get('/api/v1/admin/deposits/recent-by-user', (_, res) => res.json([]));
app.get('/api/v1/admin/deposits', (_, res) => res.json({ incoming: rows, deposits: [] }));
app.get('/api/v1/admin/user-activity', (_, res) => res.json(activity()));
app.get('/api/v1/admin/alerts-summary', (_, res) => res.json({ asOf: now, pendingKyc: 4, pendingWithdrawals: 4, readyDeposits: 1, readyDepositUsers: 1, unattributedTransfers: 1 }));
app.get('/api/v1/admin/work-summary', (_, res) => { const spec = { readyPackages: [1, 'packages', '/admin/deposits?state=READY'], pendingPackages: [2, 'packages', '/admin/deposits'], unlinkedTransfers: [1, 'transfers', '/admin/deposits?state=UNATTRIBUTED'], activeWithdrawals: [6, 'withdrawals', '/admin/withdrawals?status=active'], pendingKyc: [4, 'users', '/admin/kyc?status=PENDING'], openOtc: [otc.length, 'requests', '/admin/otc?status=active'], totalUsers: [users.length, 'users', '/admin/users'], newUsers24h: [3, 'users', '/admin/users?status=new'] }; res.json({ asOf: now, alerts:{depositId:'qa-transfer-3',withdrawalId:'qa-withdrawal-8',kycId:'qa-kyc-4'}, widgets: Object.fromEntries(Object.entries(spec).map(([key, [value, unit, href]]) => [key, { value, unit, href, status: 'ready', asOf: now }])) }); });
app.get('/api/v1/admin/withdrawals/page', (req,res)=>{const search=String(req.query.search||'').toLowerCase(),status=req.query.status;res.json(paged(withdrawals.filter(w=>(!search||`${w.id} ${w.userId} ${w.userEmail}`.toLowerCase().includes(search))&&(!status||status==='all'||status==='active'&&['PENDING','APPROVED'].includes(w.status)||status==='processed'&&['SENT','REJECTED','COMPLETED'].includes(w.status)||w.status===status)),req.query));});
app.get('/api/v1/admin/withdrawals', (_, res) => res.json(withdrawals));
app.get('/api/v1/admin/audit-log/page', (req, res) => res.json(paged(audit.filter(a => (!req.query.action || a.action === req.query.action)&&(!req.query.userId||a.userId===req.query.userId)&&(!req.query.search||`${a.id} ${a.userId} ${a.userEmail} ${a.performedByAdminEmail} ${a.action}`.toLowerCase().includes(String(req.query.search).toLowerCase()))), req.query)));
app.get('/api/v1/admin/audit-log', (_, res) => res.json(audit.slice(0, 100)));
app.get('/api/v1/admin/otc', (req, res) => { const filtered = otc.filter(r => !req.query.status || r.status === req.query.status); const page = Number(req.query.page) || 0; res.json({ rows: filtered.slice(page * 20, page * 20 + 20), hasMore: filtered.length > page * 20 + 20 }); });
app.get('/api/v1/admin/otc/:id/messages', (_, res) => res.json({ rows: [], hasMore: false }));
app.get('/api/v1/admin/otc/:id', (req, res) => { const row = otc.find(r => r.id === req.params.id); res.json({ ...row, offers: [], reservation: { asset: 'USDT', quantity: '1500.00000000', status: 'HELD' }, completion: null }); });
app.get('/api/v1/admin/listings', (_, res) => res.json({ listings: [] }));
app.get(['/api/v1/notifications', '/api/v1/admin/deposit-copy-alerts', '/api/v1/admin/deposit-address-copies/alerts'], (_, res) => res.json({ items: [], unreadCount: 0 }));
app.use('/api/v1', (req, res) => { state.unexpected.push({ method: req.method, path: req.path }); res.status(405).json({ error: 'No synthetic handler; no production fallback' }); });
app.use(express.static(dist, { index: false }));
app.get('*', (_, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace('<head>', '<head><script>localStorage.setItem("exchange_token","fixture-admin-only");localStorage.setItem("exchange_lang","ru");</script>')));

async function main() {
  assert(fs.existsSync(path.join(dist, 'index.html')), `Build missing: ${dist}`);
  const server = await new Promise(resolve => { const value = app.listen(process.env.QA_PREVIEW ? Number(process.env.QA_PORT || 4402) : 0, '127.0.0.1', () => resolve(value)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (process.env.QA_COMPATIBILITY) { try { await require('./qa-admin-api-compatibility.cjs').run({ origin, out, state, users, variant }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } return; }
  if (process.env.QA_INTERACTIONS) { try { await require('./qa-admin-workflow-interactions.cjs').run({ origin, out, state }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } return; }
  if (process.env.QA_BENCH) { try { await require('./qa-admin-browser-benchmark.cjs').run({ origin, variant, out, state, userCount: users.length }); } finally { await new Promise(resolve => server.close(resolve)); } return; }
  if (process.env.QA_PREVIEW) { console.log(`Synthetic admin preview ${origin}/admin/users; bundle=${variant}`); return; }
  const report = { variant, dist, origin, scope: 'Actual built frontend with synthetic localhost data. No production access.', layouts: [], errors: [], blockedExternal: [], calls: state.calls, writes: state.writes, unexpected: state.unexpected };
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.QA_BROWSER || 'msedge', headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.blockedExternal.push(url.origin + url.pathname); return route.abort(); });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    const routes = ['users', 'users/qa-user-1', 'deposits', 'withdrawals', 'kyc', 'otc', 'wallets', 'audit-log'];
    for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const slug of routes) {
        await page.goto(`${origin}/admin/${slug}`, { waitUntil: 'networkidle' });
        await page.locator('.admin-main').waitFor();
        await page.screenshot({ path: path.join(out, `${slug.replaceAll('/', '-')}-${width}.png`), fullPage: false });
        report.layouts.push(await page.evaluate(({ slug, width, height }) => ({ route: slug, width, height, documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, rows: document.querySelectorAll('[data-user-row], [data-user-card], tbody tr, .otc-cash-list-item, .admin-history-grid').length, bodyText: document.querySelector('.admin-main')?.textContent?.slice(0, 280) }), { slug, width, height }));
        if (variant === 'after' && slug === 'users' && width >= 1366) {
          const tops = await page.locator('.admin-users-kpi').evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().top)));
          assert.equal(tops.length, 3, 'Users keeps three compact supporting indicators');
          assert.equal(new Set(tops).size, 1, 'Desktop Users indicators stay compact in one row');
          assert.equal(await page.locator('.admin-attention-grid').count(), 0, 'No duplicate work-queue dashboard above Users');
        }
        if (variant === 'after' && slug === 'users' && width === 390) {
          const card = page.locator('[data-user-card]').first();
          await card.waitFor({ state: 'visible' });
          assert.equal(await page.locator('.admin-table-desktop').isVisible(), false, 'Mobile must show working cards, not a clipped desktop table');
          await card.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(out, 'users-list-390.png') });
        }
      }
    }
    await context.close();
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ variant, screenshots: report.layouts.length, pageErrors: report.errors, overflows: report.layouts.filter(r => r.overflow).map(r => `${r.route}@${r.width}`), unexpected: state.unexpected, blockedExternal: [...new Set(report.blockedExternal)], evidence: out }, null, 2));
  if (report.errors.length || state.unexpected.length || report.blockedExternal.length || (variant === 'after' && report.layouts.some(layout => layout.overflow))) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
