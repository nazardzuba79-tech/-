import { getToken } from './api';

// Rollout requires a verified legacy-address snapshot in persistent storage.
// Until then the existing treasury-based flow remains exactly the default.
export const MANUAL_DEPOSIT_CATALOGUE = import.meta.env.VITE_MANUAL_DEPOSIT_CATALOGUE === 'true';
const BASE = import.meta.env.VITE_API_URL || '/api/v1';
export interface CatalogueEntry {
  assetId: string; asset: string; networkId: string; networkName: string;
  standard: string; address: string; memoAllowed: boolean; memo: string; memoLabel: string;
  enabled: boolean; status?: 'configured' | 'unconfigured' | 'disabled';
}
export interface AdminCatalogue {
  revision: string; rankingAvailable: boolean;
  assets: { assetId: string; asset: string; name: string; rank: number; top: boolean }[];
  entries: CatalogueEntry[];
}
async function catalogueRequest<T>(path: string, options: RequestInit = {}, admin = false): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { ...options, cache: 'no-store', headers: {
    ...(admin ? { Authorization: `Bearer ${getToken() ?? ''}` } : {}), ...options.headers,
  } });
  if (!response.ok) throw new Error(response.status === 409 ? 'Конфигурация изменилась. Обновите список перед сохранением.'
    : response.status === 503 ? 'Хранилище адресов недоступно. Изменения не сохранены.' : 'Не удалось выполнить запрос.');
  return response.json();
}
export const getAdminCatalogue = (refresh = false) => catalogueRequest<AdminCatalogue>(`/admin/deposit-catalogue${refresh ? '?refresh=true' : ''}`, {}, true);
export const saveCatalogueEntry = (entry: CatalogueEntry, revision: string) => catalogueRequest<{ revision: string }>('/admin/deposit-catalogue', {
  method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': revision },
  body: JSON.stringify({ assetId: entry.assetId, networkId: entry.networkId, address: entry.address,
    enabled: entry.enabled, memo: entry.memo, memoLabel: entry.memoAllowed ? entry.memoLabel : '' }),
}, true);
let pending: Promise<{ version: string; entries: CatalogueEntry[] }> | null = null;
export function getPublicCatalogue() {
  // Share concurrent opens only. Reopening always revalidates; no localStorage,
  // prefetch, timers, stale fallback or per-row address requests.
  if (!pending) {
    pending = catalogueRequest<{ version: string; entries: CatalogueEntry[] }>('/deposit-catalogue').then(value => {
      if (!value || typeof value.version !== 'string' || !Array.isArray(value.entries) || value.entries.some(e =>
        !e.enabled || !e.address || typeof e.address !== 'string' || !e.asset || !e.networkId)) throw new Error('Invalid catalogue');
      return value;
    }).finally(() => { pending = null; });
  }
  return pending;
}
