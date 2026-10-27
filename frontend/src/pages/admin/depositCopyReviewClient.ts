import { API_BASE, getToken } from '../../lib/api';
import { browserFetch } from '../../lib/browserActivity';
import type { DepositCopyUserFields } from './DepositCopyBell';

export interface IgnoredCopyResult extends DepositCopyUserFields { userId: string; ignoredEventId: string }

/** One explicit write. No polling, retry loop, latest-user inference or balance operation. */
export async function ignoreCopySignal(userId: string, eventId: string): Promise<IgnoredCopyResult> {
  const token = getToken();
  if (!token) throw new Error('Сессия администратора недоступна.');
  const response = await browserFetch(`${API_BASE}/admin/deposit-address-copies/${encodeURIComponent(eventId)}/ignore`, {
    method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (getToken() !== token) throw new Error('Сессия изменилась. Обновите страницу.');
  if (!response.ok) throw new Error('Не удалось скрыть сигнал. Обновите страницу или повторите.');
  const body = await response.json() as IgnoredCopyResult;
  if (getToken() !== token) throw new Error('Сессия изменилась. Обновите страницу.');
  if (!body || body.userId !== userId || body.ignoredEventId !== eventId || typeof body.depositCopyLookupFailed !== 'boolean') {
    throw new Error('Не удалось подтвердить результат. Обновите страницу.');
  }
  return body;
}

/** Global unresolved count, including copies outside the current Users page.
 * One read when Users opens; no polling or financial operations. */
export async function unresolvedCopyCount(signal: AbortSignal): Promise<number> {
  const token = getToken();
  if (!token) throw new Error('Сессия администратора недоступна.');
  const response = await browserFetch(`${API_BASE}/admin/deposit-address-copies?countOnly=true`, { cache: 'no-store', signal, headers: { Authorization: `Bearer ${token}` } });
  if (getToken() !== token) throw new Error('Сессия изменилась. Обновите страницу.');
  if (!response.ok) throw new Error('Не удалось проверить копирования адреса.');
  const body = await response.json() as { pendingCount?: number };
  if (getToken() !== token) throw new Error('Сессия изменилась. Обновите страницу.');
  if (!body || !Number.isSafeInteger(body.pendingCount) || body.pendingCount! < 0) throw new Error('Не удалось проверить копирования адреса.');
  return body.pendingCount!;
}
