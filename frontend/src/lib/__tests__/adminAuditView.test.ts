import { act, flush, createAdminWorkingFixture, page } from './adminWorkingViewHarness';
let f: ReturnType<typeof createAdminWorkingFixture>;
const entry = (id: string, metadata: any = {}) => ({ id, action: 'KYC_APPROVED', userId: 'u1', userEmail: 'user@example.invalid', performedByAdminEmail: 'admin@example.invalid', createdAt: '2026-10-03T09:00:00Z', metadata });
const query = () => new URLSearchParams(f.api.getAdminAuditPage.mock.calls.at(-1)[0]);
beforeEach(() => { f = createAdminWorkingFixture(); });
afterEach(async () => { await f.dispose(); jest.useRealTimers(); });
const mount = (url = '/admin/audit-log') => f.mount('AdminAuditLogPage', url);
test('initial error is an error with retry, not an empty journal', async () => {
  f.api.getAdminAuditPage.mockRejectedValueOnce(new Error('unavailable')); await mount();
  expect(f.host.querySelector('[role="alert"]')).not.toBeNull(); expect(f.host.textContent).not.toContain('Записей по выбранным условиям нет.');
  await f.click(f.button('Повторить')); expect(f.api.getAdminAuditPage).toHaveBeenCalledTimes(2);
  expect(f.host.textContent).toContain('Записей по выбранным условиям нет.');
});
test('refresh error preserves known entries and marks retained data stale', async () => {
  f.api.getAdminAuditPage.mockResolvedValueOnce(page([entry('known')])); await mount();
  f.api.getAdminAuditPage.mockRejectedValueOnce(new Error('unavailable')); await f.click(f.button('Обновить'));
  expect(f.host.textContent).toContain('known'); expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('устареть');
});
test('delayed old filter response cannot replace current filtered rows', async () => {
  let finish!: (value: any) => void;
  f.api.getAdminAuditPage.mockImplementationOnce(() => new Promise(done => { finish = done; })); await mount();
  const signal = f.api.getAdminAuditPage.mock.calls[0][1]; f.api.getAdminAuditPage.mockResolvedValue(page([entry('current')]));
  await f.setValue(f.host.querySelector('select')!, 'KYC_REJECTED');
  await act(async () => { finish(page([entry('stale')])); await flush(); });
  expect(signal.aborted).toBe(true); expect(f.host.textContent).toContain('current'); expect(f.host.textContent).not.toContain('stale');
});
test('query dates are complete Kyiv days and paging preserves every filter and user return context', async () => {
  f.api.getAdminAuditPage.mockImplementation(async (q: string) => page([entry('history')], 100, Number(new URLSearchParams(q).get('page'))));
  await mount('/admin/audit-log?action=KYC_APPROVED&userId=u1&search=alice&from=2026-10-25&to=2026-10-25');
  expect(Object.fromEntries(query())).toEqual({ page: '1', pageSize: '20', action: 'KYC_APPROVED', userId: 'u1', search: 'alice', from: '2026-10-24T21:00:00.000Z', to: '2026-10-25T21:59:59.999Z' });
  await f.click(f.host.querySelector('[aria-label="Следующая страница"]')); expect(query().get('page')).toBe('2'); expect(query().get('action')).toBe('KYC_APPROVED');
  expect(f.host.querySelector('.admin-audit-list a')?.getAttribute('href')).toContain('returnTo=');
});
test('search plus page reset is one debounced request, not an old-search read then the new search', async () => {
  jest.useFakeTimers(); await mount('/admin/audit-log?page=3&action=KYC_APPROVED');
  await f.setValue(f.host.querySelector('[aria-label="Поиск в журнале"]')!, 'alice');
  await act(async () => { await jest.advanceTimersByTimeAsync(249); }); expect(f.api.getAdminAuditPage).toHaveBeenCalledTimes(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(1); }); expect(f.api.getAdminAuditPage).toHaveBeenCalledTimes(2);
  expect(query().get('page')).toBe('1'); expect(query().get('search')).toBe('alice');
});
test('invalid date deep links are not silently discarded from the server query', async () => {
  await mount('/admin/audit-log?from=2026-02-31'); expect(query().get('from')).toBe('2026-02-31');
});
test('metadata masks nested secrets without inventing the result of a recorded action', async () => {
  f.api.getAdminAuditPage.mockResolvedValue(page([entry('audit-1', { status: 'APPROVED', nested: { token: 'fixture-secret-value' }, before: 'PENDING', after: 'APPROVED' })])); await mount();
  expect(f.host.textContent).toContain('Одобрено'); expect(f.host.textContent).toContain('Скрыто'); expect(f.host.textContent).not.toContain('fixture-secret-value');
  expect(f.host.textContent).toContain('"before": "PENDING"');
});
test('unmount aborts the journal read; late responses cannot revive the page', async () => {
  let finish!: (value: any) => void; f.api.getAdminAuditPage.mockImplementationOnce(() => new Promise(done => { finish = done; })); await mount();
  const signal = f.api.getAdminAuditPage.mock.calls[0][1]; await act(async () => f.root.render(null));
  await act(async () => { finish(page([entry('late')])); await flush(); }); expect(signal.aborted).toBe(true); expect(f.host.textContent).toBe('');
});
