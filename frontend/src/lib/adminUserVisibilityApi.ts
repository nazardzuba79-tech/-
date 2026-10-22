import { browserFetch } from './browserActivity';
import { API_BASE, clearToken, getToken } from './api';

export async function setAdminUserHidden(userId: string, hidden: boolean): Promise<void> {
  const token = getToken();
  if (!token) throw Object.assign(new Error('Сессия завершена.'), { status: 401 });
  const controller = new AbortController();
  const response = await browserFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/${hidden ? 'hide' : 'unhide'}`, {
    method: 'POST',
    signal: controller.signal,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (getToken() !== token) throw new DOMException('Session changed', 'AbortError');
  const body = await response.json().catch(() => ({}));
  if (getToken() !== token) throw new DOMException('Session changed', 'AbortError');
  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw Object.assign(new Error(typeof body.error === 'string' ? body.error : 'Не удалось изменить видимость аккаунта.'), { status: response.status });
  }
  if (body.hidden !== hidden) throw new Error('Сервер не подтвердил изменение видимости аккаунта.');
}
