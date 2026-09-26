import nodemailer, { Transporter } from 'nodemailer';

/**
 * Sends the support admin mailbox one email per user message in the
 * live-chat widget. Delivery is driven by SupportNotificationOutbox (a
 * durable outbox row per message), so this class only composes and sends
 * one letter and reports exactly what happened — it never swallows a
 * failure, and it never pretends to have sent anything.
 *
 * Two-way reply works by putting the conversation id in the subject as
 * `[Ticket #<id>]`; an admin's reply is fed back into the chat by the
 * inbound-email webhook (src/api/routes/support.ts) when one is configured.
 *
 * Configuration (all from the environment, never hard-coded):
 * - SUPPORT_ADMIN_EMAIL — the recipient (production: the support mailbox);
 * - SMTP_HOST/PORT/SECURE/USER/PASS — the relay, shared with KYC and
 *   registration mail;
 * - SUPPORT_FROM_EMAIL — optional From; defaults to SMTP_USER because Gmail
 *   and most relays refuse or rewrite a From that is not the signed-in account;
 * - SUPPORT_INBOUND_EMAIL + SUPPORT_WEBHOOK_SECRET — inbound replies.
 *
 * The letter is text/plain. Nothing the user typed can reach a header other
 * than Subject (control characters stripped) and Reply-To (an address that
 * passed validation at the API).
 */

export interface SupportNotificationInput {
  conversationId: string;
  messageId: string;
  subjectLabel: string;
  name: string;
  email: string;
  body: string;
  /** The signed-in account behind the conversation, or null for a guest. */
  userId: string | null;
}

/** Why a send failed, in words safe to store and show: never the relay's own text. */
export type SupportDeliveryCategory =
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'CONNECTION'
  | 'RECIPIENT_REJECTED'
  | 'MESSAGE_REJECTED'
  | 'TEMPORARY'
  | 'UNKNOWN';

export type SupportSendResult =
  | { ok: true; recipient: string }
  | { ok: false; recipient: string | null; category: SupportDeliveryCategory; code: number | null; permanent: boolean };

export interface SupportMailStatus {
  /** SMTP_HOST is set (a relay exists). */
  smtpConfigured: boolean;
  /** SUPPORT_ADMIN_EMAIL, in full — shown to admins only. */
  recipient: string | null;
  /** Both an inbound mailbox and the webhook secret are set. */
  inboundConfigured: boolean;
}

const CONNECTION_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET', 'ETLS', 'EPROTOCOL']);

/** Header-safe text: no line breaks or other control characters, bounded length. */
export function headerSafe(value: string, max = 120): string {
  const clean = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Maps a Nodemailer/SMTP error to a stored category. Only the category and
 * the numeric SMTP reply code survive; the message (which can quote the
 * relay's reply, the account name or the envelope) is dropped.
 */
export function classifySupportMailError(error: unknown): { category: SupportDeliveryCategory; code: number | null; permanent: boolean } {
  const err = (error ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown; message?: unknown };
  const code = typeof err.responseCode === 'number' && Number.isFinite(err.responseCode) ? err.responseCode : null;
  const errCode = typeof err.code === 'string' ? err.code : '';
  const command = typeof err.command === 'string' ? err.command.toUpperCase() : '';
  if (errCode === 'EAUTH' || code === 535 || code === 534 || code === 530) return { category: 'AUTH', code, permanent: false };
  if (errCode === 'EENVELOPE' || (code !== null && code >= 500 && command.startsWith('RCPT'))) {
    return { category: 'RECIPIENT_REJECTED', code, permanent: true };
  }
  if (code !== null && code >= 500) return { category: 'MESSAGE_REJECTED', code, permanent: true };
  if (code !== null && code >= 400) return { category: 'TEMPORARY', code, permanent: false };
  // A relay that drops the socket raises a bare "Connection closed unexpectedly"
  // with no code; the text is only matched here, never stored.
  const dropped = typeof err.message === 'string' && /connection closed|unexpected socket close|greeting never received|socket hang up/i.test(err.message);
  if (CONNECTION_CODES.has(errCode) || command === 'CONN' || dropped) return { category: 'CONNECTION', code, permanent: false };
  return { category: 'UNKNOWN', code, permanent: false };
}

export class SupportEmailService {
  private readonly transporter: Transporter | null;
  private readonly adminEmail: string | null;
  private readonly fromEmail: string;
  private readonly inboundReplyEmail: string | null;
  private readonly inboundConfigured: boolean;

  constructor(transporter?: Transporter, env: NodeJS.ProcessEnv = process.env) {
    this.adminEmail = env.SUPPORT_ADMIN_EMAIL?.trim() || null;
    this.fromEmail = env.SUPPORT_FROM_EMAIL?.trim() || env.SMTP_USER?.trim() || 'support@voltex.local';
    this.inboundReplyEmail = env.SUPPORT_INBOUND_EMAIL?.trim() || null;
    this.inboundConfigured = !!this.inboundReplyEmail && !!env.SUPPORT_WEBHOOK_SECRET;

    if (transporter) {
      this.transporter = transporter;
    } else if (env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 587,
        secure: env.SMTP_SECURE === 'true',
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        // A relay that never answers must not hold a send (and its outbox lease) open.
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
    } else {
      this.transporter = null;
    }
  }

  status(): SupportMailStatus {
    return { smtpConfigured: !!this.transporter, recipient: this.adminEmail, inboundConfigured: this.inboundConfigured };
  }

  /** Both a relay and a recipient exist, so a send can be attempted at all. */
  isConfigured(): boolean {
    return !!this.transporter && !!this.adminEmail;
  }

  subjectFor(input: Pick<SupportNotificationInput, 'conversationId' | 'subjectLabel' | 'name'>): string {
    return `[Ticket #${input.conversationId}] ${headerSafe(input.subjectLabel, 60)} — ${headerSafe(input.name, 60)}`;
  }

  textFor(input: SupportNotificationInput): string {
    return [
      'Нове повідомлення в підтримку VOLTEX',
      '',
      `Ім'я: ${headerSafe(input.name, 100)}`,
      `Email: ${input.email}`,
      `Тема: ${input.subjectLabel}`,
      `Ticket ID: ${input.conversationId}`,
      `ID повідомлення: ${input.messageId}`,
      `Акаунт: ${input.userId ?? 'гість (без входу в акаунт)'}`,
      '',
      'Повідомлення:',
      input.body.replace(/\u0000/g, ''),
      '',
      '—',
      this.inboundConfigured
        ? 'Відповідь на цей лист з\'явиться в чаті користувача на VOLTEX.'
        : `Відповідь на цей лист піде користувачу на ${input.email}; у чат VOLTEX вона автоматично не потрапить.`,
    ].join('\n');
  }

  /** One letter for one support message. Resolves with the outcome; never throws. */
  async send(input: SupportNotificationInput): Promise<SupportSendResult> {
    if (!this.transporter || !this.adminEmail) {
      return { ok: false, recipient: this.adminEmail, category: 'NOT_CONFIGURED', code: null, permanent: false };
    }
    try {
      await this.transporter.sendMail({
        from: this.fromEmail,
        to: this.adminEmail,
        // Without an inbound mailbox, replying goes straight to the user —
        // a working (manual) channel, just not one that feeds the chat.
        replyTo: this.inboundReplyEmail || input.email,
        subject: this.subjectFor(input),
        text: this.textFor(input),
      });
      return { ok: true, recipient: this.adminEmail };
    } catch (error) {
      return { ok: false, recipient: this.adminEmail, ...classifySupportMailError(error) };
    }
  }

  /** The admin page's test letter: to SUPPORT_ADMIN_EMAIL, touching no conversation. */
  async sendTest(): Promise<SupportSendResult> {
    if (!this.transporter || !this.adminEmail) {
      return { ok: false, recipient: this.adminEmail, category: 'NOT_CONFIGURED', code: null, permanent: false };
    }
    try {
      await this.transporter.sendMail({
        from: this.fromEmail,
        to: this.adminEmail,
        subject: '[VOLTEX Support] Тестовий лист — сповіщення підтримки працюють',
        text: [
          'Це тестовий лист з адмін-панелі VOLTEX (Admin → Поддержка).',
          'Якщо ви його бачите, нові звернення з чату підтримки надходитимуть на цю адресу.',
          '',
          'Відповідати не потрібно.',
        ].join('\n'),
      });
      return { ok: true, recipient: this.adminEmail };
    } catch (error) {
      return { ok: false, recipient: this.adminEmail, ...classifySupportMailError(error) };
    }
  }
}
