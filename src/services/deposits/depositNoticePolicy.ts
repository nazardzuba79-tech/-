import BigNumber from 'bignumber.js';
import { localTime } from './depositWatchSchedule';

/**
 * Which Telegram notice a PROVEN, finalized transfer gets (Issue #699).
 *
 * Two different times exist for every stored transfer and must never be mixed:
 *   blockTimestamp  when the transaction happened on chain (authoritative);
 *   createdAt       when this exchange first recorded it (observation only).
 * "New" is decided from the chain time. A transfer that was already old when
 * it was first recorded (initial backfill of a watched address, an admin
 * checking an old TXID, a long outage) is history, not a new receipt.
 *
 * This is a NOTIFICATION policy only. It never credits, attributes, hides or
 * deletes a transfer: every row stays in Deposit and in the admin queue. The
 * micro threshold is a presentation threshold for Telegram; it is not the
 * deposit minimum and says nothing about who sent the transfer.
 */
export type NoticeClass = 'FRESH' | 'MICRO' | 'HISTORICAL' | 'TIME_UNKNOWN';
export type DigestKind = Exclude<NoticeClass, 'FRESH'>;

export interface NoticePolicy {
  /** A transfer is fresh while its chain time is at most this much older than
   * the moment it was first recorded. Must cover the longest regular gap
   * between scans (20:00 → 12:00 next day) plus a missed slot. */
  freshMaxLagMs: number;
  /** Hard limit for an individual alert: the notification Worker keeps an
   * event for 7 days, so nothing older than that can be announced as new. */
  maxAnnounceLagMs: number;
  /** A block cannot come from the future: tolerated difference between the
   * chain clock and this server's clock before the chain time is distrusted. */
  maxClockSkewMs: number;
  /** Transfers strictly below these amounts never get an individual message. */
  microBelow: Record<string, BigNumber>;
  /** 'daily' — at most one summary message per Kyiv day; 'off' — no Telegram
   * message for summarised transfers (they are still journalled). */
  digest: 'daily' | 'off';
  timeZone: string;
}

const amountOr = (value: string | undefined, fallback: string): BigNumber => {
  const text = (value ?? '').trim();
  // Up to 9 integer digits and the assets' 6 decimals; anything else is the default.
  return /^\d{1,9}(\.\d{1,6})?$/.test(text) ? new BigNumber(text) : new BigNumber(fallback);
};

/** Env overrides: DEPOSIT_NOTICE_FRESH_HOURS (1–168, default 48),
 * DEPOSIT_NOTICE_MICRO_TRX / DEPOSIT_NOTICE_MICRO_USDT (default 1; 0 turns the
 * micro class off for that asset), DEPOSIT_NOTICE_DIGEST (daily | off). */
export function noticePolicyFromEnv(env: Record<string, string | undefined> = process.env): NoticePolicy {
  // Unset, empty, zero, negative or non-numeric is the default, never "1 hour".
  const hours = Number((env.DEPOSIT_NOTICE_FRESH_HOURS ?? '').trim() || 48);
  return {
    freshMaxLagMs: Math.min(168, Math.max(1, Number.isFinite(hours) && hours > 0 ? hours : 48)) * 60 * 60_000,
    maxAnnounceLagMs: 7 * 24 * 60 * 60_000,
    maxClockSkewMs: 10 * 60_000,
    microBelow: { TRX: amountOr(env.DEPOSIT_NOTICE_MICRO_TRX, '1'), USDT: amountOr(env.DEPOSIT_NOTICE_MICRO_USDT, '1') },
    digest: env.DEPOSIT_NOTICE_DIGEST === 'off' ? 'off' : 'daily',
    timeZone: 'Europe/Kyiv',
  };
}

export interface NoticeFacts {
  asset: string;
  amount: { toString(): string };
  createdAt: Date;
  blockTimestamp: Date | null;
}

/** Pure classification. Amount first: a micro transfer is summarised whatever
 * its age. Then the chain time: unknown or implausible is never called new.
 * Age is the chain time against the RECORD time (how old the transfer already
 * was when first seen), so a late confirmation or a delayed delivery never
 * turns a real receipt into history. `now` only rejects a future block time.
 *
 * `watchedSince` is when the watcher began watching the row's address and
 * asset (null when unknown or the row did not come from the watcher). A
 * transfer mined AFTER that moment arrived while we were watching: if it was
 * recorded late, the delay is ours (scan backlog, pause, outage), not history,
 * and it is still announced with its real transaction time. Only transfers
 * that predate the watch (initial backfill) or were entered by hand (an admin
 * checking an old TXID) can be HISTORICAL. */
export function classifyNotice(row: NoticeFacts, policy: NoticePolicy, now: number, watchedSince: number | null = null): NoticeClass {
  const amount = new BigNumber(row.amount.toString());
  const below = policy.microBelow[row.asset.toUpperCase()];
  if (below && below.isGreaterThan(0) && amount.isFinite() && amount.isLessThan(below)) return 'MICRO';
  const chain = row.blockTimestamp?.getTime();
  const recorded = row.createdAt.getTime();
  if (chain === undefined || !Number.isSafeInteger(chain) || chain <= 0 || !Number.isSafeInteger(recorded)) return 'TIME_UNKNOWN';
  if (chain > now + policy.maxClockSkewMs) return 'TIME_UNKNOWN';
  const lag = recorded - chain;
  if (lag <= policy.freshMaxLagMs) return 'FRESH';
  if (watchedSince !== null && Number.isSafeInteger(watchedSince) && chain >= watchedSince && lag <= policy.maxAnnounceLagMs) return 'FRESH';
  return 'HISTORICAL';
}

export interface DigestGroup {
  kind: DigestKind;
  asset: 'TRX' | 'USDT';
  count: number;
  /** Exact decimal sum, never exponent notation. */
  total: string;
  /** Earliest / latest known chain time in the group (ms); absent when none is known. */
  from?: number;
  to?: number;
  /** MICRO only: the threshold the transfers are below, as shown to the owner. */
  below?: string;
}

const KIND_ORDER: DigestKind[] = ['MICRO', 'HISTORICAL', 'TIME_UNKNOWN'];

/** Deterministic grouping (kind, then asset) so a replayed digest is identical.
 * A chain time in the future (the reason a row is TIME_UNKNOWN) is never put
 * into a range: the Worker would refuse the whole digest. */
export function digestGroups(rows: { row: NoticeFacts; kind: DigestKind }[], policy: NoticePolicy, now: number): DigestGroup[] {
  const groups = new Map<string, DigestGroup & { sum: BigNumber }>();
  for (const { row, kind } of rows) {
    const asset = row.asset.toUpperCase();
    if (asset !== 'TRX' && asset !== 'USDT') continue;
    const key = `${kind}|${asset}`;
    const group = groups.get(key) ?? { kind, asset, count: 0, total: '0', sum: new BigNumber(0) };
    group.count++;
    group.sum = group.sum.plus(row.amount.toString());
    const chain = row.blockTimestamp?.getTime();
    if (chain !== undefined && Number.isSafeInteger(chain) && chain > 0 && chain <= now + policy.maxClockSkewMs) {
      group.from = group.from === undefined ? chain : Math.min(group.from, chain);
      group.to = group.to === undefined ? chain : Math.max(group.to, chain);
    }
    if (kind === 'MICRO') group.below = policy.microBelow[asset].toFixed();
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.asset.localeCompare(b.asset))
    .map(({ sum, ...group }) => ({ ...group, total: sum.toFixed() }));
}

/** One digest identity per chain and Kyiv calendar day: replays, restarts and
 * redeploys on the same day can only ever address the same event. */
export const digestIdFor = (chain: string, at: number, policy: NoticePolicy): string =>
  `deposit-digest:${chain}:${localTime(at, policy.timeZone).day}`;
export const digestAckIdFor = (digestId: string): string => digestId.replace(/^deposit-digest:/, 'deposit-digest-ack:');
