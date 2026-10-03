import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import ts from 'typescript';
import { Prisma } from '@prisma/client';

let token: string | null, fetcher: jest.Mock, sessions: Set<() => void>, modules: Map<string, any>;
const base = resolve(__dirname, '..');
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const missing = () => response({ error: 'Not found' }, 404);
const user = (id = 'u1', extra = {}) => ({ id, email: `${id}@example.invalid`, password: null, role: 'USER', isAdmin: false, kycStatus: 'NOT_STARTED', createdAt: new Date().toISOString(), registrationIp: null, lastLoginAt: null, isBlocked: false, blockedAt: null, blockedReason: null, balances: [{ asset: 'BTC', available: '9007199254740993.00000001', locked: '0.00000001' }], ...extra });
function load(file: string): any {
  if (!file.endsWith('.ts')) file += '.ts';
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name === './api') return { API_BASE: '/api/v1', api: {}, getToken: () => token,
      clearToken: () => { token = null; for (const fn of sessions) fn(); }, onSessionChange: (fn: () => void) => { sessions.add(fn); return () => sessions.delete(fn); } };
    if (name === './browserActivity') return { browserFetch: fetcher };
    return load(resolve(dirname(file), name));
  });
  return exports;
}
const api = () => load(resolve(base, 'adminPagedApi'));
const paths = () => fetcher.mock.calls.map(call => call[0]);
beforeEach(() => { token = 'session-a'; fetcher = jest.fn(); sessions = new Set(); modules = new Map(); });

test('current paged endpoint stays authoritative without any legacy read', async () => {
  const page = { items: [user()], total: 301, page: 1, pageSize: 20, totalPages: 16, asOf: '2026-10-03T00:00:00Z' };
  fetcher.mockResolvedValue(response(page)); expect(await api().getAdminUsersPage('page=1')).toEqual(page); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('old users/:id shadow 404 falls back; ID search/filter/sort/page and exact balance strings survive', async () => {
  fetcher.mockResolvedValueOnce(response({ error: 'User not found' }, 404)).mockResolvedValueOnce(response([user(), user('target', { isBlocked: true, password: 'owner-returned-fixture' })]));
  const result = await api().getAdminUsersPage('search=target&status=blocked&page=1&pageSize=20&sort=email&direction=asc');
  expect(result.items.map((u: any) => u.id)).toEqual(['target']); expect(result.items[0].balances[0].available).toBe('9007199254740993.00000001');
  expect(result.items[0].password).toBe('owner-returned-fixture'); expect(result.compatibility.complete).toBe(true); expect(result.legacyStats.totalUsers).toBe(2);
  expect(paths()).toEqual(['/api/v1/admin/users/page?search=target&status=blocked&page=1&pageSize=20&sort=email&direction=asc', '/api/v1/admin/users']);
});
test('missing capability is remembered only in current session; each explicit legacy read stays fresh', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockImplementation(() => Promise.resolve(response([user()]))); const subject = api();
  await subject.getAdminUsersPage('page=1'); await subject.getAdminUsersPage('page=2');
  expect(paths().filter(p => p.includes('/page?'))).toHaveLength(1);
  token = 'session-b'; for (const fn of sessions) fn(); fetcher.mockResolvedValueOnce(missing());
  await subject.getAdminUsersPage('page=1'); expect(paths().filter(p => p.includes('/page?'))).toHaveLength(2);
  expect(fetcher.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer session-b');
});
test.each([[401, 'SESSION_EXPIRED'], [403, 'FORBIDDEN'], [500, 'SERVER_ERROR']])('%i never falls back and preserves typed reason %s', async (status, code) => {
  fetcher.mockResolvedValue(response({ error: 'unavailable' }, status as number));
  await expect(api().getAdminUsersPage('')).rejects.toMatchObject({ code }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('network errors never fall back', async () => {
  fetcher.mockRejectedValue(new TypeError('Failed to fetch')); await expect(api().getAdminClientsPage('')).rejects.toMatchObject({ code: 'NETWORK_ERROR' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('a malformed successful payload is a server failure, not an empty list or fallback', async () => {
  fetcher.mockResolvedValue(response({ items: null })); await expect(api().getAdminUsersPage('')).rejects.toMatchObject({ code: 'SERVER_ERROR' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('late 404 after cancellation cannot start a legacy request or poison capability', async () => {
  const controller = new AbortController(); let settle!: (value: Response) => void;
  fetcher.mockReturnValueOnce(new Promise(resolve => { settle = resolve; })); const subject = api(); const promise = subject.getAdminUsersPage('', controller.signal);
  controller.abort(); settle(missing()); await expect(promise).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(response({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, asOf: '2026-10-03T00:00:00Z' })); await subject.getAdminUsersPage(''); expect(paths()[1]).toContain('/users/page?');
});
test('already cancelled read issues zero requests', async () => {
  const controller = new AbortController(); controller.abort(); await expect(api().getAdminUsersPage('', controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).not.toHaveBeenCalled();
});
test('session replaced while optional 404 is pending never sends new-account fallback', async () => {
  let settle!: (value: Response) => void; fetcher.mockReturnValueOnce(new Promise(resolve => { settle = resolve; })); const promise = api().getAdminUsersPage('');
  token = 'session-b'; for (const fn of sessions) fn(); settle(missing()); await expect(promise).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('profile fallback opens identity/balances without downloading aggregate history', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([user()])); const result = await api().getAdminProfile('u1');
  expect(result.id).toBe('u1'); expect(result.demoBalances).toBeNull(); expect(result.balances[0].available).toBe(user().balances[0].available);
  expect(paths()).toEqual(['/api/v1/admin/users/u1/profile', '/api/v1/admin/users']);
});
test('genuine new profile user-not-found is never treated as a missing endpoint', async () => {
  fetcher.mockResolvedValue(response({ error: 'Пользователь не найден' }, 404)); await expect(api().getAdminProfile('missing')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('unknown identity after absent profile is confirmed against complete legacy lists', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([]));
  await expect(api().getAdminProfile('missing')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' }); expect(paths()).toEqual(['/api/v1/admin/users/missing/profile', '/api/v1/admin/users', '/api/v1/admin/clients']);
});
test('balances tab can explicitly lazy-load legacy demo balances', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([user()])); const subject = api(); await subject.getAdminProfile('u1');
  fetcher.mockResolvedValueOnce(response({ ...user(), demoBalances: [{ asset: 'USDT', available: '1.0000000000001', locked: '0' }] }));
  const result = await subject.getAdminProfileBalances('u1'); expect(result.demoBalances[0].available).toBe('1.0000000000001'); expect(paths().at(-1)).toBe('/api/v1/admin/users/u1');
});
test('capped legacy order history labels loaded subset instead of invented exact total', async () => {
  const orders = Array.from({ length: 100 }, (_, i) => ({ id: `o${i}`, createdAt: new Date(2026, 9, 3, 0, 0, 100-i).toISOString() }));
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response({ ...user(), orders })); const result = await api().getAdminHistory('u1', 'orders', 2);
  expect(result.items).toHaveLength(20); expect(result.total).toBe(100); expect(result.compatibility).toMatchObject({ complete: false, limit: 100 });
  expect(paths()).toEqual(['/api/v1/admin/users/u1/history?kind=orders&page=2&pageSize=20', '/api/v1/admin/users/u1']);
});
test.each(['futuresOrders', 'futuresPositions', 'cfdPositions'])('%s unavailable on legacy never fabricates empty history or calls account-wide data', async kind => {
  fetcher.mockResolvedValue(missing()); await expect(api().getAdminHistory('u1', kind, 1)).rejects.toMatchObject({ code: 'ENDPOINT_NOT_AVAILABLE' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('withdrawal capped search cannot claim global emptiness', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, userId: 'u1', asset: 'USDT', status: 'SENT', createdAt: '2026-10-03T00:00:00Z', balanceHeld: true }));
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response(rows)); const result = await api().getAdminWithdrawalsPage('status=active');
  expect(result.items).toEqual([]); expect(result.compatibility).toMatchObject({ complete: false, limit: 200 }); expect(result.compatibility.notice).toBeTruthy();
});
test('Deposit client search and KYC latest date filter share full legacy client contract', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([user('u1', { latestKyc: { id: 'k1', status: 'PENDING', createdAt: '2026-10-02T15:00:00Z' } }), user('u2', { latestKyc: null })]));
  const result = await api().getAdminClientsPage('search=u1&status=NOT_STARTED&from=2026-10-02T00%3A00%3A00Z&to=2026-10-02T23%3A59%3A59Z');
  expect(result.items.map((u: any) => u.id)).toEqual(['u1']); expect(result.compatibility.complete).toBe(true); expect(paths().at(-1)).toBe('/api/v1/admin/clients');
});
test('audit keeps safe legacy server user/action filters and reports 200 cap', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, userId: 'u1', action: 'KYC_APPROVED', createdAt: '2026-10-03T00:00:00Z', metadata: null }));
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response(rows)); const result = await api().getAdminAuditPage('userId=u1&action=KYC_APPROVED&page=2');
  expect(result.items).toHaveLength(20); expect(result.compatibility).toMatchObject({ complete: false, limit: 200 }); expect(paths().at(-1)).toBe('/api/v1/admin/audit-log?action=KYC_APPROVED&userId=u1');
});
test('legacy read errors never turn into empty success and no mutation is retried', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response({ error: 'Forbidden' }, 403));
  await expect(api().getAdminWithdrawalsPage('')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
});
test('session switch during body decoding rejects private data, not only network response', async () => {
  let finish!: (value: unknown) => void;
  fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(resolve => { finish = resolve; }) });
  const pending = api().getAdminUsersPage(''); await Promise.resolve(); await Promise.resolve();
  token = 'session-b'; for (const fn of sessions) fn();
  finish({ items: [user('private-a')], total: 1, page: 1, pageSize: 20, totalPages: 1, asOf: '2026-10-03T00:00:00Z' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('404 HTML route response still permits safe fallback without exposing its body', async () => {
  fetcher.mockResolvedValueOnce(new Response('<html>missing route</html>', { status: 404 })).mockResolvedValueOnce(response([user()]));
  const result = await api().getAdminUsersPage(''); expect(result.total).toBe(1); expect(result.compatibility.complete).toBe(true);
});
test('legacy short queue count is exact; filters preserve held balance and amounts unchanged', async () => {
  const withdrawal = { id: 'w1', userId: 'u1', userEmail: 'u1@example.invalid', asset: 'BTC', amount: '9007199254740993.00000001', status: 'APPROVED', createdAt: '2026-10-03T00:00:00Z', balanceHeld: true };
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([withdrawal]));
  const result = await api().getAdminWithdrawalsPage('search=u1&status=active'); expect(result.items).toEqual([withdrawal]); expect(result.compatibility.complete).toBe(true);
});
test('legacy user pagination is client-side stable and null last-login remains last', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([user('unknown'), user('older', { lastLoginAt: '2026-10-01T00:00:00Z' }), user('newer', { lastLoginAt: '2026-10-02T00:00:00Z' })]));
  const result = await api().getAdminUsersPage('sort=lastLoginAt&direction=desc&page=2&pageSize=1'); expect(result.items[0].id).toBe('older'); expect(result.totalPages).toBe(3);
});
test('invalid legacy latest-KYC date query refuses instead of silently ignoring filter', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([user()]));
  await expect(api().getAdminClientsPage('from=invalid-date')).rejects.toMatchObject({ status: 400 });
});
test('lazy modern balances reject a response for a different account', async () => {
  fetcher.mockResolvedValue(response({ ...user('other'), demoBalances: [] }));
  await expect(api().getAdminProfileBalances('u1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
});
test('explicit session invalidation cancels capability probe even when stored token string is unchanged', async () => {
  let finish!: (value: Response) => void; fetcher.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = api().getAdminUsersPage(''); for (const fn of sessions) fn(); finish(missing());
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('unknown blocked state never qualifies a legacy user as active', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([user('unknown', { isBlocked: undefined }), user('active', { isBlocked: false }), user('blocked', { isBlocked: true })]));
  const result = await api().getAdminUsersPage('status=active'); expect(result.items.map((u: any) => u.id)).toEqual(['active']);
});
test('modern empty page remains valid without fallback or fabricated records', async () => {
  const empty = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, asOf: '2026-10-03T00:00:00Z' };
  fetcher.mockResolvedValue(response(empty)); expect(await api().getAdminUsersPage('')).toEqual(empty); expect(fetcher).toHaveBeenCalledTimes(1);
});
test.each([
  { id: 'u1', email: 'u1@example.invalid' },
  { ...user(), balances: null, demoBalances: [] },
  { ...user(), balances: [], demoBalances: null },
  { ...user(), balances: [null], demoBalances: [] },
  { ...user(), balances: [{ asset: 'BTC', available: 12, locked: '0' }], demoBalances: [] },
  { ...user(), demoBalances: [{ asset: '', available: '1', locked: '0' }] },
  { ...user(), demoBalances: [{ asset: 'USDT', available: 'NaN', locked: '0' }] },
  { ...user(), isBlocked: undefined, demoBalances: [] },
])('malformed successful profile is rejected before UI/action use: %#', async profile => {
  fetcher.mockResolvedValue(response(profile));
  await expect(api().getAdminProfile('u1')).rejects.toMatchObject({ status: 502, code: 'SERVER_ERROR' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test.each([false, true])('malformed user balance rows fail instead of crashing table (legacy=%s)', async legacy => {
  const invalid = user('u1', { balances: [{ asset: 'BTC', available: '1' }] });
  if (legacy) fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([invalid]));
  else fetcher.mockResolvedValue(response({ items: [invalid], total: 1, page: 1, pageSize: 20, totalPages: 1, asOf: '2026-10-03T00:00:00Z' }));
  await expect(api().getAdminUsersPage('')).rejects.toMatchObject({ status: 502, code: 'SERVER_ERROR' });
  expect(fetcher).toHaveBeenCalledTimes(legacy ? 2 : 1);
});
test.each([false, true])('lazy balances reject null financial rows (legacy=%s)', async legacy => {
  const invalid = { ...user(), demoBalances: [null] };
  if (legacy) fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response(invalid));
  else fetcher.mockResolvedValue(response(invalid));
  await expect(api().getAdminProfileBalances('u1')).rejects.toMatchObject({ status: 502, code: 'SERVER_ERROR' });
  expect(fetcher).toHaveBeenCalledTimes(legacy ? 2 : 1);
});
test('legacy profile missing blocked state stays explicitly unknown', async () => {
  fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([user('u1', { isBlocked: undefined })]));
  expect((await api().getAdminProfile('u1')).isBlocked).toBeNull();
});
test.each(['users-modern', 'users-legacy', 'profile', 'balances'])('actual Prisma scientific decimal strings remain exact through %s', async kind => {
  const available = new Prisma.Decimal('0.00000001').toString();
  const locked = new Prisma.Decimal('1000000000000000000000').toString();
  expect(available).toBe('1e-8'); expect(locked).toBe('1e+21');
  const balances = [{ asset: 'BTC', available, locked }];
  const profile = { ...user('u1', { balances }), demoBalances: balances };
  if (kind === 'users-legacy') fetcher.mockResolvedValueOnce(missing()).mockResolvedValueOnce(response([profile]));
  else fetcher.mockResolvedValue(response(kind === 'users-modern'
    ? { items: [profile], total: 1, page: 1, pageSize: 20, totalPages: 1, asOf: '2026-10-03T00:00:00Z' } : profile));
  const subject = api();
  const result = kind.startsWith('users') ? (await subject.getAdminUsersPage('')).items[0]
    : kind === 'profile' ? await subject.getAdminProfile('u1') : await subject.getAdminProfileBalances('u1');
  expect(result.balances).toEqual(balances);
  expect(typeof result.balances[0].available).toBe('string');
  expect(fetcher).toHaveBeenCalledTimes(kind === 'users-legacy' ? 2 : 1);
});
test.each(['Infinity', '-Infinity', 'NaN', '1e', '1e++8', '0x10'])('invalid or non-finite decimal text %s remains a read failure', async available => {
  fetcher.mockResolvedValue(response({ ...user('u1', { balances: [{ asset: 'BTC', available, locked: '0' }] }), demoBalances: [] }));
  await expect(api().getAdminProfileBalances('u1')).rejects.toMatchObject({ status: 502, code: 'SERVER_ERROR' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
