import { browserFetch } from './browserActivity';
import { API_BASE, getToken, clearToken } from './api';
import { adminRead } from './adminReadApi';
export interface SpamEmailEntry { email: string; addedAt: string; addedBy: string }
export const getSpamEmails = (signal?: AbortSignal) => adminRead<{ entries: SpamEmailEntry[] }>('/admin/spam-emails', signal);
export async function setSpamEmail(email: string, blocked: boolean) {
  const token = getToken();
  if (!token) throw new Error('Войдите в аккаунт.');
  const res = await browserFetch(`${API_BASE}/admin/spam-emails/${blocked ? 'block' : 'unblock'}`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  if (getToken() !== token) throw new Error('Сессия изменилась.');
  if (!res.ok || body.ok !== true) {
    if (res.status === 401) clearToken();
    throw new Error(res.status === 403 ? 'Недостаточно прав.' : 'Не удалось изменить список. Обновите его, чтобы проверить результат.');
  }
}
