import { api } from './api';
import { adminRead } from './adminReadApi';
import type { DepositCopyUserFields } from '../pages/admin/DepositCopyBell';

export interface AdminPage<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number; asOf: string }
export type AdminUser = Awaited<ReturnType<typeof api.getAdminUsers>>[number] & DepositCopyUserFields;
export type AdminClient = Awaited<ReturnType<typeof api.getAllClients>>[number];
export type AdminWithdrawal = Awaited<ReturnType<typeof api.getAdminWithdrawals>>[number];
export type AdminProfile = Omit<Awaited<ReturnType<typeof api.getAdminUserDetail>>, 'deposits' | 'withdrawals' | 'orders' | 'purchases' | 'kycSubmissions'> & { asOf: string };
export type AdminAuditEntry = Awaited<ReturnType<typeof api.getAdminAuditLog>>[number];
export type HistoryKind = 'deposits' | 'withdrawals' | 'orders' | 'purchases' | 'kyc' | 'audit' | 'futuresOrders' | 'futuresPositions' | 'cfdPositions';
// Histories use different backend models; values are rendered per explicit kind.
export type HistoryRow = { id: string; [key: string]: unknown };
export const getAdminUsersPage = (query: string, signal?: AbortSignal) => adminRead<AdminPage<AdminUser>>(`/admin/users/page?${query}`, signal);
export const getAdminClientsPage = (query: string, signal?: AbortSignal) => adminRead<AdminPage<AdminClient>>(`/admin/clients/page?${query}`, signal);
export const getAdminWithdrawalsPage = (query: string, signal?: AbortSignal) => adminRead<AdminPage<AdminWithdrawal>>(`/admin/withdrawals/page?${query}`, signal);
export const getAdminProfile = (id: string, signal?: AbortSignal) => adminRead<AdminProfile>(`/admin/users/${encodeURIComponent(id)}/profile`, signal);
export const getAdminHistory = (id: string, kind: HistoryKind, page: number, signal?: AbortSignal) =>
  adminRead<AdminPage<HistoryRow>>(`/admin/users/${encodeURIComponent(id)}/history?kind=${kind}&page=${page}&pageSize=20`, signal);
export const getAdminAuditPage = (query: string, signal?: AbortSignal) => adminRead<AdminPage<AdminAuditEntry>>(`/admin/audit-log/page?${query}`, signal);
