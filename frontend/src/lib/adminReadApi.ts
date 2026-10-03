import { browserFetch as fetch } from './browserActivity';
import { API_BASE, api, clearToken, getToken } from './api';

export type AdminGateMe = Awaited<ReturnType<typeof api.getMe>>;
export type AdminUsersResponse = Awaited<ReturnType<typeof api.getAdminUsers>>;

class AdminReadError extends Error {
  constructor(public status: number) {
    super(`Admin read failed (${status})`);
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
  if (!token) throw new AdminReadError(401);

  const response = await fetch(`${API_BASE}${path}`, {
    signal,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    if (response.status === 401 && getToken() === token) clearToken();
    throw new AdminReadError(response.status);
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
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
