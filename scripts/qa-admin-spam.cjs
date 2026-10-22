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
const root = path.resolve(__dirname,"..");
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

const spam = new Map();
app.get('/api/v1/admin/spam-emails',(_req,res)=>res.json({entries:[...spam.values()]}));
app.post('/api/v1/admin/spam-emails/:action',(req,res)=>{
 const email=req.body.email.trim().toLowerCase();
 if(req.params.action==='block')spam.set(email,{email,addedAt:now,addedBy:'owner@example.invalid'});else spam.delete(email);
 res.json({ok:true});
});
app.use('/api/v1', (req, res) => { state.unexpected.push({ method: req.method, path: req.path }); res.status(405).json({ error: 'No synthetic handler; no production fallback' }); });
app.use(express.static(dist, { index: false }));
app.get('*', (_, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace('<head>', '<head><script>localStorage.setItem("exchange_token","fixture-admin-only");localStorage.setItem("exchange_lang","ru");</script>')));


async function main(){
 const server=await new Promise(resolve=>{const v=app.listen(0,'127.0.0.1',()=>resolve(v));});
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME_EXECUTABLE || undefined});
 const report={widths:[],errors:[],writes:state.writes};
 try{
 const context=await browser.newContext();
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await context.routeWebSocket('**/*',s=>s.close());
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 for(const width of [1920,1440,1366,390,360,320]){
  await page.setViewportSize({width,height:width<500?844:1000});
  await page.goto(origin+'/admin/users',{waitUntil:'networkidle'});
  const row=page.locator(width<500?'[data-user-card]':'[data-user-row]').first();
  await row.waitFor({state:'visible'});
  const email=await row.locator('.admin-user-email').innerText();
  const trigger=row.getByRole('button',{name:/Действия с аккаунтом/});
  const writesBefore=state.writes.length;
  await trigger.click();
  const menu=page.getByRole('menu');
  assert.equal(state.writes.length,writesBefore,'Opening menu must not write');
  assert.equal(await menu.locator('..').evaluate(el=>el.classList.contains('admin-page-grid')),true,'Menu escapes table clipping');
  const menuBox=await menu.boundingBox();
  assert.ok(menuBox.x>=0&&menuBox.y>=0&&menuBox.x+menuBox.width<=width&&menuBox.y+menuBox.height<=(width<500?844:1000));
  await page.screenshot({path:path.join(out,'actions-menu-'+width+'.png')});
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Удалить');
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
  await trigger.click();
  await page.getByRole('menuitem',{name:'Отметить как спам',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.getByRole('button',{name:'Спам',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await row.locator('.admin-spam-badge').waitFor();
  await trigger.click();
  await page.getByRole('menuitem',{name:'Убрать из спама',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.ok(spam.has(email));
  await page.getByLabel('Фильтр пользователей',{exact:true}).selectOption('spam');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(selector=>document.querySelectorAll(selector).length===1,width<500?'[data-user-card]':'[data-user-row]');
  assert.equal(await page.locator(width<500?'[data-user-card]':'[data-user-row]').count(),1);
  await page.screenshot({path:path.join(out,'spam-filter-'+width+'.png')});
  await page.getByRole('button',{name:'Ещё',exact:true}).click();
  await page.getByRole('menuitem',{name:/Спам-почты/}).click();
  const manager=page.locator('.admin-spam-panel');
  await manager.getByText('owner@example.invalid',{exact:false}).waitFor();
  await page.screenshot({path:path.join(out,'spam-manager-'+width+'.png')});
  await manager.getByRole('button',{name:'Не спам',exact:true}).click();
  await dialog.getByRole('button',{name:'Не спам',exact:true}).click();
  await dialog.waitFor({state:'hidden'});assert.equal(spam.size,0);
  await manager.getByLabel('Email',{exact:true}).fill('new-spam@example.invalid');
  await manager.getByRole('button',{name:'Добавить в спам'}).click();
  await dialog.getByRole('button',{name:'Спам',exact:true}).click();
  await dialog.waitFor({state:'hidden'});assert.ok(spam.has('new-spam@example.invalid'));
  await manager.getByRole('button',{name:'Не спам',exact:true}).click();
  await dialog.getByRole('button',{name:'Не спам',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByLabel('Фильтр пользователей',{exact:true}).selectOption('all');
  await manager.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.waitForLoadState('networkidle');
  const metrics=await row.locator('.admin-user-actions').evaluate(el=>{
    const rects=[...el.children].map(c=>c.getBoundingClientRect());
    return {gaps:rects.slice(1).map((r,i)=>r.left-rects[i].right),width:el.getBoundingClientRect().width};
  });
  if(width>500)assert.ok(Math.max(...metrics.gaps)-Math.min(...metrics.gaps)<1,JSON.stringify(metrics));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,'document overflow @'+width);
  report.widths.push({width,metrics,overflow});
  await page.screenshot({path:path.join(out,'users-'+width+'.png')});
  const lastRow=page.locator(width<500?'[data-user-card]':'[data-user-row]').last();
  await lastRow.getByRole('button',{name:/Действия с аккаунтом/}).click();
  const lastBox=await page.getByRole('menu').boundingBox();
  assert.ok(lastBox.y>=0&&lastBox.y+lastBox.height<=(width<500?844:1000),'Last-row menu remains in viewport');
  await page.screenshot({path:path.join(out,'last-row-menu-'+width+'.png')});
  await page.keyboard.press('Escape');
 }
 assert.deepEqual(report.errors,[]);
 assert.ok(state.writes.every(w=>/spam-emails/.test(w.path)),JSON.stringify(state.writes));
 report.status='PASS';console.log('ADMIN QA PASS 6 widths; row block/unblock, filter, manual absent address, attribution; no other mutations');
 }catch(e){report.status='FAIL';report.error=String(e.stack||e);throw e;}
 finally{fs.writeFileSync(path.join(out,'admin-report.json'),JSON.stringify(report,null,2));await browser.close();server.closeAllConnections();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
