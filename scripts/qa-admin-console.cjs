/** Local-only production-bundle QA. All data below are labelled test fixtures.
 * No production connection, real credential, database, or financial operation. */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve('docs/qa/admin-console-redesign');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || 'frontend/dist');
fs.mkdirSync(output, { recursive: true });
const now = '2026-09-12T12:00:00.000Z';
const seeds = [
  ['bitcoin', 'BTC', [], 'bc1q' + 'q'.repeat(30)],
  ['tron', 'TRX', ['USDT'], 'T' + 'a'.repeat(33)],
  ['ethereum', 'ETH', ['USDT'], '0x' + '1'.repeat(40)],
  ['bsc', 'BNB', ['USDT'], '0x' + '2'.repeat(40)],
  ['solana', 'SOL', ['USDT'], 'S' + 'a'.repeat(43)],
  ['ton', 'TON', ['USDT'], 'UQ' + 'a'.repeat(46)],
];
let wallets = seeds.map(([chain, nativeAsset, tokens, address], i) => ({ chain, nativeAsset, tokens, address, defaultAddress: address,
  nativeDepositsSupported: chain !== 'tron', envConfigured: true, isOverridden: i % 2 === 1,
  updatedAt: i % 2 ? now : null, updatedByAdminId: i % 2 ? 'qa-operator' : null }));
const users = Array.from({ length: 18 }, (_, i) => ({ id: `qa-user-${i}`, email: `operator.test.${i + 1}@example.invalid`, displayName: `Test User ${i + 1}`,
  isAdmin: i === 0, role: i === 0 ? 'ADMIN' : 'USER', createdAt: now, registrationIp: null, lastLoginAt: now, isBlocked: i === 4,
  kycStatus: i < 4 ? 'PENDING' : 'APPROVED', balances: [{ asset: 'USDT', available: `${1000 + i * 150}`, locked: '0' }],
  latestKyc: i < 4 ? { id: `qa-kyc-${i}`, fullName: `QA Person ${i + 1}`, country: 'UA', dateOfBirth: '1990-01-01', documentType: 'PASSPORT', status: 'PENDING', createdAt: now } : null }));
const rails = [['USDT', 'tron'], ['BTC', 'bitcoin'], ['ETH', 'ethereum'], ['USDT', 'ethereum']];
const incoming = rails.map(([asset, chain], i) => ({ chain, asset, txHash: `${i}${'ab'.repeat(31)}0`, amount: i === 1 ? '0.035' : `${300 + i * 200}`, confirmations: 22, timestamp: now }));
const deposits = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, userId: users[i].id, userEmail: users[i].email, ...incoming[i % 4], status: 'CREDITED', createdAt: now }));
const withdrawals = Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, userId: users[i].id, userEmail: users[i].email, asset: rails[i % 4][0], network: rails[i % 4][1],
  toAddress: wallets.find(w => w.chain === rails[i % 4][1]).address, amount: i % 4 === 1 ? '0.01' : '350', status: ['PENDING', 'APPROVED', 'SENT'][i % 3], createdAt: now, updatedAt: now, txHash: i % 3 === 2 ? 'ab'.repeat(32) : null, rejectionReason: null }));
const audit = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, userEmail: users[i].email, performedByAdminEmail: 'qa-operator@example.invalid', action: ['KYC_APPROVED', 'TREASURY_WALLET_UPDATED', 'WITHDRAWAL_APPROVED'][i % 3], createdAt: now, metadata: { chain: 'ethereum', address: '0x' + '1'.repeat(40) } }));
const writes = [];
const app = express(); app.use(express.json());
app.get('/api/v1/me', (_, res) => res.json({ ...users[0], isAdmin: true }));
app.get('/api/v1/admin/overview', (_, res) => res.json({ totalUsers: 18, pendingKyc: 4, pendingWithdrawals: 2, creditedDepositsToday: 8, unmatchedIncoming: null, unmatchedIncomingReason: 'live_provider_feed', dayStart: '2026-09-12T00:00:00.000Z', asOf: now }));
app.get('/api/v1/admin/wallets', (_, res) => res.json(wallets));
app.put('/api/v1/admin/wallets/:chain', (req, res) => { writes.push({ method: 'PUT', chain: req.params.chain }); wallets = wallets.map(w => w.chain === req.params.chain ? { ...w, address: req.body.address, isOverridden: true } : w); res.json({ ok: true }); });
app.delete('/api/v1/admin/wallets/:chain', (req, res) => { writes.push({ method: 'DELETE', chain: req.params.chain }); wallets = wallets.map(w => w.chain === req.params.chain ? { ...w, address: w.defaultAddress, isOverridden: false } : w); res.json({ ok: true }); });
app.get('/api/v1/admin/users', (_, res) => res.json(users));
app.get('/api/v1/admin/users/:id', (req, res) => {
  const user = users.find(value => value.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'QA user not found' });
  res.json({ ...user, demoBalances: [], deposits: deposits.filter(value => value.userId === user.id),
    withdrawals: withdrawals.filter(value => value.userId === user.id), orders: [], purchases: [],
    kycSubmissions: user.latestKyc ? [user.latestKyc] : [] });
});
app.get('/api/v1/admin/clients', (_, res) => res.json(users));
app.get('/api/v1/admin/deposits/incoming', (_, res) => res.json(incoming));
app.get('/api/v1/admin/deposits', (_, res) => res.json(deposits));
app.get('/api/v1/admin/withdrawals', (_, res) => res.json(withdrawals));
app.get('/api/v1/admin/audit-log', (_, res) => res.json(audit));
app.get('/api/v1/kyc/:id/document', (_, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="460" height="150"><rect width="460" height="150" fill="#eef0ff"/><text x="24" y="80" fill="#5b6472" font-size="20">LOCAL QA — no identity document</text></svg>'));
app.get('/api/v1/*', (_, res) => res.json([]));
app.use('/api/v1', (_, res) => res.status(405).json({ error: 'QA disallows financial writes' }));
app.use(express.static(dist, { index: false }));
app.get('*', (_, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace('<head>', `<head><script>localStorage.setItem('exchange_token','local-qa-only');localStorage.setItem('exchange_lang','ru');</script>`).replace('</body>', '<div style="position:fixed;bottom:4px;left:8px;z-index:100;font:10px sans-serif;color:#666">LOCAL QA · synthetic fixtures</div></body>')));

async function run() {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const report = { scope: 'Local production bundle, synthetic API fixtures. Not deployed or production data.', layouts: [], interactions: {}, errors: [] };
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    for (const [width, height] of [[1440,900], [1920,1080], [1366,768], [390,844]]) {
      await page.setViewportSize({ width, height });
      for (const [slug, title] of [['', 'Обзор'], ['users', 'Пользователи'], ['wallets', 'Адреса пополнения'], ['deposits', 'Пополнения'], ['withdrawals', 'Вывод криптовалюты'], ['kyc', 'Верификация (KYC)'], ['audit-log', 'Журнал действий']]) {
        await page.goto(`${origin}/admin${slug ? `/${slug}` : ''}`);
        await page.getByRole('heading', { name: title, exact: true }).waitFor();
        if (slug === 'wallets') await page.locator('tbody tr').last().waitFor();
        if (slug === 'users') await page.getByText(users[0].email, { exact: true }).first().waitFor();
        if (slug === 'deposits') await page.getByText('300', { exact: true }).first().waitFor();
        if (slug === 'withdrawals') await page.getByText('350', { exact: true }).first().waitFor();
        if (slug === 'kyc') await page.getByText('QA Person 1', { exact: true }).waitFor();
        if (!slug) {
          await page.getByText('18', { exact: true }).waitFor();
          for (const label of ['Новые пользователи', 'Входящие пополнения', 'Верификации на проверке']) await page.getByRole('region', { name: label, exact: true }).locator('.admin-queue-row').first().waitFor();
        }
        if (slug === 'audit-log') await page.getByText('qa-operator@example.invalid', { exact: true }).first().waitFor();
        await page.screenshot({ path: path.join(output, `${slug || 'overview'}-${width}x${height}.png`) });
        report.layouts.push(await page.evaluate(({ slug, width, height }) => ({ slug: slug || 'overview', width, height, overflow: document.documentElement.scrollWidth > innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          overflowElements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth && !el.closest('aside')).slice(0, 8).map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right, text: el.textContent.slice(0,40), overflow: getComputedStyle(el).overflow })),
          sidebarWidth: document.querySelector('aside').getBoundingClientRect().width,
          visibleRails: [...document.querySelectorAll('tbody tr')].filter(r => r.getBoundingClientRect().bottom <= innerHeight).length,
          railRowHeight: document.querySelector('tbody tr')?.getBoundingClientRect().height ?? null,
        }), { slug, width, height }));
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/admin`);
    await page.getByRole('region', { name: 'Новые пользователи', exact: true }).locator('.admin-queue-row').first().click();
    await page.getByRole('heading', { name: users[0].email, exact: true }).waitFor();
    report.interactions.overviewUserLink = true;
    await page.goto(`${origin}/admin`);
    await page.getByRole('region', { name: 'Верификации на проверке', exact: true }).locator('.admin-queue-row').nth(2).click();
    await page.getByText('QA Person 3', { exact: true }).waitFor();
    report.interactions.overviewKycSelection = true;
    await page.goto(`${origin}/admin`);
    await page.getByRole('region', { name: 'Входящие пополнения', exact: true }).locator('.admin-queue-row').nth(1).click();
    await page.locator('.admin-history-grid.admin-highlighted').waitFor();
    report.interactions.overviewDepositTarget = true;
    await page.goto(`${origin}/admin/wallets`);
    await page.getByRole('button', { name: 'Изменить USDT · Ethereum (ERC-20)', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    report.interactions.affectedNative = await page.getByRole('dialog').getByText('ETH · Ethereum (Native)', { exact: true }).count();
    await page.getByRole('dialog').getByRole('textbox').fill('0x' + '3'.repeat(40));
    await page.getByRole('button', { name: 'Сохранить адрес', exact: true }).click();
    report.interactions.writesBeforeConfirm = writes.length;
    await page.screenshot({ path: path.join(output, 'address-confirmation-1440x900.png') });
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    report.interactions.writes = writes;
    report.interactions.updatedRows = await page.locator('tbody tr').filter({ hasText: '0x33333333' }).count();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.locator('aside.mobile-open').waitFor();
    report.interactions.mobileDrawer = true;
    await page.screenshot({ path: path.join(output, 'mobile-navigation.png') });
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(report, null, 2));
    if (report.errors.length || report.layouts.some(x => x.overflow) || writes.length !== 1 || report.interactions.updatedRows !== 2) throw new Error('Browser QA assertions failed; see browser-results.json');
    console.log(JSON.stringify(report));
  } finally {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); server.close(); }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
