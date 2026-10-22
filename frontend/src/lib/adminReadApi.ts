import { browserFetch as fetch } from './browserActivity';
import { API_BASE, api, clearToken, getToken } from './api';

export type AdminGateMe = Awaited<ReturnType<typeof api.getMe>>;
export type AdminUsersResponse = Awaited<ReturnType<typeof api.getAdminUsers>>;

export type AdminReadErrorCode = 'USER_NOT_FOUND' | 'ENDPOINT_NOT_AVAILABLE' | 'NETWORK_ERROR' | 'SESSION_EXPIRED' | 'FORBIDDEN' | 'SERVER_ERROR';
export class AdminReadError extends Error {
  readonly code: AdminReadErrorCode;
  constructor(public status: number, code?: AdminReadErrorCode) {
    super(`Admin read failed (${status})`);
    this.code = code ?? (status === 401 ? 'SESSION_EXPIRED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'ENDPOINT_NOT_AVAILABLE' : 'SERVER_ERROR');
  }
}

/**
 * Abortable GET for Admin UI reads that must have a hard client timeout.
 *
 * Kept outside api.ts deliberately: the shared account/Spot/Futures API is
 * byte-pinned by trading regression tests. This helper adds only Admin UI
 * cancellation semantics and does not change those contracts.
 */
export async function adminRead<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const checkSession = () => { if (signal?.aborted || getToken() !== token) throw new DOMException('Session changed', 'AbortError'); };
  checkSession();
  if (!token) throw new AdminReadError(401);

  let response: Response;
  try { response = await fetch(`${API_BASE}${path}`, {
    signal,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  }); } catch (error) {
    checkSession();
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new AdminReadError(0, 'NETWORK_ERROR');
  }
  checkSession();

  if (!response.ok) {
    if (response.status === 401 && getToken() === token) clearToken();
    let userMissing = false;
    if (response.status === 404) {
      // Only known identity errors are accepted; never expose arbitrary server
      // bodies, HTML, identifiers or credentials in operator messages.
      try { const body = await response.json(); userMissing = body?.code === 'USER_NOT_FOUND' || body?.error === 'User not found' || body?.error === 'Пользователь не найден'; } catch { /* generic missing route */ }
      checkSession();
    }
    throw new AdminReadError(response.status, userMissing ? 'USER_NOT_FOUND' : undefined);
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    checkSession();
    throw new AdminReadError(502);
  }
  if (signal?.aborted || getToken() !== token) throw new DOMException('Session changed', 'AbortError');
  return data;
}

export const getAdminGateMe = (signal?: AbortSignal) => adminRead<AdminGateMe>('/me', signal);
export const getAdminUsersAbortable = (signal?: AbortSignal) => adminRead<AdminUsersResponse>('/admin/users', signal);
export const getAdminUserDetailAbortable = (id: string, signal?: AbortSignal) =>
  adminRead<Awaited<ReturnType<typeof api.getAdminUserDetail>>>(`/admin/users/${encodeURIComponent(id)}`, signal);
export const getAdminWithdrawalsAbortable = (signal?: AbortSignal) =>
  adminRead<Awaited<ReturnType<typeof api.getAdminWithdrawals>>>('/admin/withdrawals', signal);
export const getAdminKycDeliveryAbortable = (signal?: AbortSignal) =>
  adminRead<Awaited<ReturnType<typeof api.getKycDelivery>>>('/kyc/admin/delivery', signal);

/** Return bytes, not an object URL: the mounted document viewer owns URL lifetime. */
export async function getAdminKycDocumentAbortable(submissionId: string, signal?: AbortSignal): Promise<Blob> {
  const token = getToken();
  if (!token) throw new AdminReadError(401);
  const response = await fetch(`${API_BASE}/kyc/${encodeURIComponent(submissionId)}/document`, {
    signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
  });
  if (getToken() !== token || signal?.aborted) throw new DOMException('Session changed', 'AbortError');
  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new AdminReadError(response.status);
  }
  const blob = await response.blob();
  if (getToken() !== token || signal?.aborted) throw new DOMException('Session changed', 'AbortError');
  return blob;
}
