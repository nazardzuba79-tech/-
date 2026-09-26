import { API_BASE, getToken } from '../../lib/api';

/** Admin deposit registry calls (kept out of lib/api.ts on purpose). Every
 * amount, status and state here comes from the server; nothing is sent back
 * that could set an amount or a status. */

export type DepositRowState = 'CREDITED' | 'NEEDS_REVIEW' | 'UNATTRIBUTED' | 'AWAITING_CONFIRMATIONS' | 'AWAITING_TOPUP' | 'READY' | 'IGNORED';

export interface DepositQueueRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  chain: string;
  asset: string;
  txHash: string;
  amount: string;
  confirmations: number;
  minConfirmations: number;
  finalized: boolean;
  verified: boolean;
  networkConfirmed: boolean;
  verifyError: string | null;
  recipientAddress: string | null;
  blockTimestamp: string | null;
  firstDetectedAt: string;
  creditedAt: string | null;
  batchId: string | null;
  revision: number;
  source: string | null;
  state: DepositRowState;
  claims: { userId: string; email: string | null; at: string }[];
  ignoredAt: string | null;
  ignoredReason: string | null;
  ignoredNote: string | null;
  ignoredByAdminId: string | null;
}

export interface CreditedBatch {
  id: string;
  userId: string;
  userEmail: string | null;
  chain: string;
  asset: string;
  totalAmount: string;
  createdAt: string;
  approvedByAdminId: string;
  transfers: { id: string; txHash: string; amount: string; confirmations: number; blockTimestamp: string | null }[];
}

export type IgnoreReason = 'HISTORICAL_WALLET_OPERATION' | 'OWN_TRANSFER' | 'NOT_CLIENT_DEPOSIT' | 'OTHER';
export const IGNORE_REASON_LABEL: Record<string, string> = {
  HISTORICAL_WALLET_OPERATION: 'Историческая операция кошелька',
  OWN_TRANSFER: 'Мой собственный перевод',
  NOT_CLIENT_DEPOSIT: 'Не является депозитом клиента',
  OTHER: 'Другое',
  LEGACY_IGNORE: 'Скрыт ранее (старая лента)',
};

export interface DepositPackage {
  key: string;
  userId: string;
  userEmail: string | null;
  chain: string;
  asset: string;
  transfers: DepositQueueRow[];
  total: string;
  unconfirmedTotal: string;
  unconfirmedCount: number;
  minDepositUsd: number;
  usdValue: string | null;
  usdPolicy: 'USD_PEGGED_POLICY' | 'MARKET_PRICE' | null;
  priceUsd: string | null;
  pricedAt: string | null;
  minimumReached: boolean;
  remaining: string | null;
  remainingUsd: string | null;
  state: 'AWAITING_TOPUP' | 'READY' | 'NEEDS_REVIEW';
  reviewReason: 'PRICE_UNAVAILABLE' | 'PRICE_STALE' | null;
  token: string;
}

export interface PackagePreview extends DepositPackage {
  balanceAvailable: string;
  balanceAfter: string;
}

export interface WatcherStatus {
  chain: string;
  enabled: boolean;
  running: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastRunOk: boolean | null;
  lastRunTrigger: string | null;
  lastScheduledRunAt: string | null;
  lastAdminOpenRunAt: string | null;
  nextScheduledRunAt: string | null;
  adminOpenDueToday: boolean;
  lastRunSummary: { error?: string | null; newTransfers?: number; pagesRead?: number; providerCalls?: number; backlog?: boolean; durationMs?: number } | null;
  providerStatus: string | null;
  unverifiedOrUnfinalized: number;
  cursors: { address: string; asset: string; scannedThrough: string; lagMs: number; windowInProgress: boolean; windowStart: string | null; windowEnd: string | null; lastError: string | null; lastErrorAt: string | null }[];
  policy: { timeZone: string; slots: string[]; dayStart: string; nightStart: string; dedupeMinutes: number; pageSize: number; maxPagesPerRun: number; overlapMinutes: number; initialBackfillDays: number };
}

export interface DepositQueue {
  asOf: string;
  minDepositUsd: number;
  counts: Record<DepositRowState, number> & { uncreditedTotal: number; truncated: boolean };
  packageCounts: { AWAITING_TOPUP: number; READY: number; NEEDS_REVIEW: number };
  packages: DepositPackage[];
  rows: DepositQueueRow[];
  creditedBatches: CreditedBatch[];
  watcher: WatcherStatus;
}

export class AdminDepositApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) { super(message); }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new AdminDepositApiError('Admin session unavailable', 401, null);
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* empty body */ }
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new AdminDepositApiError(message, response.status, typeof body?.code === 'string' ? body.code : null);
  }
  return body as T;
}

export const adminDepositApi = {
  queue: () => call<DepositQueue>('/admin/deposit-queue'),
  attribute: (depositId: string, userId: string | null, reassign = false) =>
    call<{ depositId: string; userId: string | null; changed: boolean }>(`/admin/deposits/${encodeURIComponent(depositId)}/attribute`, { method: 'POST', body: { userId, reassign } }),
  ignore: (depositId: string, reason: IgnoreReason, note: string | null, confirmAssigned = false) =>
    call<{ depositId: string; ignoredAt: string; reason: string }>(`/admin/deposits/${encodeURIComponent(depositId)}/ignore`, { method: 'POST', body: { reason, note, confirmAssigned } }),
  restore: (depositId: string) =>
    call<{ depositId: string; restored: boolean }>(`/admin/deposits/${encodeURIComponent(depositId)}/restore`, { method: 'POST', body: {} }),
  checkTx: (params: { chain: string; txHash: string; asset: string }) =>
    call<{ ok: boolean; reason?: string; error?: string; amount?: string; confirmations?: number; finalized?: boolean; status?: string | null; depositId?: string | null; blockTimestamp?: string | null }>(
      '/admin/deposits/check-tx', { method: 'POST', body: params }),
  preview: (params: { userId: string; chain: string; asset: string }) =>
    call<PackagePreview>(`/admin/deposit-packages/preview?${new URLSearchParams(params)}`),
  confirm: (params: { userId: string; chain: string; asset: string; depositIds: string[]; token: string; idempotencyKey: string }) =>
    call<{ status: 'CREDITED'; batchId: string; totalAmount: string; asset: string; depositIds: string[]; replayed: boolean }>(
      '/admin/deposit-packages/confirm', { method: 'POST', body: params }),
  /** The day's first automatic scan; the server decides (NOT_DUE otherwise). */
  openTrigger: () => call<{ ran: boolean; ok: boolean; skipped: string | null; notDueReason: string | null; newTransfers: number; error: string | null }>(
    '/admin/deposit-watch/open', { method: 'POST', body: {} }),
  runWatcher: () => call<{ ok: boolean; skipped?: string; error?: string | null; newTransfers: number }>('/admin/deposit-watch/run', { method: 'POST', body: {} }),
  setWatcherEnabled: (enabled: boolean) => call<WatcherStatus>('/admin/deposit-watch/enabled', { method: 'POST', body: { enabled } }),
};

export const STATE_LABEL: Record<DepositRowState, string> = {
  UNATTRIBUTED: 'Не привязан',
  AWAITING_CONFIRMATIONS: 'Ожидает подтверждений сети',
  AWAITING_TOPUP: 'Ожидает доплаты',
  READY: 'Готов к проверке',
  NEEDS_REVIEW: 'Требует уточнения',
  CREDITED: 'Зачислен',
  IGNORED: 'Игнорирован',
};

/** A browser-generated idempotency key, one per opened confirmation. */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
