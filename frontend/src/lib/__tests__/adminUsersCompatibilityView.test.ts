import { act, flush, createAdminWorkingFixture, json, page, user } from '../../../test-utils/adminWorkingViewHarness';

let f: ReturnType<typeof createAdminWorkingFixture>;
beforeEach(() => { f = createAdminWorkingFixture(); });
afterEach(async () => { await f.dispose(); jest.useRealTimers(); });
const tick = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); await flush(); });

test('optional summary 404 leaves Users usable, quiet and does not poll missing route', async () => {
  jest.useFakeTimers();
  f.fetcher.mockResolvedValue(json({ error: 'Not found' }, 404));
  await f.mount();
  expect(f.rows().length).toBeGreaterThan(0);
  expect(f.host.textContent).not.toContain('Не удалось обновить сводку');
  expect(f.host.querySelector('.admin-attention')).toBeNull();
  expect(f.host.querySelectorAll('.admin-users-kpi')).toHaveLength(3);
  await tick(120_000);
  await act(async () => { window.dispatchEvent(new f.dom.window.Event('focus')); await flush(); });
  await f.setHidden(true); await f.setHidden(false);
  expect(f.calls('/work-summary')).toHaveLength(1);
  await act(async () => { f.setToken('different-admin'); await flush(); });
  expect(f.calls('/work-summary')).toHaveLength(2);
});

test('only complete global legacy stats fill KPIs; a filtered page never becomes the global total', async () => {
  f.fetcher.mockResolvedValue(json({ error: 'Not found' }, 404));
  f.api.getAdminUsersPage.mockResolvedValue({ ...page([user('filtered')], 1), legacyStats: { totalUsers: 40, newUsers24h: 2, pendingKyc: 4 } });
  await f.mount('AdminUsersPage', '/admin/users?search=filtered');
  expect(Array.from(f.host.querySelectorAll('.admin-users-kpi strong')).map(el => el.textContent)).toEqual(['40', '2', '4']);
});

test('compact Users keeps exact decimal assets, explicit status and absent password marker', async () => {
  f.api.getAdminUsersPage.mockResolvedValue(page([user('blocked', { isBlocked: true, balances: [{ asset: 'USDT', available: '1234567.000000000000000001', locked: '0' }] }), user('active', { isBlocked: false }), user('unknown')]));
  await f.mount();
  const row = f.host.querySelector('[data-user-row="blocked"]')!;
  expect(row.querySelector('[data-user-password]')?.textContent).toBe('—');
  expect(row.querySelector('[data-user-status]')?.textContent).toBe('Заблокирован');
  expect(f.host.querySelector('[data-user-row="active"] [data-user-status]')?.textContent).toBe('Активен');
  expect(f.host.querySelector('[data-user-row="unknown"] [data-user-status]')?.textContent).toBe('—');
  expect(row.querySelector('.admin-user-balance')?.textContent).toContain('1 234 567.000000000000000001');
  expect(row.querySelector('.admin-user-balance small')).toBeNull();
  expect(f.host.querySelector('[data-user-card="blocked"]')?.textContent).toContain('Заблокирован');
});
