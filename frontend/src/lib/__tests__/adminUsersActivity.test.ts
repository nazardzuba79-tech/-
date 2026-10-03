import { readFileSync } from 'fs';
import { resolve } from 'path';
import { act, flush, frontend, createAdminWorkingFixture, json, page, user, workSummary } from '../../../test-utils/adminWorkingViewHarness';

let f: ReturnType<typeof createAdminWorkingFixture>;
beforeEach(() => { f = createAdminWorkingFixture(); });
afterEach(async () => { await f.dispose(); jest.useRealTimers(); });
const tick = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); await flush(); });
const query = () => new URLSearchParams(f.api.getAdminUsersPage.mock.calls.at(-1)[0]);
const attention = () => f.host.querySelector('[aria-label="Показатели пользователей"]')!;

test('the bounded server page controls ordering; no unbounded users/history reads', async () => {
  f.api.getAdminUsersPage.mockResolvedValue(page([user('payer'), user('fresh'), user('old')], 1000));
  await f.mount();
  expect(f.rows()).toEqual(['payer', 'fresh', 'old']);
  expect(Object.fromEntries(query())).toEqual({ page: '1', pageSize: '20', search: '', status: 'all', sort: 'createdAt', direction: 'desc' });
  expect(f.api.getAdminUsers).not.toHaveBeenCalled(); expect(f.api.getAdminDeposits).not.toHaveBeenCalled();
});
test('compact user KPIs remain global and never sum different queue units', async () => {
  await f.mount();
  const cards = Array.from(attention().querySelectorAll('.admin-users-kpi'));
  expect(cards.map(card => card.querySelector('strong')?.textContent)).toEqual(['1000', '7', '5']);
  expect(cards.map(card => card.querySelector('span')?.textContent)).toEqual(['Всего пользователей', 'Новые за 24 часа', 'Ожидают KYC']);
  expect(f.host.querySelector('.admin-attention-grid')).toBeNull();
  expect(f.host.querySelector('[data-credit-user]')).toBeNull();
});
test('existing password values and unavailable markers remain unchanged in desktop and mobile', async () => {
  f.api.getAdminUsersPage.mockResolvedValue(page([user('plain', { password: 'FixturePassword123' }), user('unknown')])); await f.mount();
  expect(f.host.querySelector('[data-user-password="plain"]')?.textContent).toBe('FixturePassword123');
  expect(f.host.querySelector('[data-user-password="unknown"]')?.textContent).toBe('—');
  expect(f.host.querySelector('[data-user-card="plain"]')?.textContent).toContain('FixturePassword123');
});
test('Users has no duplicated financial queue cards or financial submit actions', async () => {
  await f.mount();
  expect(attention().querySelector('a[href^="/admin/deposits"]')).toBeNull();
  expect(attention().querySelector('a[href^="/admin/withdrawals"]')).toBeNull();
  expect(f.host.querySelector('[data-confirm-credit]')).toBeNull();
  expect(f.fetcher.mock.calls.filter((c: any[]) => c[1]?.method === 'POST')).toHaveLength(0);
});
test('one visible summary read per 30 seconds, no hidden reads or fresh-return duplicate; user page stays on demand', async () => {
  jest.useFakeTimers(); await f.mount(); expect(f.calls('/work-summary')).toHaveLength(1);
  await tick(30_000); expect(f.calls('/work-summary')).toHaveLength(2);
  await f.setHidden(true); await tick(10_000); expect(f.calls('/work-summary')).toHaveLength(2);
  await f.setHidden(false); expect(f.calls('/work-summary')).toHaveLength(2);
  await tick(20_000); expect(f.calls('/work-summary')).toHaveLength(3);
  expect(f.api.getAdminUsersPage).toHaveBeenCalledTimes(1);
});
test('repeated focus events do not delay freshness or cause extra user list reads', async () => {
  jest.useFakeTimers(); await f.mount(); await tick(20_000);
  await act(async () => { window.dispatchEvent(new f.dom.window.Event('focus')); await flush(); });
  await tick(10_000); expect(f.calls('/work-summary')).toHaveLength(2); expect(f.api.getAdminUsersPage).toHaveBeenCalledTimes(1);
});
test('search is debounced, server filters/sort stay in the URL, and search resets the page', async () => {
  jest.useFakeTimers(); await f.mount('AdminUsersPage', '/admin/users?status=blocked&sort=lastLoginAt&direction=asc&page=3');
  expect(query().get('page')).toBe('3');
  await f.setValue(f.host.querySelector('[aria-label="Поиск пользователей"]')!, 'payer');
  await tick(249); expect(f.api.getAdminUsersPage).toHaveBeenCalledTimes(1);
  await tick(1); expect(Object.fromEntries(query())).toEqual({ page: '1', pageSize: '20', search: 'payer', status: 'blocked', sort: 'lastLoginAt', direction: 'asc' });
  expect(f.host.querySelector('[data-location]')?.textContent).toContain('search=payer');
  await f.setValue(f.host.querySelector('[aria-label="Фильтр пользователей"]')!, 'kyc-pending');
  expect(query().get('status')).toBe('kyc-pending');
});
test('pagination requests only one bounded next page, keeping search and sorting', async () => {
  f.api.getAdminUsersPage.mockImplementation(async (q: string) => page([user(`page-${new URLSearchParams(q).get('page')}`)], 1000, Number(new URLSearchParams(q).get('page'))));
  await f.mount('AdminUsersPage', '/admin/users?search=client&sort=email&direction=asc');
  await f.click(f.host.querySelector('[aria-label="Следующая страница"]'));
  expect(f.rows()).toEqual(['page-2']); expect(query().get('page')).toBe('2'); expect(query().get('pageSize')).toBe('20');
  expect(query().get('search')).toBe('client'); expect(query().get('sort')).toBe('email');
  expect(f.host.querySelector('[data-user-row] a')?.getAttribute('href')).toContain(encodeURIComponent('page=2'));
});
test('late page A is aborted and cannot replace page B after filtering', async () => {
  let finish!: (value: any) => void;
  f.api.getAdminUsersPage.mockImplementationOnce(() => new Promise(done => { finish = done; })); await f.mount();
  const signal = f.api.getAdminUsersPage.mock.calls[0][1];
  f.api.getAdminUsersPage.mockResolvedValue(page([user('current')]));
  await f.setValue(f.host.querySelector('[aria-label="Фильтр пользователей"]')!, 'blocked');
  await act(async () => { finish(page([user('stale')])); await flush(); });
  expect(signal.aborted).toBe(true); expect(f.rows()).toEqual(['current']);
});
test('first summary failure ends loading, keeps unknown values and retry recovers exactly once', async () => {
  f.fetcher.mockResolvedValueOnce(json({ error: 'unavailable' }, 503)); await f.mount();
  expect(attention().querySelector('[role="status"]')).not.toBeNull();
  expect(attention().textContent).not.toContain('Загрузка…');
  expect(Array.from(attention().querySelectorAll('.admin-users-kpi strong')).every(el => el.textContent === '—')).toBe(true);
  await f.click(attention().querySelector('button'));
  expect(f.calls('/work-summary')).toHaveLength(2); expect(attention().querySelector('[role="status"]')).toBeNull();
});
test.each(['network', 'malformed', 'incomplete'])('%s summary cannot become a zero or an invented empty queue', async kind => {
  if (kind === 'network') f.fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else f.fetcher.mockResolvedValueOnce(json(kind === 'malformed' ? { packages: [] } : { widgets: {} }));
  await f.mount(); expect(attention().querySelector('[role="status"]')).not.toBeNull();
  expect(attention().textContent).not.toContain('Загрузка…');
  expect(Array.from(attention().querySelectorAll('.admin-users-kpi strong')).every(el => el.textContent === '—')).toBe(true);
});
test('known zero is displayed as zero only after a successful summary answer', async () => {
  f.fetcher.mockResolvedValueOnce(json(workSummary({ totalUsers: { value: 0 } }))); await f.mount();
  expect(attention().querySelector('.admin-users-kpi strong')?.textContent).toBe('0');
});
test('summary refresh failure retains the prior values and explicitly marks them stale', async () => {
  jest.useFakeTimers(); await f.mount(); f.fetcher.mockResolvedValueOnce(json({ error: 'unavailable' }, 503));
  await tick(30_000);
  expect(attention().querySelector('.admin-users-kpi strong')?.textContent).toBe('1000');
  expect(attention().querySelector('[role="status"]')?.textContent).toContain('устареть');
});
test('a hung summary read is aborted at 15 seconds and settles to an error', async () => {
  jest.useFakeTimers(); f.fetcher.mockImplementationOnce(() => new Promise(() => {})); await f.mount();
  const signal = f.calls('/work-summary')[0][1].signal; await tick(15_000);
  expect(signal.aborted).toBe(true); expect(attention().querySelector('[role="status"]')).not.toBeNull();
  expect(attention().textContent).not.toContain('Загрузка…');
});
test('user list failure offers retry; a same-turn double click starts one read', async () => {
  f.api.getAdminUsersPage.mockRejectedValueOnce(new Error('unavailable')); await f.mount();
  let answer!: (value: any) => void; f.api.getAdminUsersPage.mockImplementation(() => new Promise(done => { answer = done; }));
  const retry = f.button('Повторить') as HTMLButtonElement;
  await act(async () => { retry.click(); retry.click(); await flush(); }); expect(f.api.getAdminUsersPage).toHaveBeenCalledTimes(2);
  await act(async () => { answer(page([user('recovered')])); await flush(); }); expect(f.rows()).toEqual(['recovered']);
});
test('unmount aborts both reads and no timer or late response restarts activity', async () => {
  jest.useFakeTimers(); let finish!: (value: any) => void;
  f.fetcher.mockImplementationOnce(() => new Promise(done => { finish = done; }));
  f.api.getAdminUsersPage.mockImplementationOnce(() => new Promise(() => {})); await f.mount();
  const signals = [f.calls('/work-summary')[0][1].signal, f.api.getAdminUsersPage.mock.calls[0][1]];
  await act(async () => f.root.render(null)); await act(async () => { finish(json(workSummary())); await flush(); }); await tick(120_000);
  expect(signals.every(signal => signal.aborted)).toBe(true); expect(f.calls('/work-summary')).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
});

// The review drawer now opens from Deposits. Keep the original accounting
// safety assertions on that exact component, independently of Users navigation.
const preview = (ready = true) => ({ userId: 'payer', userEmail: 'payer@example.invalid', chain: 'tron', asset: 'USDT', key: 'payer|tron|USDT',
  total: ready ? '2500' : '299.999999', state: ready ? 'READY' : 'AWAITING_TOPUP', minimumReached: ready, minDepositUsd: 300,
  remaining: ready ? '0' : '0.000001', usdValue: ready ? '2500' : '299.999999', priceUsd: '1', usdPolicy: 'USD_PEGGED_POLICY',
  balanceAvailable: '100.5', balanceAfter: '2600.5', token: 'a'.repeat(64), unconfirmedTotal: '0', unconfirmedCount: 0,
  transfers: [{ id: 'payer-t1', txHash: 'f'.repeat(64), amount: '2500', confirmations: 30, minConfirmations: 19, finalized: true, state: 'READY' }],
});
const drawerProps = () => ({ userId: 'payer', email: 'payer@example.invalid', chain: 'tron', asset: 'USDT', onClose: jest.fn(), onDone: jest.fn() });
test('deposit review Cancel performs zero writes and shows the real server preview', async () => {
  f.fetcher.mockResolvedValue(json(preview())); const props = drawerProps(); await f.mount('CreditDepositDrawer', '/admin/deposits', props);
  expect(f.host.textContent).toContain('2500 USDT'); expect(f.host.textContent).toContain('100.5');
  await f.click(f.host.querySelector('[data-cancel-credit]')); expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(f.calls('/confirm')).toHaveLength(0);
});
test('deposit review double confirm uses one idempotent reviewed package and never sends an amount', async () => {
  let release!: (value: any) => void;
  f.fetcher.mockImplementation(async (url: string) => String(url).includes('/preview') ? json(preview()) : new Promise(done => { release = done; }));
  const props = drawerProps(); await f.mount('CreditDepositDrawer', '/admin/deposits', props);
  const button = f.host.querySelector('[data-confirm-credit]') as HTMLButtonElement;
  await act(async () => { button.click(); button.click(); await flush(); });
  expect(f.calls('/confirm')).toHaveLength(1);
  const body = JSON.parse(f.calls('/confirm')[0][1].body);
  expect(Object.keys(body).sort()).toEqual(['asset', 'chain', 'depositIds', 'idempotencyKey', 'token', 'userId']);
  expect(body).toMatchObject({ userId: 'payer', chain: 'tron', asset: 'USDT', depositIds: ['payer-t1'], token: 'a'.repeat(64) });
  expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await act(async () => { release(json({ status: 'CREDITED', totalAmount: '2500', asset: 'USDT' })); await flush(); });
  expect(props.onDone).toHaveBeenCalledTimes(1);
});
test('below the minimum the deposit review confirmation remains disabled with zero writes', async () => {
  f.fetcher.mockResolvedValue(json(preview(false))); await f.mount('CreditDepositDrawer', '/admin/deposits', drawerProps());
  const confirm = f.host.querySelector('[data-confirm-credit]') as HTMLButtonElement;
  expect(confirm.disabled).toBe(true); await f.click(confirm); expect(f.calls('/confirm')).toHaveLength(0);
});
test('Users never calls a credit/balance API or downloads deposit history', async () => {
  await f.mount(); expect(f.api.creditDepositManually).not.toHaveBeenCalled(); expect(f.api.adjustUserBalance).not.toHaveBeenCalled(); expect(f.api.getAdminDeposits).not.toHaveBeenCalled();
  const source = readFileSync(resolve(frontend, 'src/pages/admin/AdminUsersPage.tsx'), 'utf8');
  expect(source).not.toMatch(/adjustUserBalance|manual-credit|creditDepositManually|getAdminDeposits\(/);
  const drawer = readFileSync(resolve(frontend, 'src/pages/admin/CreditDepositDrawer.tsx'), 'utf8'); expect(drawer).not.toMatch(/amount:\s/);
});
