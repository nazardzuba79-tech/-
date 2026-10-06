import { api } from './api';
import { adminRead, AdminReadError } from './adminReadApi';
import { compatibleAdminRead } from './adminReadCompatibility';
import type { DepositCopyUserFields } from '../pages/admin/DepositCopyBell';

export interface AdminReadCompatibility { mode: 'legacy'; complete: boolean; limit?: number; notice: string }
export interface AdminPage<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number; asOf: string; compatibility?: AdminReadCompatibility;
  legacyStats?: { totalUsers: number; newUsers24h: number; pendingKyc: number } }
export type AdminUser = Awaited<ReturnType<typeof api.getAdminUsers>>[number] & DepositCopyUserFields & { adminHidden?: boolean; hiddenAt?: string | null };
export type AdminClient = Awaited<ReturnType<typeof api.getAllClients>>[number];
export type AdminWithdrawal = Awaited<ReturnType<typeof api.getAdminWithdrawals>>[number];
type Detail = Awaited<ReturnType<typeof api.getAdminUserDetail>>;
type BalanceRows = Detail['balances'];
export type AdminProfile = Omit<Detail, 'deposits' | 'withdrawals' | 'orders' | 'purchases' | 'kycSubmissions' | 'balances' | 'demoBalances' | 'isBlocked'> & {
  balances: BalanceRows | null; demoBalances: BalanceRows | null; isBlocked: boolean | null; asOf: string; compatibility?: AdminReadCompatibility };
export type AdminAuditEntry = Awaited<ReturnType<typeof api.getAdminAuditLog>>[number];
export type HistoryKind = 'deposits' | 'withdrawals' | 'orders' | 'purchases' | 'kyc' | 'audit' | 'futuresOrders' | 'futuresPositions' | 'cfdPositions';
// Histories use different backend models; values are rendered per explicit kind.
export type HistoryRow = { id: string; [key: string]: unknown };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
// Validate decimal text without converting it to a JS number or losing precision.
const decimalText = (value: unknown) => typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
function balanceRows(value: unknown, allowUnavailable = false): void {
  if (value === null && allowUnavailable) return;
  if (!Array.isArray(value) || value.some(row => !record(row) || typeof row.asset !== 'string' || !row.asset.trim() || !decimalText(row.available) || !decimalText(row.locked))) throw new AdminReadError(502);
}
function userRows(items: AdminUser[]): AdminUser[] {
  for (const item of items) {
    if (typeof item.email !== 'string') throw new AdminReadError(502);
    balanceRows(item.balances);
  }
  return items;
}
function rows<T>(value: unknown): T[] {
  if (!Array.isArray(value) || value.some(item => !record(item) || typeof item.id !== 'string')) throw new AdminReadError(502);
  return value as T[];
}
function pageContract<T>(value: AdminPage<T>): AdminPage<T> {
  if (!record(value) || !Array.isArray(value.items) || !Number.isInteger(value.total) || value.total < 0 || !Number.isInteger(value.page) || value.page < 1 || !Number.isInteger(value.pageSize) || value.pageSize < 1 || !Number.isInteger(value.totalPages) || value.totalPages < 1 || typeof value.asOf !== 'string') throw new AdminReadError(502);
  rows(value.items); return value;
}
function queryParams(query: string) {
  const q = new URLSearchParams(query), page = Number(q.get('page') || 1), pageSize = Number(q.get('pageSize') || 20);
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new AdminReadError(400);
  const from = q.get('from'), to = q.get('to');
  if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))) || (from && to && Date.parse(from) > Date.parse(to))) throw new AdminReadError(400);
  return { q, page, pageSize, search: (q.get('search') || '').trim().toLowerCase() };
}
const includes = (search: string, ...values: unknown[]) => !search || values.some(value => typeof value === 'string' && value.toLowerCase().includes(search));
function dated(value: unknown, q: URLSearchParams) {
  const from = q.get('from'), to = q.get('to');
  if (!from && !to) return true;
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && (!from || time >= Date.parse(from)) && (!to || time <= Date.parse(to));
}
function sorted<T>(items: T[], key = 'createdAt', direction = 'desc') {
  return [...items].sort((left, right) => {
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    if (a[key] == null && b[key] != null) return 1;
    if (a[key] != null && b[key] == null) return -1;
    const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
    return (direction === 'asc' ? compared : -compared) || String(b.id).localeCompare(String(a.id));
  });
}
function legacyPage<T>(items: T[], query: string, receivedCount: number, limit?: number): AdminPage<T> {
  const { page, pageSize } = queryParams(query), complete = !limit || receivedCount < limit;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)), asOf: new Date().toISOString(),
    compatibility: { mode: 'legacy', complete, ...(limit ? { limit } : {}), notice: complete
      ? ''
      : `Сервер вернул только последние ${limit} записей. Поиск и страницы относятся к загруженной части; полное количество неизвестно.` } };
}
async function legacyRows<T>(path: string, signal?: AbortSignal) { return rows<T>(await adminRead<unknown>(path, signal)); }
async function paged<T>(capability: string, path: string, legacy: (signal?: AbortSignal) => Promise<AdminPage<T>>, signal?: AbortSignal) {
  return pageContract(await compatibleAdminRead(capability, path, legacy, signal));
}

export const getAdminUsersPage = async (query: string, signal?: AbortSignal) => {
  const result = await paged<AdminUser>('users', `/admin/users/page?${query}`, async s => {
  const all = userRows(await legacyRows<AdminUser>('/admin/users', s)), { q, search } = queryParams(query), status = q.get('status') || 'all';
  const since = Date.now() - 86_400_000;
  const selected = status === 'hidden' ? [] : all.filter(u => includes(search, u.email, u.id) && (status === 'all' || status === 'blocked' && u.isBlocked === true || status === 'active' && u.isBlocked === false || status === 'kyc-pending' && u.kycStatus === 'PENDING' || status === 'new' && Date.parse(u.createdAt) >= since));
  return { ...legacyPage(sorted(selected, ['email', 'lastLoginAt'].includes(q.get('sort') || '') ? q.get('sort')! : 'createdAt', q.get('direction') || 'desc'), query, all.length),
    legacyStats: { totalUsers: all.length, newUsers24h: all.filter(u => Date.parse(u.createdAt) >= since).length, pendingKyc: all.filter(u => u.kycStatus === 'PENDING').length } };
  }, signal);
  userRows(result.items);
  return result;
};

export const getAdminClientsPage = (query: string, signal?: AbortSignal) => paged<AdminClient>('clients', `/admin/clients/page?${query}`, async s => {
  const all = await legacyRows<AdminClient>('/admin/clients', s), { q, search } = queryParams(query), status = q.get('status') || 'all';
  return legacyPage(sorted(all.filter(u => includes(search, u.email, u.id) && (status === 'all' || u.kycStatus === status) && dated(u.latestKyc?.createdAt, q))), query, all.length);
}, signal);

export const getAdminWithdrawalsPage = (query: string, signal?: AbortSignal) => paged<AdminWithdrawal>('withdrawals', `/admin/withdrawals/page?${query}`, async s => {
  const all = await legacyRows<AdminWithdrawal>('/admin/withdrawals', s), { q, search } = queryParams(query), status = q.get('status') || 'all';
  const statuses = status === 'active' ? ['PENDING', 'APPROVED'] : status === 'processed' ? ['SENT', 'REJECTED', 'COMPLETED'] : [status];
  return legacyPage(sorted(all.filter(w => (status === 'all' || statuses.includes(w.status)) && includes(search, w.id, w.userId, w.userEmail, w.asset, w.network, w.toAddress, w.txHash))), query, all.length, 200);
}, signal);

export async function getAdminProfile(id: string, signal?: AbortSignal): Promise<AdminProfile> {
  let usedLegacy = false;
  const result = await compatibleAdminRead<AdminProfile>('profile', `/admin/users/${encodeURIComponent(id)}/profile`, async s => {
    usedLegacy = true;
    // The legacy detail route bundles histories. Do not invoke it just to open
    // an overview: use the existing customer identities and balances first.
    const users = userRows(await legacyRows<AdminUser>('/admin/users', s)), user = users.find(u => u.id === id);
    if (user) return { ...user, isBlocked: typeof user.isBlocked === 'boolean' ? user.isBlocked : null, demoBalances: null, asOf: new Date().toISOString(), compatibility: { mode: 'legacy', complete: true, notice: 'Тестовые балансы загружаются при открытии раздела «Балансы».' } };
    const clients = await legacyRows<AdminClient>('/admin/clients', s), client = clients.find(u => u.id === id);
    if (!client) throw new AdminReadError(404, 'USER_NOT_FOUND');
    return { ...client, role: client.isAdmin ? 'ADMIN' : 'USER', isBlocked: null, blockedAt: null, blockedReason: null,
      registrationIp: null, lastLoginAt: null, balances: null, demoBalances: null, asOf: new Date().toISOString(),
      compatibility: { mode: 'legacy', complete: false, notice: 'Идентификация подтверждена. Статус блокировки и финансовые данные недоступны в этом списке; откройте раздел «Балансы» для отдельной загрузки.' } };
  }, signal, true);
  if (!record(result) || result.id !== id || typeof result.email !== 'string' || !(typeof result.isBlocked === 'boolean' || usedLegacy && result.isBlocked === null)) throw new AdminReadError(502);
  balanceRows(result.balances, usedLegacy);
  balanceRows(result.demoBalances, usedLegacy);
  return result;
}

export async function getAdminProfileBalances(id: string, signal?: AbortSignal): Promise<{ balances: BalanceRows; demoBalances: BalanceRows; compatibility?: AdminReadCompatibility }> {
  const profile = await compatibleAdminRead<Pick<AdminProfile, 'id' | 'balances' | 'demoBalances' | 'compatibility'>>('profile', `/admin/users/${encodeURIComponent(id)}/profile`, async s => {
    const detail = await adminRead<Detail>(`/admin/users/${encodeURIComponent(id)}`, s);
    if (!record(detail) || detail.id !== id) throw new AdminReadError(502);
    return { id: detail.id, balances: detail.balances, demoBalances: detail.demoBalances, compatibility: { mode: 'legacy', complete: true, notice: '' } };
  }, signal, true);
  if (!record(profile) || profile.id !== id || !Array.isArray(profile.balances) || !Array.isArray(profile.demoBalances)) throw new AdminReadError(502);
  balanceRows(profile.balances);
  balanceRows(profile.demoBalances);
  return { balances: profile.balances, demoBalances: profile.demoBalances, ...(profile.compatibility ? { compatibility: profile.compatibility } : {}) };
}

export const getAdminAuditPage = (query: string, signal?: AbortSignal) => paged<AdminAuditEntry>('audit', `/admin/audit-log/page?${query}`, async s => {
  const { q, search } = queryParams(query), legacyQuery = new URLSearchParams();
  for (const key of ['action', 'userId']) if (q.get(key)) legacyQuery.set(key, q.get(key)!);
  const all = await legacyRows<AdminAuditEntry>(`/admin/audit-log${legacyQuery.size ? `?${legacyQuery}` : ''}`, s);
  return legacyPage(sorted(all.filter(row => includes(search, row.id, row.userId, row.userEmail, row.action, row.performedByAdminEmail) && dated(row.createdAt, q))), query, all.length, 200);
}, signal);

export async function getAdminHistory(id: string, kind: HistoryKind, page: number, signal?: AbortSignal): Promise<AdminPage<HistoryRow>> {
  return pageContract(await compatibleAdminRead<AdminPage<HistoryRow>>('history', `/admin/users/${encodeURIComponent(id)}/history?kind=${kind}&page=${page}&pageSize=20`, async s => {
    if (['futuresOrders', 'futuresPositions', 'cfdPositions'].includes(kind)) throw new AdminReadError(404, 'ENDPOINT_NOT_AVAILABLE');
    if (kind === 'audit') {
      const query = new URLSearchParams({ userId: id, page: String(page), pageSize: '20' });
      return getAdminAuditPage(query.toString(), s) as unknown as Promise<AdminPage<HistoryRow>>;
    }
    const detail = await adminRead<Detail>(`/admin/users/${encodeURIComponent(id)}`, s);
    if (!record(detail) || detail.id !== id) throw new AdminReadError(502);
    const all = rows<HistoryRow>(detail[kind === 'kyc' ? 'kycSubmissions' : kind as keyof Detail]);
    return legacyPage(sorted(all), `page=${page}&pageSize=20`, all.length, kind === 'kyc' ? undefined : 100);
  }, signal, true));
}
