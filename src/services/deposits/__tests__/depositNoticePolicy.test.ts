import BigNumber from 'bignumber.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyNotice, digestAckIdFor, digestGroups, digestIdFor, noticePolicyFromEnv } from '../depositNoticePolicy';

const HOUR = 60 * 60_000, DAY = 24 * HOUR;
const policy = noticePolicyFromEnv({});
const recorded = Date.UTC(2026, 10, 11, 10, 0, 0); // a 12:00 Kyiv scan
const row = (asset: string, amount: string, chainAgeMs: number | null, createdAt = recorded) => ({
  asset, amount: { toString: () => amount }, createdAt: new Date(createdAt), blockTimestamp: chainAgeMs === null ? null : new Date(createdAt - chainAgeMs),
});

describe('Issue #699 — what counts as a new receipt', () => {
  test('defaults: 48 h freshness, micro below 1 TRX / 1 USDT, one digest per Kyiv day', () => {
    expect(policy.freshMaxLagMs).toBe(48 * HOUR); expect(policy.maxAnnounceLagMs).toBe(7 * DAY);
    expect(policy.microBelow.TRX.toFixed()).toBe('1'); expect(policy.microBelow.USDT.toFixed()).toBe('1');
    expect(policy.digest).toBe('daily'); expect(policy.timeZone).toBe('Europe/Kyiv');
  });
  test('env overrides are clamped; nonsense falls back to the defaults', () => {
    expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_FRESH_HOURS: '24' }).freshMaxLagMs).toBe(24 * HOUR);
    expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_FRESH_HOURS: '0.5' }).freshMaxLagMs).toBe(1 * HOUR);
    expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_FRESH_HOURS: '9999' }).freshMaxLagMs).toBe(168 * HOUR);
    // An empty, zero, negative or non-numeric value must never shrink the window to an hour.
    for (const bad of ['', '   ', '0', '-5', 'soon', 'NaN']) expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_FRESH_HOURS: bad }).freshMaxLagMs).toBe(48 * HOUR);
    expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_MICRO_TRX: '0.5', DEPOSIT_NOTICE_MICRO_USDT: '0' }).microBelow).toEqual({ TRX: new BigNumber('0.5'), USDT: new BigNumber(0) });
    for (const bad of ['-1', 'abc', '1e3', '', '0.0000001', 'Infinity', '1'.repeat(21), '1234567890']) expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_MICRO_TRX: bad }).microBelow.TRX.toFixed()).toBe('1');
    expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_DIGEST: 'off' }).digest).toBe('off');
    expect(noticePolicyFromEnv({ DEPOSIT_NOTICE_DIGEST: 'hourly' }).digest).toBe('daily');
  });

  test('the incident: native dust mined 14–15 h before the scan is MICRO, never a new receipt', () => {
    for (const [amount, age] of [['0.000005', 15 * HOUR], ['0.000002', 14.8 * HOUR], ['0.000004', 14.6 * HOUR], ['0.000001', 14.5 * HOUR], ['0.000003', 13.75 * HOUR]] as const) {
      expect(classifyNotice(row('TRX', amount, age), policy, recorded)).toBe('MICRO');
    }
  });
  test('a real transfer sent after the last evening scan and found the next noon is FRESH', () => {
    expect(classifyNotice(row('TRX', '1500.25', 14 * HOUR), policy, recorded)).toBe('FRESH');
    expect(classifyNotice(row('USDT', '1010', 30 * 60_000), policy, recorded)).toBe('FRESH');
    expect(classifyNotice(row('USDT', '17', 47 * HOUR), policy, recorded)).toBe('FRESH');
    expect(classifyNotice(row('USDT', '17', 48 * HOUR), policy, recorded)).toBe('FRESH'); // boundary is inclusive
  });
  test('already old when first recorded (backfill, an admin checking an old TXID): HISTORICAL whatever the amount', () => {
    expect(classifyNotice(row('USDT', '17', 48 * HOUR + 1), policy, recorded)).toBe('HISTORICAL');
    expect(classifyNotice(row('TRX', '1500.25', 4 * DAY), policy, recorded)).toBe('HISTORICAL');
    expect(classifyNotice(row('USDT', '500000', 7 * DAY), policy, recorded)).toBe('HISTORICAL');
  });
  test('the decision uses the chain time against the RECORD time, so a late confirmation or a late delivery never ages a receipt', () => {
    // Recorded 20 minutes after the block; proven and delivered days later — the row itself has not changed.
    const lateProof = row('USDT', '250', 20 * 60_000, recorded - 5 * DAY);
    expect(classifyNotice(lateProof, policy, recorded)).toBe('FRESH');
  });
  test('recorded late but mined while the address was already watched (scan backlog, pause, outage): still a new receipt', () => {
    const watchedSince = recorded - 30 * DAY;
    expect(classifyNotice(row('TRX', '5000', 3 * DAY), policy, recorded, watchedSince)).toBe('FRESH');
    expect(classifyNotice(row('USDT', '700', 7 * DAY), policy, recorded, watchedSince)).toBe('FRESH'); // the Worker's 7-day limit, inclusive
    expect(classifyNotice(row('USDT', '700', 7 * DAY + 1), policy, recorded, watchedSince)).toBe('HISTORICAL');
    // Mined BEFORE watching began (the initial backfill) or with no watch record (an admin-entered TXID): history.
    expect(classifyNotice(row('TRX', '5000', 3 * DAY), policy, recorded, recorded - 2 * DAY)).toBe('HISTORICAL');
    expect(classifyNotice(row('TRX', '5000', 3 * DAY), policy, recorded, null)).toBe('HISTORICAL');
    expect(classifyNotice(row('TRX', '5000', 3 * DAY), policy, recorded)).toBe('HISTORICAL');
    // The watch moment never rescues dust or an untrusted chain time.
    expect(classifyNotice(row('TRX', '0.000003', 3 * DAY), policy, recorded, watchedSince)).toBe('MICRO');
    expect(classifyNotice(row('TRX', '40', null), policy, recorded, watchedSince)).toBe('TIME_UNKNOWN');
  });
  test('createdAt alone can never make a transfer new (the defect): same record time, different chain times', () => {
    expect(classifyNotice(row('TRX', '40', 1 * HOUR), policy, recorded)).toBe('FRESH');
    expect(classifyNotice(row('TRX', '40', 6 * DAY), policy, recorded)).toBe('HISTORICAL');
  });
  test('no chain time, an impossible chain time or one after the record: TIME_UNKNOWN, never new', () => {
    expect(classifyNotice(row('TRX', '40', null), policy, recorded)).toBe('TIME_UNKNOWN');
    expect(classifyNotice({ ...row('TRX', '40', 0), blockTimestamp: new Date(0) }, policy, recorded)).toBe('TIME_UNKNOWN');
    expect(classifyNotice({ ...row('TRX', '40', 0), blockTimestamp: new Date(NaN) }, policy, recorded)).toBe('TIME_UNKNOWN');
    expect(classifyNotice(row('USDT', '40', -11 * 60_000), policy, recorded)).toBe('TIME_UNKNOWN'); // a block from the future
    expect(classifyNotice(row('USDT', '40', -9 * 60_000), policy, recorded)).toBe('FRESH'); // bounded clock difference
    // The database clock running behind the server clock is not "history": the block is not in the future.
    expect(classifyNotice(row('USDT', '40', -3 * HOUR), policy, recorded + 3 * HOUR)).toBe('FRESH');
  });
  test('TRX and USDT thresholds are separate and strict (below, not equal); an unlisted asset has no micro class', () => {
    expect(classifyNotice(row('TRX', '0.999999', HOUR), policy, recorded)).toBe('MICRO');
    expect(classifyNotice(row('TRX', '1', HOUR), policy, recorded)).toBe('FRESH');
    expect(classifyNotice(row('USDT', '0.999999', HOUR), policy, recorded)).toBe('MICRO');
    expect(classifyNotice(row('USDT', '1', HOUR), policy, recorded)).toBe('FRESH');
    const custom = noticePolicyFromEnv({ DEPOSIT_NOTICE_MICRO_TRX: '10', DEPOSIT_NOTICE_MICRO_USDT: '0' });
    expect(classifyNotice(row('TRX', '9.5', HOUR), custom, recorded)).toBe('MICRO');
    expect(classifyNotice(row('USDT', '0.000001', HOUR), custom, recorded)).toBe('FRESH'); // micro class off for USDT
    expect(classifyNotice(row('trx', '0.5', HOUR), policy, recorded)).toBe('MICRO');
  });
  test('old dust is MICRO (summarised as dust), not a "historical deposit"', () => {
    expect(classifyNotice(row('TRX', '0.000002', 5 * DAY), policy, recorded)).toBe('MICRO');
    expect(classifyNotice(row('TRX', '0.000002', null), policy, recorded)).toBe('MICRO');
  });
});

describe('digest', () => {
  test('groups by kind then asset with exact sums, chain-time range and the micro threshold; deterministic order', () => {
    const input = [
      { row: row('USDT', '500', 6 * DAY), kind: 'HISTORICAL' as const },
      { row: row('TRX', '0.000009', 15 * HOUR), kind: 'MICRO' as const },
      { row: row('TRX', '0.000003', 13 * HOUR), kind: 'MICRO' as const },
      { row: row('USDT', '0.000001', 2 * HOUR), kind: 'MICRO' as const },
      { row: row('TRX', '3', null), kind: 'TIME_UNKNOWN' as const },
      { row: row('BTC', '1', HOUR), kind: 'HISTORICAL' as const }, // never part of a TRON digest
    ];
    const groups = digestGroups(input, policy, recorded);
    expect(groups).toEqual([
      { kind: 'MICRO', asset: 'TRX', count: 2, total: '0.000012', from: recorded - 15 * HOUR, to: recorded - 13 * HOUR, below: '1' },
      { kind: 'MICRO', asset: 'USDT', count: 1, total: '0.000001', from: recorded - 2 * HOUR, to: recorded - 2 * HOUR, below: '1' },
      { kind: 'HISTORICAL', asset: 'USDT', count: 1, total: '500', from: recorded - 6 * DAY, to: recorded - 6 * DAY },
      { kind: 'TIME_UNKNOWN', asset: 'TRX', count: 1, total: '3' },
    ]);
    expect(digestGroups([...input].reverse(), policy, recorded)).toEqual(groups);
    expect(digestGroups([{ row: row('TRX', '0.0000001', HOUR), kind: 'MICRO' }, { row: row('TRX', '0.0000002', HOUR), kind: 'MICRO' }], policy, recorded)[0].total).toBe('0.0000003');
  });
  test('a chain time in the future never enters a range (the Worker would refuse the whole digest)', () => {
    const future = [{ row: row('TRX', '3', -2 * HOUR), kind: 'TIME_UNKNOWN' as const }, { row: row('TRX', '0.5', -2 * HOUR), kind: 'MICRO' as const }, { row: row('TRX', '0.25', HOUR), kind: 'MICRO' as const }];
    expect(digestGroups(future, policy, recorded)).toEqual([
      { kind: 'MICRO', asset: 'TRX', count: 2, total: '0.75', from: recorded - HOUR, to: recorded - HOUR, below: '1' },
      { kind: 'TIME_UNKNOWN', asset: 'TRX', count: 1, total: '3' },
    ]);
  });
  test('one identity per chain and Kyiv calendar day, across midnight and DST', () => {
    expect(digestIdFor('tron', Date.UTC(2026, 10, 11, 10, 0), policy)).toBe('deposit-digest:tron:2026-11-11');
    expect(digestIdFor('tron', Date.UTC(2026, 10, 11, 21, 59), policy)).toBe('deposit-digest:tron:2026-11-11'); // 23:59 Kyiv
    expect(digestIdFor('tron', Date.UTC(2026, 10, 11, 22, 0), policy)).toBe('deposit-digest:tron:2026-11-12'); // 00:00 Kyiv
    expect(digestIdFor('tron', Date.UTC(2026, 5, 30, 21, 0), policy)).toBe('deposit-digest:tron:2026-07-01'); // summer time
    expect(digestAckIdFor('deposit-digest:tron:2026-11-11')).toBe('deposit-digest-ack:tron:2026-11-11');
  });
});

describe('the watcher uses the chain time, not the insert time, to announce a receipt', () => {
  const source = readFileSync(join(__dirname, '..', 'DepositWatchService.ts'), 'utf8');
  const notify = source.slice(source.indexOf('private async notifyVerified('), source.indexOf('private async summariseNotices('));
  test('every candidate is classified before anything is sent; only FRESH rows reach the individual alert', () => {
    expect(notify).toMatch(/classifyNotice\(row, this\.noticePolicy, this\.now\(\), since\)/);
    expect(notify).toMatch(/row\.source === 'watcher' && row\.recipientAddress \?/);
    expect(notify).toMatch(/for \(const row of fresh\.slice\(0, this\.cfg\.maxVerificationsPerRun\)\)/);
    expect(notify.match(/this\.notifyTransfer\(/g)).toHaveLength(1);
    expect(notify.indexOf('classifyNotice(')).toBeLessThan(notify.indexOf('this.notifyTransfer('));
  });
  test('the one-record-per-deposit journal, the proof gates and the scan schedule are unchanged', () => {
    expect(notify).toMatch(/NOT EXISTS \(SELECT 1 FROM "AuditLog" a WHERE a\.id = \('deposit-notice:' \|\| d\.id\)\)/);
    expect(notify).toMatch(/d\."verifiedAt" IS NOT NULL AND d\.finalized = true AND d\."verifyError" IS NULL/);
    expect(notify).toMatch(/d\.confirmations >= \$\{config\.minConfirmations\} AND d\."ignoredAt" IS NULL/);
    expect(source).toMatch(/initialBackfillMs: 7 \* 24 \* 60 \* 60_000/);
    const schedule = readFileSync(join(__dirname, '..', 'depositWatchSchedule.ts'), 'utf8');
    expect(schedule).toMatch(/const dayStartMinutes = 7 \* 60, nightStartMinutes = 22 \* 60;/);
    expect(schedule).toMatch(/DEPOSIT_WATCHER_SLOTS \?\? '12:00,16:00,20:00'/);
  });
  test('notices never write a balance, a credit, an attribution, an ignore flag or a delete', () => {
    const body = source.slice(source.indexOf('private async notifyVerified('));
    expect(body).not.toMatch(/\.balance\b|futuresBalance|demoBalance|depositBatch|withdrawal|referral|userId: (?!null)[a-z]|status: 'CREDITED'|ignoredAt:|\.delete\(|deleteMany|deposit\.(update|create|upsert)/);
  });
});
