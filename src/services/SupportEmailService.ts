import nodemailer, { Transporter } from 'nodemailer';

/**
 * Notifies the support admin mailbox by email whenever a user sends a
 * message in the live-chat widget. Two-way reply support works by putting
 * the conversation id in the subject as `[Ticket #<id>]` — most mail
 * clients preserve the original subject on reply ("Re: [Ticket #...] ..."),
 * so an admin's reply keeps the id. Feeding that reply back into the
 * user's chat window is handled separately by the inbound-email webhook
 * (see src/api/routes/support.ts) — this service only sends outbound.
 *
 * Uses plain SMTP (via nodemailer) rather than committing to one vendor's
 * REST API, since SMTP is what SendGrid, Resend, Mailgun, AWS SES and
 * Gmail all expose too — whichever provider you pick, point SMTP_HOST/
 * SMTP_PORT/SMTP_USER/SMTP_PASS at its SMTP relay and this just works.
 *
 * If SMTP isn't configured (no SMTP_HOST env var), this logs instead of
 * sending — same "gracefully absent, not fake" pattern as an unconfigured
 * deposit chain in deposits.ts. NOT tested against a live SMTP relay from
 * this environment (this sandbox's outbound proxy blocks most external
 * hosts) — verify against your real provider before depending on it in
 * production, same caveat every other external integration in this repo
 * carries.
 */

export interface SupportNotificationInput {
  conversationId: string;
  subjectLabel: string;
  name: string;
  email: string;
  body: string;
}

export class SupportEmailService {
  private readonly transporter: Transporter | null;
  private readonly adminEmail?: string;
  private readonly fromEmail: string;
  private readonly inboundReplyEmail?: string;

  constructor(transporter?: Transporter) {
    this.adminEmail = process.env.SUPPORT_ADMIN_EMAIL;
    this.fromEmail = process.env.SUPPORT_FROM_EMAIL || 'support@voltex.local';
    this.inboundReplyEmail = process.env.SUPPORT_INBOUND_EMAIL;

    if (transporter) {
      this.transporter = transporter;
    } else if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
    } else {
      this.transporter = null;
    }
  }

  /** Best-effort: a broken/unconfigured mail relay must never fail the
   * user's chat request — it just means the admin finds out later than
   * they'd like, not that the message is lost (it's already in the DB). */
  async notifyNewMessage(input: SupportNotificationInput): Promise<void> {
    const subject = `[Ticket #${input.conversationId}] ${input.subjectLabel} — ${input.name}`;

    if (!this.transporter || !this.adminEmail) {
      console.log(
        `[SupportEmailService] SMTP not configured — would have notified ${
          this.adminEmail ?? '(SUPPORT_ADMIN_EMAIL not set)'
        }: ${subject}`
      );
      return;
    }

    const text = [
      `Від: ${input.name} <${input.email}>`,
      `Тема звернення: ${input.subjectLabel}`,
      `ID бесіди: ${input.conversationId}`,
      '',
      input.body,
    ].join('\n');

    try {
      await this.transporter.sendMail({
        from: this.fromEmail,
        to: this.adminEmail,
        // Without a dedicated inbound-parse mailbox configured, replying
        // goes straight to the user — still a working (if manual) two-way
        // channel, just not one that feeds back into the chat widget.
        replyTo: this.inboundReplyEmail || input.email,
        subject,
        text,
      });
    } catch (err) {
      console.error('[SupportEmailService] Failed to send admin notification:', err);
    }
  }
}
