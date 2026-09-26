import type { PrismaClient, SupportSubject } from '@prisma/client';
import type { SupportEmailService } from './SupportEmailService';

/**
 * Delivers support-message emails from the SupportNotification table — the
 * durable outbox the support routes write in the same transaction as each
 * USER message.
 *
 * Why an outbox: on Render's free plan the process may stop right after a
 * response, so a fire-and-forget send can vanish silently. Here the row is
 * already committed before the user sees "sent"; this worker picks it up
 * right away (kick), again at the next retry time, and on every start (so a
 * process that stopped mid-way is caught up by the next one).
 *
 * It does not poll the database on an interval: with nothing pending it
 * schedules nothing, which keeps Neon free to suspend. Retries follow
 * SUPPORT_RETRY_DELAYS_MS and stop at SUPPORT_MAX_ATTEMPTS; a permanent SMTP
 * rejection (e.g. the recipient refused) fails at once. Without SMTP or a
 * recipient configured, rows simply wait as PENDING — they are sent after
 * the configuration is added and the service restarts.
 *
 * Two instances (e.g. old and new during a deploy) never send the same row
 * at once: each claims a row with a conditional update and a short lease.
 * Delivery is at-least-once — a process killed between the relay accepting
 * and the SENT write can send that one letter again.
 */

/** Wait before retry N (after attempt N failed). Attempt 5 is the last. */
export const SUPPORT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const SUPPORT_MAX_ATTEMPTS = SUPPORT_RETRY_DELAYS_MS.length + 1;
/** How long a claimed row stays reserved for the process sending it. */
export const SUPPORT_CLAIM_MS = 2 * 60_000;
const BATCH_SIZE = 10;
const MAX_BATCHES_PER_RUN = 5;
/** Node timers cap out near 24.8 days; the longest real wait is 2 h. */
const MAX_TIMER_MS = 6 * 60 * 60_000;

export const SUPPORT_SUBJECT_LABELS: Record<SupportSubject, string> = {
  TECHNICAL: 'Техническая проблема',
  KYC: 'Вопрос по KYC',
  CARD: 'Вопрос по карте',
  OTHER: 'Другое',
};

export interface SupportOutboxRunResult {
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
}

type Timer = ReturnType<typeof setTimeout>;

export interface SupportOutboxOptions {
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  log?: (line: string) => void;
}

const short = (id: string) => id.slice(0, 8);

export class SupportNotificationOutbox {
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;
  private readonly log: (line: string) => void;
  private timer: Timer | null = null;
  private running: Promise<SupportOutboxRunResult> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly email: SupportEmailService,
    options: SupportOutboxOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    });
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** On boot: catch up on anything a previous process left PENDING. */
  start(): void {
    this.stopped = false;
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  /** Something may be due now (a message was just committed, or an admin asked for a retry). */
  kick(): void {
    if (this.stopped) return;
    if (this.running) { this.again = true; return; }
    void this.run().catch((error) => {
      this.log(`[support] notification worker error: ${error instanceof Error ? error.name : 'unknown'}`);
    });
  }

  /** One pass over everything due. Overlapping calls collapse into the one in flight. */
  run(): Promise<SupportOutboxRunResult> {
    if (this.running) { this.again = true; return this.running; }
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.again && !this.stopped) { this.again = false; this.kick(); }
    });
    return this.running;
  }

  private async drain(): Promise<SupportOutboxRunResult> {
    const total: SupportOutboxRunResult = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
    // Unconfigured: nothing can be sent, so do not even read the table.
    // Rows wait as PENDING until SMTP and SUPPORT_ADMIN_EMAIL exist.
    if (!this.email.isConfigured()) return total;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const handled = await this.processBatch(total);
      if (handled < BATCH_SIZE) break;
    }
    await this.scheduleNext();
    return total;
  }

  private async processBatch(total: SupportOutboxRunResult): Promise<number> {
    const now = this.now();
    const due = await this.prisma.supportNotification.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: now },
        OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    });
    for (const { id } of due) await this.deliver(id, total);
    return due.length;
  }

  private async deliver(id: string, total: SupportOutboxRunResult): Promise<void> {
    const now = this.now();
    const recipient = this.email.status().recipient;
    const claim = await this.prisma.supportNotification.updateMany({
      where: { id, status: 'PENDING', nextAttemptAt: { lte: now }, OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }] },
      data: {
        claimedUntil: new Date(now.getTime() + SUPPORT_CLAIM_MS),
        attempts: { increment: 1 },
        lastAttemptAt: now,
        recipient,
      },
    });
    if (claim.count !== 1) { total.skipped++; return; } // another process has it

    const row = await this.prisma.supportNotification.findUnique({
      where: { id },
      include: { message: true, conversation: true },
    });
    if (!row) { total.skipped++; return; }

    const result = await this.email.send({
      conversationId: row.conversationId,
      messageId: row.messageId,
      subjectLabel: SUPPORT_SUBJECT_LABELS[row.conversation.subject] ?? row.conversation.subject,
      name: row.conversation.guestName,
      email: row.conversation.guestEmail,
      body: row.message.body,
      userId: row.conversation.userId,
    });
    const tag = `conversation=${short(row.conversationId)} message=${short(row.messageId)}`;

    if (result.ok) {
      await this.prisma.supportNotification.update({
        where: { id },
        data: { status: 'SENT', sentAt: this.now(), claimedUntil: null, failureCategory: null, failureCode: null, recipient: result.recipient },
      });
      total.sent++;
      this.log(`[support] notification SENT ${tag} recipient=${result.recipient}`);
      return;
    }

    if (result.category === 'NOT_CONFIGURED') {
      // Configuration disappeared mid-run: give the attempt back and wait.
      await this.prisma.supportNotification.update({
        where: { id },
        data: {
          attempts: { decrement: 1 }, claimedUntil: null, failureCategory: 'NOT_CONFIGURED', failureCode: null,
          nextAttemptAt: new Date(this.now().getTime() + SUPPORT_RETRY_DELAYS_MS[0]),
        },
      });
      total.skipped++;
      return;
    }

    const exhausted = result.permanent || row.attempts >= SUPPORT_MAX_ATTEMPTS;
    const delay = SUPPORT_RETRY_DELAYS_MS[Math.min(row.attempts, SUPPORT_RETRY_DELAYS_MS.length) - 1] ?? SUPPORT_RETRY_DELAYS_MS[0];
    await this.prisma.supportNotification.update({
      where: { id },
      data: exhausted
        ? { status: 'FAILED', claimedUntil: null, failureCategory: result.category, failureCode: result.code }
        : {
          claimedUntil: null,
          failureCategory: result.category,
          failureCode: result.code,
          nextAttemptAt: new Date(this.now().getTime() + delay),
        },
    });
    if (exhausted) total.failed++; else total.retrying++;
    this.log(`[support] notification ${exhausted ? 'FAILED' : 'RETRY'} ${tag} attempt=${row.attempts} category=${result.category}${result.code ? ` code=${result.code}` : ''}`);
  }

  /** One timer for the earliest pending retry; none when nothing waits. */
  private async scheduleNext(): Promise<void> {
    if (this.stopped) return;
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    const next = await this.prisma.supportNotification.findFirst({
      where: { status: 'PENDING' },
      orderBy: { nextAttemptAt: 'asc' },
      select: { nextAttemptAt: true, claimedUntil: true },
    });
    if (!next) return;
    const at = Math.max(next.nextAttemptAt.getTime(), next.claimedUntil?.getTime() ?? 0);
    const wait = Math.min(Math.max(at - this.now().getTime(), 1_000), MAX_TIMER_MS);
    this.timer = this.setTimer(() => { this.timer = null; this.kick(); }, wait);
  }
}
