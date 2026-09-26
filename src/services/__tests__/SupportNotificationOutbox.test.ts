import { SupportNotificationOutbox, SUPPORT_MAX_ATTEMPTS, SUPPORT_RETRY_DELAYS_MS } from '../SupportNotificationOutbox';
import type { SupportSendResult } from '../SupportEmailService';

/**
 * The outbox against a small in-memory stand-in for the three Prisma calls
 * it makes. The same transitions run against real PostgreSQL in
 * supportNotificationPostgres.test.ts; this file pins the schedule and the
 * no-polling behaviour with a controllable clock and timer.
 */

type Row = {
  id: string; conversationId: string; messageId: string; recipient: string | null;
  status: 'PENDING' | 'SENT' | 'FAILED'; attempts: number; nextAttemptAt: Date; lastAttemptAt: Date | null;
  sentAt: Date | null; failureCategory: string | null; failureCode: number | null; claimedUntil: Date | null; createdAt: Date;
};

function fakePrisma(rows: Row[]) {
  const calls = { findMany: 0, updateMany: 0, findFirst: 0 };
  const due = (row: Row, where: any) => {
    if (where.id && row.id !== where.id) return false;
    if (where.status && row.status !== where.status) return false;
    if (where.nextAttemptAt?.lte && row.nextAttemptAt > where.nextAttemptAt.lte) return false;
    if (where.OR && !(row.claimedUntil === null || row.claimedUntil < where.OR[1].claimedUntil.lt)) return false;
    return true;
  };
  const apply = (row: Row, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in (value as any)) (row as any)[key] += (value as any).increment;
      else if (value && typeof value === 'object' && 'decrement' in (value as any)) (row as any)[key] -= (value as any).decrement;
      else (row as any)[key] = value;
    }
  };
  return {
    calls,
    supportNotification: {
      findMany: async ({ where, take }: any) => { calls.findMany++; return rows.filter((r) => due(r, where)).slice(0, take).map((r) => ({ id: r.id })); },
      updateMany: async ({ where, data }: any) => { calls.updateMany++; const hit = rows.filter((r) => due(r, where)); hit.forEach((r) => apply(r, data)); return { count: hit.length }; },
      findUnique: async ({ where }: any) => {
        const row = rows.find((r) => r.id === where.id);
        return row && { ...row, message: { body: 'Не працює вивід' }, conversation: { subject: 'TECHNICAL', guestName: 'Іван', guestEmail: 'ivan@example.com', userId: null } };
      },
      update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id)!; apply(row, data); return row; },
      findFirst: async ({ where }: any) => {
        calls.findFirst++;
        return rows.filter((r) => r.status === where.status).sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0] ?? null;
      },
    },
  };
}

function row(id: string, at: Date): Row {
  return { id, conversationId: `c-${id}`, messageId: `m-${id}`, recipient: null, status: 'PENDING', attempts: 0, nextAttemptAt: at,
    lastAttemptAt: null, sentAt: null, failureCategory: null, failureCode: null, claimedUntil: null, createdAt: at };
}

function setup(results: SupportSendResult[], configured = true, rows = [row('n1', new Date(0))]) {
  let clock = 1_000_000;
  const timers: { fn: () => void; ms: number }[] = [];
  const prisma = fakePrisma(rows);
  const send = jest.fn(async () => results.shift() ?? { ok: true as const, recipient: 'voltex.crypto@gmail.com' });
  const email = { isConfigured: () => configured, status: () => ({ smtpConfigured: configured, recipient: 'voltex.crypto@gmail.com', inboundConfigured: false }), send };
  const logs: string[] = [];
  const outbox = new SupportNotificationOutbox(prisma as any, email as any, {
    now: () => new Date(clock),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length as any; },
    clearTimer: () => {},
    log: (line) => logs.push(line),
  });
  return { outbox, prisma, rows, send, timers, logs, advance: (ms: number) => { clock += ms; } };
}

const tempFail: SupportSendResult = { ok: false, recipient: 'voltex.crypto@gmail.com', category: 'CONNECTION', code: null, permanent: false };

describe('SupportNotificationOutbox', () => {
  it('sends a due row once, marks it SENT and schedules nothing afterwards', async () => {
    const t = setup([]);
    await expect(t.outbox.run()).resolves.toEqual({ sent: 1, retrying: 0, failed: 0, skipped: 0 });
    expect(t.rows[0]).toMatchObject({ status: 'SENT', attempts: 1, recipient: 'voltex.crypto@gmail.com', claimedUntil: null, failureCategory: null });
    expect(t.rows[0].sentAt).toBeInstanceOf(Date);
    expect(t.send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c-n1', messageId: 'm-n1', name: 'Іван', email: 'ivan@example.com', body: 'Не працює вивід', subjectLabel: 'Техническая проблема' }));
    expect(t.timers).toHaveLength(0);
    expect(t.logs).toEqual(['[support] notification SENT conversation=c-n1 message=m-n1 recipient=voltex.crypto@gmail.com']);
  });

  it('a second run does not send a SENT row again', async () => {
    const t = setup([]);
    await t.outbox.run();
    await t.outbox.run();
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('temporary failures back off 1 min, 5 min, 30 min, 2 h, then FAILED after the fifth attempt', async () => {
    const t = setup([tempFail, tempFail, tempFail, tempFail, tempFail]);
    const waits: number[] = [];
    for (let attempt = 1; attempt <= SUPPORT_MAX_ATTEMPTS; attempt++) {
      await t.outbox.run();
      expect(t.rows[0].attempts).toBe(attempt);
      if (attempt < SUPPORT_MAX_ATTEMPTS) {
        expect(t.rows[0].status).toBe('PENDING');
        const wait = t.rows[0].nextAttemptAt.getTime() - (1_000_000 + waits.reduce((a, b) => a + b, 0));
        waits.push(wait);
        expect(t.timers.at(-1)!.ms).toBe(wait); // one timer, exactly at the retry time
        t.advance(wait);
      }
    }
    expect(waits).toEqual([...SUPPORT_RETRY_DELAYS_MS]);
    expect(t.rows[0]).toMatchObject({ status: 'FAILED', attempts: 5, failureCategory: 'CONNECTION' });
    expect(t.send).toHaveBeenCalledTimes(5);
    await t.outbox.run();
    expect(t.send).toHaveBeenCalledTimes(5); // no retry storm after FAILED
  });

  it('a retry is not attempted before its time', async () => {
    const t = setup([tempFail]);
    await t.outbox.run();
    t.advance(SUPPORT_RETRY_DELAYS_MS[0] - 1);
    await t.outbox.run();
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('a permanent rejection fails at once', async () => {
    const t = setup([{ ok: false, recipient: 'voltex.crypto@gmail.com', category: 'RECIPIENT_REJECTED', code: 550, permanent: true }]);
    await t.outbox.run();
    expect(t.rows[0]).toMatchObject({ status: 'FAILED', attempts: 1, failureCategory: 'RECIPIENT_REJECTED', failureCode: 550 });
    expect(t.logs[0]).toBe('[support] notification FAILED conversation=c-n1 message=m-n1 attempt=1 category=RECIPIENT_REJECTED code=550');
  });

  it('unconfigured: reads nothing, sends nothing, schedules nothing — rows wait PENDING', async () => {
    const t = setup([], false);
    await t.outbox.run();
    expect(t.prisma.calls).toEqual({ findMany: 0, updateMany: 0, findFirst: 0 });
    expect(t.send).not.toHaveBeenCalled();
    expect(t.timers).toHaveLength(0);
    expect(t.rows[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('a row another process has claimed is skipped', async () => {
    const t = setup([]);
    t.rows[0].claimedUntil = new Date(1_000_000 + 60_000);
    await expect(t.outbox.run()).resolves.toMatchObject({ sent: 0 });
    expect(t.send).not.toHaveBeenCalled();
    // …and the next attempt is scheduled for when that lease runs out.
    expect(t.timers.at(-1)!.ms).toBe(60_000);
  });

  it('an expired claim (a process that died mid-send) is taken over', async () => {
    const t = setup([]);
    t.rows[0].claimedUntil = new Date(1_000_000 - 1);
    await t.outbox.run();
    expect(t.rows[0].status).toBe('SENT');
  });

  it('overlapping kicks collapse into one pass plus one follow-up', async () => {
    const t = setup([]);
    const first = t.outbox.run();
    t.outbox.kick();
    t.outbox.kick();
    await first;
    await new Promise((r) => setImmediate(r));
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('drains several rows in one pass, oldest first', async () => {
    const t = setup([], true, [row('a', new Date(1)), row('b', new Date(2)), row('c', new Date(3))]);
    await expect(t.outbox.run()).resolves.toMatchObject({ sent: 3 });
    expect((t.send.mock.calls as any[]).map(([input]) => input.messageId)).toEqual(['m-a', 'm-b', 'm-c']);
  });
});
