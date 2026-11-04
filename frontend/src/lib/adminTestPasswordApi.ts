import { browserFetch } from './browserActivity';
import { API_BASE, clearToken, getToken } from './api';

async function ownerTestRequest(path: string, method: 'GET' | 'POST', payload?: Record<string, string>): Promise<Record<string, unknown>> {
  const token = getToken();
  if (!token) throw Object.assign(new Error('Сессия завершена.'), { status: 401 });
  const response = await browserFetch(`${API_BASE}${path}`, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (getToken() !== token) throw new DOMException('Session changed', 'AbortError');
  const body: unknown = await response.json().catch(() => ({}));
  if (getToken() !== token) throw new DOMException('Session changed', 'AbortError');
  if (!response.ok) {
    if (response.status === 401) clearToken();
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'Не удалось выполнить действие с тестовым аккаунтом.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body && typeof body === 'object' ? body as Record<string, unknown> : {};
}

/** A nonowner admin receives allowed=false. Only owner actions are shown in the UI. */
export async function getAdminTestAccess(): Promise<{ allowed: boolean }> {
  const response = await ownerTestRequest('/admin/test-accounts/access', 'GET');
  return { allowed: response.allowed === true };
}

/** Explicit owner-created account, never a public registration password. */
export async function createAdminTestAccount(email: string, password: string): Promise<void> {
  const response = await ownerTestRequest('/admin/test-accounts', 'POST', { email, password });
  if (response.ok !== true) throw new Error('Сервер не подтвердил создание тестового аккаунта.');
}

/** Owner-selected, unfunded account only; the server enforces its own safety gate. */
export async function setAdminTestPassword(userId: string, newPassword: string): Promise<void> {
  const response = await ownerTestRequest(`/admin/users/${encodeURIComponent(userId)}/test-password`, 'POST', { newPassword });
  if (response.ok !== true) throw new Error('Сервер не подтвердил изменение пароля.');
}
