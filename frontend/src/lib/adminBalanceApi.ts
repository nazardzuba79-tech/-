import { browserFetch } from './browserActivity';
import { API_BASE, clearToken, getToken } from './api';
import { adminRead } from './adminReadApi';
export type AdjustmentIntent = { asset: string; amount: string; reason: string; idempotencyKey: string };
export type AdjustmentReceipt = { status: 'APPLIED'; operationId: string; userId: string; account: 'SPOT'; asset: string; amount: string; reason: string; availableBefore: string; available: string; locked: string; createdAt: string };
export async function postAdminAdjustment(id: string, intent: AdjustmentIntent, signal: AbortSignal): Promise<AdjustmentReceipt> {
  const token = getToken();
  if (!token) throw Object.assign(new Error('Сессия завершена.'), { status: 401 });
  const response = await browserFetch(`${API_BASE}/admin/users/${encodeURIComponent(id)}/balance-adjustments`, {
    method: 'POST', signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(intent),
  });
  if (getToken() !== token || signal.aborted) throw new DOMException('Session changed', 'AbortError');
  const body = await response.json();
  if (getToken() !== token || signal.aborted) throw new DOMException('Session changed', 'AbortError');
  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw Object.assign(new Error(typeof body.error === 'string' ? body.error : 'Не удалось выполнить корректировку.'), { status: response.status });
  }
  if (getToken() !== token || signal.aborted) throw new DOMException('Session changed', 'AbortError');
  if (body.status !== 'APPLIED' || body.operationId !== intent.idempotencyKey || body.userId !== id) throw new Error('Результат операции не подтверждён.');
  return body;
}
export const readAdminAdjustment = (id: string, key: string, signal: AbortSignal) => adminRead<AdjustmentReceipt>(`/admin/users/${encodeURIComponent(id)}/balance-adjustments/${encodeURIComponent(key)}`, signal);

/** Exact decimal preview only. The existing server ledger remains authoritative. */
export function adjustmentPreview(before: string, delta: string): string | null {
  const parse = (s: string) => {
    if (!/^[+-]?\d{1,20}(?:\.\d{1,18})?$/.test(s)) return null;
    const negative = s[0] === '-', [whole, fraction = ''] = s.replace(/^[+-]/, '').split('.');
    return BigInt(whole + fraction.padEnd(18, '0')) * (negative ? -1n : 1n);
  };
  const a = parse(before), b = parse(delta);
  if (a === null || b === null || b === 0n) return null;
  const sum = a + b, raw = (sum < 0n ? -sum : sum).toString().padStart(19, '0');
  return (sum < 0n ? '-' : '') + raw.slice(0, -18) + (raw.slice(-18).replace(/0+$/, '') ? '.' + raw.slice(-18).replace(/0+$/, '') : '');
}
