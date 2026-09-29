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
async function adminRead<T>(path: string, signal?: AbortSignal): Promise<T> {
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

  try {
    return (await response.json()) as T;
  } catch {
    throw new AdminReadError(502);
  }
}

export const getAdminGateMe = (signal?: AbortSignal) => adminRead<AdminGateMe>('/me', signal);
export const getAdminUsersAbortable = (signal?: AbortSignal) => adminRead<AdminUsersResponse>('/admin/users', signal);
