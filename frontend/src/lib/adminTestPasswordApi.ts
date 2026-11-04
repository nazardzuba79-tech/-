import { browserFetch } from './browserActivity';
import { API_BASE, clearToken, getToken } from './api';

/** Owner-only test account password assignment. Never log credentials. */
export async function setAdminTestPassword(userId: string, newPassword: string): Promise<void> {
  const token = getToken();
  if (!token) throw Object.assign(new Error('Сессия завершена.'), { status: 401 });
  const response = await browserFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/test-password`, {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
  if (getToken() !== token) throw new DOMException('Session changed', 'AbortError');
  const body = await response.json().catch(() => ({}));
  if (getToken() !== token) throw new DOMException('Session changed', 'AbortError');
  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw Object.assign(new Error(typeof body.error === 'string' ? body.error : 'Не удалось установить пароль.'), { status: response.status });
  }
  if (body.ok !== true) throw new Error('Сервер не подтвердил изменение пароля.');
}
