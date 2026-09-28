export type VtaSaleIntent = { requestId: string; quantity: string };
const key = (accountId: string) => `voltex:vta-sale:v1:${accountId}`;
// No credentials or receipts. Only the exact unresolved intent, scoped by the
// server-authenticated account ID. Storage failure must prevent a new POST.
export function readVtaIntent(accountId: string): VtaSaleIntent | null {
  const raw = localStorage.getItem(key(accountId));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!/^[\da-f-]{36}$/i.test(value.requestId) || typeof value.quantity !== 'string'
    || !/^\d+(?:\.\d{1,8})?$/.test(value.quantity)) throw new Error('Не удалось восстановить запрос продажи.');
  return { requestId: value.requestId, quantity: value.quantity };
}
export function prepareVtaIntent(accountId: string, quantity: string): VtaSaleIntent {
  const existing = readVtaIntent(accountId);
  if (existing) return existing;
  if (!/^\d+(?:\.\d{1,8})?$/.test(quantity)) throw new Error('Введите количество: не более 8 знаков после запятой.');
  const intent = { requestId: crypto.randomUUID(), quantity };
  localStorage.setItem(key(accountId), JSON.stringify(intent));
  return intent;
}
export function clearVtaIntent(accountId: string, requestId: string) {
  if (readVtaIntent(accountId)?.requestId === requestId) localStorage.removeItem(key(accountId));
}
/** Serializes explicit submits across tabs, including intent creation. */
export async function withVtaSaleLock<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return Promise.reject(new Error('Этот браузер не поддерживает безопасное восстановление продажи.'));
  return await navigator.locks.request(key(accountId), run);
}
