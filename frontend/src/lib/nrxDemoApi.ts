import { browserFetch as fetch } from './browserActivity';
import { API_BASE, getToken, type VtaDemoSnapshot, type VtaSaleReceipt } from './api';

export type NrxDemoSnapshot = Omit<VtaDemoSnapshot, 'valuationSource'> & { valuationSource: 'NEURIX_SIMULATION' };
export class NrxDemoApiError extends Error {
  constructor(message: string, readonly status: number, readonly rejected: boolean) { super(message); }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const decimal = (v: unknown): v is string => typeof v === 'string' && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v) && Number.isFinite(Number(v));
const validReceipt = (v: any): v is VtaSaleReceipt => v && uuid(v.id) && ['price', 'quantity', 'proceeds'].every(k => decimal(v[k]) && Number(v[k]) > 0);
const normalizedQuantity = (v: string) => v.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const malformed = () => new NrxDemoApiError('Не удалось подтвердить ответ сервиса симуляции.', 502, false);

/** No legacy /orders fallback, automatic POST retry or client execution price.
 * A timeout or malformed success leaves the same request key unresolved. */
async function request(path: string, body?: { requestId: string; quantity: string }): Promise<any> {
  const token = getToken();
  if (!token) throw new NrxDemoApiError('Требуется вход в аккаунт.', 401, false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE}/demo/nrx${path}`, {
      method: body ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (getToken() !== token) throw new NrxDemoApiError('Аккаунт изменился.', 409, false);
    const json = await response.json();
    if (getToken() !== token) throw new NrxDemoApiError('Аккаунт изменился.', 409, false);
    if (!response.ok) throw new NrxDemoApiError(
      response.status === 404 ? 'Сервис симуляции ещё не обновлён. Повторите позже.' :
        response.status === 400 && typeof json?.error === 'string' ? json.error : 'Не удалось подтвердить операцию.',
      response.status, response.status === 400 && json?.simulationOutcome === 'REJECTED');
    return json;
  } finally { clearTimeout(timer); }
}
export const nrxDemoApi = {
  snapshot: async (): Promise<NrxDemoSnapshot> => {
    const value = await request('');
    if (value?.valuationSource !== 'NEURIX_SIMULATION' || value?.account?.scope !== 'SIMULATION_SPOT'
      || value.account.cashPolicy !== 'SHARED_DEMO_BALANCE' || typeof value.account.id !== 'string' || !value.account.id
      || !Array.isArray(value.balances) || !['NRX', 'USDT'].every(asset => value.balances.some((b: any) => b.asset === asset && decimal(b.available) && decimal(b.locked)))
      || !Array.isArray(value.sales) || !value.sales.every(validReceipt)) throw malformed();
    return value;
  },
  operation: async (requestId: string): Promise<{ receipt: (VtaSaleReceipt & { createdAt?: string }) | null }> => {
    const value = await request(`/sales/${encodeURIComponent(requestId)}`);
    if (!value || !('receipt' in value) || (value.receipt !== null && !validReceipt(value.receipt))) throw malformed();
    return value;
  },
  sell: async (requestId: string, quantity: string): Promise<VtaSaleReceipt> => {
    const value = await request('/sell', { requestId, quantity });
    if (!validReceipt(value) || normalizedQuantity(value.quantity) !== normalizedQuantity(quantity)) throw malformed();
    return value;
  },
};
