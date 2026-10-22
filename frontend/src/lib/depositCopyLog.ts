import { browserFetch as fetch } from './browserActivity';
import { API_BASE, getToken, onSessionChange } from './api';

/**
 * «Копировали адрес»: after the deposit dialog's «Скопировать адрес» button
 * has put an address on the clipboard, tell the server once, for the admin's
 * manual reconciliation.
 *
 * It is a note, not a payment or a claim, and nothing waits for it: the copy
 * and its «Адрес скопирован» never depend on it. It lives outside the dialog,
 * so closing the dialog or leaving the page does not cancel a send already
 * started; the request itself is `keepalive`, which lets it outlive an unload
 * where the browser allows it. Delivery is not guaranteed — no network, a
 * closed browser or a sleeping server can lose a note.
 *
 * A note that did not get through waits in a small outbox (at most 20, for
 * at most 24 hours, no token stored) and is tried once more on the next
 * return to the tab, return of the network or app start — never on a timer.
 * Each note belongs to the account whose session copied it: it is only ever
 * sent with that account's token, and a sign-out or account switch deletes
 * the outbox. A guest copies as before and nothing is recorded.
 */

export type DepositCopySource = 'wallet' | 'header' | 'otc' | 'support';

/** What the button actually wrote to the clipboard, captured at the click. */
export interface CopiedDestination {
  asset: string;
  /** Network id as the server knows it (`tron`, `ethereum`, `xrp`, …). */
  network: string;
  /** The catalogue rail (`tether:tron`) or the treasury chain shown. */
  destinationId: string;
  address: string;
  memo?: string;
  source: DepositCopySource;
}

interface CopyEventBody {
  eventId: string; asset: string; network: string; destinationId: string;
  address: string; memo?: string; source: DepositCopySource; clientCopiedAt: string;
}
interface PendingCopy { owner: string; createdAt: number; attempts: number; body: CopyEventBody }

const OUTBOX_KEY = 'voltex.depositCopyOutbox.v1';
export const COPY_OUTBOX_LIMIT = 20;
export const COPY_OUTBOX_TTL_MS = 24 * 60 * 60_000;
/** Two presses on the same address inside this window are one copy. */
export const COPY_REPEAT_GUARD_MS = 2_000;
export const COPY_SEND_TIMEOUT_MS = 8_000;
/** The first send plus one more. */
export const COPY_MAX_ATTEMPTS = 2;

let memoryOutbox: PendingCopy[] = [];
let storageUsable = true;
const sending = new Set<string>();
const lastCopyAt = new Map<string, number>();

/** The account a session token belongs to: its `sub`, decoded locally. */
export function tokenOwner(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch { return null; }
}

function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function wellFormed(value: unknown, now: number): value is PendingCopy {
  const entry = value as PendingCopy;
  return !!entry && typeof entry.owner === 'string' && typeof entry.createdAt === 'number' && typeof entry.attempts === 'number'
    && now - entry.createdAt < COPY_OUTBOX_TTL_MS && entry.createdAt <= now + 60_000
    && !!entry.body && typeof entry.body.eventId === 'string' && typeof entry.body.address === 'string';
}

function readOutbox(now = Date.now()): PendingCopy[] {
  if (storageUsable) {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((entry) => wellFormed(entry, now)) : [];
    } catch { storageUsable = false; }
  }
  return memoryOutbox.filter((entry) => wellFormed(entry, now));
}

function writeOutbox(list: PendingCopy[]) {
  const kept = list.slice(-COPY_OUTBOX_LIMIT);
  if (storageUsable) {
    try {
      if (kept.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(kept)); else localStorage.removeItem(OUTBOX_KEY);
      return;
    } catch { storageUsable = false; }
  }
  memoryOutbox = kept;
}

const without = (eventId: string) => writeOutbox(readOutbox().filter((entry) => entry.body.eventId !== eventId));

/** Keep only the signed-in account's notes; everything else is deleted. */
function keepOnly(owner: string | null) {
  const list = readOutbox();
  const kept = owner ? list.filter((entry) => entry.owner === owner) : [];
  if (kept.length !== list.length) writeOutbox(kept);
  if (!owner) memoryOutbox = [];
}

async function send(entry: PendingCopy, keepalive: boolean): Promise<void> {
  const { eventId } = entry.body;
  if (sending.has(eventId)) return;
  // Only ever with the token of the account that copied.
  const token = getToken();
  if (!token || tokenOwner(token) !== entry.owner) { keepOnly(tokenOwner(token)); return; }
  sending.add(eventId);
  // Count the attempt before it leaves, so a reload mid-flight cannot add more.
  const attempts = entry.attempts + 1;
  writeOutbox(readOutbox().map((item) => (item.body.eventId === eventId ? { ...item, attempts } : item)));
  try {
    const response = await fetch(`${API_BASE}/deposit-address-copies`, {
      method: 'POST',
      keepalive,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry.body),
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(COPY_SEND_TIMEOUT_MS) : undefined,
    });
    if (response.status === 401 || response.status === 403) keepOnly(null);
    // Recorded, already recorded, or never acceptable (400/409); a 429 is
    // respected, not retried around.
    else if (response.ok || response.status < 500) without(eventId);
    else if (attempts >= COPY_MAX_ATTEMPTS) without(eventId);
  } catch {
    // Offline, timed out or cut off by an unload: kept for one more try.
    if (attempts >= COPY_MAX_ATTEMPTS) without(eventId);
  } finally {
    sending.delete(eventId);
  }
}

/** One more try for this account's waiting notes; other accounts' are dropped. */
export function flushDepositCopyOutbox(): void {
  const owner = tokenOwner(getToken());
  keepOnly(owner);
  if (!owner) return;
  for (const entry of readOutbox()) if (entry.attempts < COPY_MAX_ATTEMPTS) void send(entry, false);
}

/**
 * Call after `navigator.clipboard.writeText` resolved for an address. Never
 * throws and returns at once; the request runs on its own.
 */
export function reportDepositAddressCopy(destination: CopiedDestination, now = Date.now()): void {
  try {
    const owner = tokenOwner(getToken());
    if (!owner) return;
    const key = `${owner}|${destination.destinationId}|${destination.address}|${destination.memo ?? ''}`;
    const previous = lastCopyAt.get(key);
    if (previous !== undefined && now - previous < COPY_REPEAT_GUARD_MS) return;
    lastCopyAt.set(key, now);
    const entry: PendingCopy = {
      owner, createdAt: now, attempts: 0,
      body: {
        eventId: newEventId(), asset: destination.asset, network: destination.network, destinationId: destination.destinationId,
        address: destination.address, ...(destination.memo ? { memo: destination.memo } : {}), source: destination.source,
        clientCopiedAt: new Date(now).toISOString(),
      },
    };
    keepOnly(owner);
    writeOutbox([...readOutbox(), entry]);
    void send(entry, true);
  } catch { /* the copy itself already succeeded; a lost note is acceptable */ }
}

let started = false;
/** App start: one try for notes left from before, and the retry triggers. */
export function startDepositCopyLog(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  onSessionChange(() => { lastCopyAt.clear(); keepOnly(tokenOwner(getToken())); });
  window.addEventListener('online', flushDepositCopyOutbox);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushDepositCopyOutbox(); });
  flushDepositCopyOutbox();
}

/** Test seam. */
export function resetDepositCopyLogForTests(): void {
  memoryOutbox = []; storageUsable = true; sending.clear(); lastCopyAt.clear(); started = false;
}
