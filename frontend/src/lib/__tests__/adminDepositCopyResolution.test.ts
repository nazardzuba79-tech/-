import { readFileSync } from 'fs';
import { resolve } from 'path';
import { act, flush, frontend, React, req, createAdminWorkingFixture, json, page, user, workSummary } from '../../../test-utils/adminWorkingViewHarness';

let f: ReturnType<typeof createAdminWorkingFixture>, users: any[], ignoreFails: boolean, ignoreGate: Promise<void> | null, nextCopy: any;
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const event = { id: eventId, asset: 'BTC', network: 'bitcoin', receivedAt: '2026-01-01T08:06:00Z', clientCopiedAt: null };
const owner = () => f.host.querySelector('[data-user-row="copy-owner"]')!;
const posts = () => f.fetcher.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
async function mountWithSidebar() {
  // Only authentication is a fixture; exercise the real sidebar and shared
  // summary store, where deposit counts now live instead of Users cards.
  f.load(resolve(frontend, 'src/lib/useAdminGate')).useAdminGate = () => ({ status: 'ok', me: { email: 'operator@example.invalid' } });
  const Layout = f.load(resolve(frontend, 'src/pages/admin/AdminLayout')).AdminLayout;
  const Users = f.load(resolve(frontend, 'src/pages/admin/AdminUsersPage')).AdminUsersPage;
  const { MemoryRouter, Routes, Route } = req('react-router-dom');
  await act(async () => {
    f.root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/users'] },
      React.createElement(Routes, null, React.createElement(Route, { element: React.createElement(Layout) },
        React.createElement(Route, { path: '/admin/users', element: React.createElement(Users) })))));
    await flush();
  });
}
function expectDepositSummary() {
  expect(f.host.querySelector('.admin-attention-grid')).toBeNull();
  expect(f.host.querySelectorAll('.admin-users-kpi')).toHaveLength(3);
  const link = f.host.querySelector('aside a[href="/admin/deposits"]');
  expect(link).not.toBeNull(); expect(link?.querySelector('[aria-label="Пополнения: 1"]')?.textContent?.trim()).toBe('1');
}
beforeEach(() => {
  f = createAdminWorkingFixture(); ignoreFails = false; ignoreGate = null; nextCopy = null;
  users = [user('copy-owner', { lastDepositCopy: { ...event }, depositCopyLookupFailed: false })];
  f.api.getAdminUsersPage.mockImplementation(async () => page(structuredClone(users), 1000));
  f.fetcher.mockImplementation(async (url: string, init: any = {}) => {
    if (String(url).endsWith('/admin/work-summary')) return json(workSummary());
    if (String(url).endsWith(`/${eventId}/ignore`)) {
      if (ignoreGate) await ignoreGate;
      if (ignoreFails) return json({ error: 'failed' }, 500);
      users[0].lastDepositCopy = nextCopy;
      return json({ userId: 'copy-owner', ignoredEventId: eventId, lastDepositCopy: nextCopy, depositCopyLookupFailed: false });
    }
    return json({ error: `Unexpected ${url} ${init.method}` }, 404);
  });
});
afterEach(async () => { await f.dispose(); jest.useRealTimers(); });

test('a pending copy stays visible even when the account and copy are old; it is not a credit action', async () => {
  await f.mount(); expect(owner().querySelector('[data-deposit-copy-bell]')).not.toBeNull();
  expect(owner().querySelector('[data-ignore-deposit-copy]')?.textContent).toBe('Обработано');
  expect(owner().querySelector('[data-credit-user]')).toBeNull();
  expect(f.api.getAdminUsers).not.toHaveBeenCalled();
});
test('opening copy details never acknowledges or fetches and preserves user/deposit navigation context', async () => {
  await f.mount(); const before = f.fetcher.mock.calls.length;
  await f.click(owner().querySelector('[data-deposit-copy-bell]'));
  expect(f.fetcher.mock.calls).toHaveLength(before); expect(posts()).toHaveLength(0);
  expect(owner().querySelector('a[href="/admin/deposits?userId=copy-owner#unattributed"]')).not.toBeNull();
  expect(owner().querySelector('a[href="/admin/users/copy-owner?tab=deposits"]')).not.toBeNull();
  expect(owner().textContent).toContain('не подтверждает оплату');
});
test('summary package counts are independent of copy signals and one person is not turned into an extra financial package', async () => {
  await mountWithSidebar(); expectDepositSummary();
  expect(owner().querySelector('[data-credit-user]')).toBeNull();
  expect(f.calls('/work-summary')).toHaveLength(1);
  expect(posts()).toHaveLength(0);
});
test('Ignore keeps the signal until server success and double-click sends one empty-body POST', async () => {
  let finish!: () => void; ignoreGate = new Promise<void>(done => { finish = done; });
  await f.mount(); const button = owner().querySelector('[data-ignore-deposit-copy]') as HTMLButtonElement;
  await act(async () => { button.click(); button.click(); await flush(); });
  expect(posts()).toHaveLength(1); expect(button.disabled).toBe(true); expect(owner().querySelector('[data-deposit-copy-bell]')).not.toBeNull();
  expect(JSON.parse(posts()[0][1].body)).toEqual({});
  await act(async () => { finish(); await flush(); });
  expect(owner().querySelector('[data-deposit-copy-bell]')).toBeNull();
  expect(f.api.getAdminUsersPage).toHaveBeenCalledTimes(2); expect(f.calls('/work-summary')).toHaveLength(2);
});
test('failed Ignore retains the signal and exposes a retryable error, without changing package counts', async () => {
  ignoreFails = true; await mountWithSidebar(); await f.click(owner().querySelector('[data-ignore-deposit-copy]'));
  expect(owner().querySelector('[data-deposit-copy-bell]')).not.toBeNull(); expect(owner().querySelector('[role="alert"]')).not.toBeNull();
  expectDepositSummary(); expect(f.calls('/work-summary')).toHaveLength(1); expect(posts()).toHaveLength(1);
});
test('a newer signal after Ignore stays visible without inheriting expanded old-event details', async () => {
  nextCopy = { ...event, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', asset: 'ETH', network: 'ethereum' };
  await f.mount(); await f.click(owner().querySelector('[data-deposit-copy-bell]')); await f.click(owner().querySelector('[data-ignore-deposit-copy]'));
  expect(owner().querySelector('[data-deposit-copy-bell]')?.textContent).toContain('ETH');
  expect(owner().querySelector('[role="region"]')).toBeNull();
});
test('ignoring a copy preserves the actual deposit queue link and never invokes a balance or credit operation', async () => {
  await mountWithSidebar(); await f.click(owner().querySelector('[data-ignore-deposit-copy]'));
  expect(owner().querySelector('[data-deposit-copy-bell]')).toBeNull();
  expectDepositSummary(); expect(f.calls('/work-summary')).toHaveLength(2);
  expect(posts()).toHaveLength(1); expect(f.api.creditDepositManually).not.toHaveBeenCalled(); expect(f.api.adjustUserBalance).not.toHaveBeenCalled();
});
test('account switch during Ignore prevents the old response from triggering a user or summary reload', async () => {
  let finish!: () => void; ignoreGate = new Promise<void>(done => { finish = done; }); await f.mount();
  await f.click(owner().querySelector('[data-ignore-deposit-copy]'));
  f.setToken('different-session', false);
  await act(async () => { finish(); await flush(); });
  expect(owner().querySelector('[data-deposit-copy-bell]')).not.toBeNull();
  expect(owner().querySelector('[role="alert"]')?.textContent).toContain('Сессия изменилась');
  expect(f.api.getAdminUsersPage).toHaveBeenCalledTimes(1); expect(f.calls('/work-summary')).toHaveLength(1);
});
test('unavailable copy lookup displays unknown rather than hiding the signal or claiming payment', async () => {
  users[0].lastDepositCopy = null; users[0].depositCopyLookupFailed = true; await f.mount();
  expect(owner().querySelector('[data-deposit-copy-unknown]')).not.toBeNull();
  expect(owner().querySelector('[data-deposit-copy-bell]')).toBeNull(); expect(owner().querySelector('[data-credit-user]')).toBeNull();
});
test('copy signal controls introduce no recurring transport or expiry and refresh only after explicit success', () => {
  const bell = readFileSync(resolve(frontend, 'src/pages/admin/DepositCopyBell.tsx'), 'utf8');
  const mutation = readFileSync(resolve(frontend, 'src/pages/admin/depositCopyReviewClient.ts'), 'utf8');
  expect(bell + mutation).not.toMatch(/\b(?:setInterval|setTimeout|WebSocket|EventSource)\s*\(/);
  expect(mutation).toContain('getToken() !== token'); expect(mutation).toContain('body.ignoredEventId !== eventId');
});
test('copy journal retains explicit Ignore action independently of user list presentation', () => {
  const source = readFileSync(resolve(frontend, 'src/pages/admin/DepositCopiesSection.tsx'), 'utf8');
  expect(source).toContain('ignoreCopySignal'); expect(source).toContain('Обработано');
});
