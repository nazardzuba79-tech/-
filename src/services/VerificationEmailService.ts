import nodemailer, { Transporter } from 'nodemailer';

/**
 * Sends the six-digit registration code.
 *
 * Same SMTP approach as SupportEmailService and KycEmailService — one
 * nodemailer transport configured from SMTP_HOST/SMTP_PORT/SMTP_USER/
 * SMTP_PASS/SMTP_SECURE, so whichever relay the deployment uses (SendGrid,
 * Resend, Mailgun, SES, Gmail) it is the same configuration. A transport can
 * be injected, which is how the tests exercise this without a relay.
 *
 * Unlike the support notifier, this one REPORTS FAILURE. A support email
 * that does not arrive is an inconvenience; a verification code that does
 * not arrive is an account the user cannot open, so `send` returns false and
 * the route tells the user the code could not be sent rather than showing a
 * verification screen for a mail that never left.
 *
 * The code appears in exactly one place — the message body — and is never
 * logged, not even at debug level.
 */
export interface VerificationEmailInput {
  to: string;
  code: string;
  /** Minutes until the code expires, for the copy. */
  expiryMinutes: number;
}

export class VerificationEmailService {
  private readonly transporter: Transporter | null;
  private readonly fromEmail: string;

  constructor(transporter?: Transporter) {
    this.fromEmail = process.env.VERIFICATION_FROM_EMAIL || process.env.SUPPORT_FROM_EMAIL || 'no-reply@voltex.local';

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

  /** True when a relay is configured. The registration route uses this to
   *  refuse to create an unverifiable account on a deployment with no mail
   *  configured, rather than stranding the user on a code screen. */
  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Returns whether the message was actually handed to the relay. Never
   * throws: the caller decides what an undeliverable code means for the
   * request, and a stack trace from nodemailer is not a registration
   * outcome.
   */
  async send(input: VerificationEmailInput): Promise<boolean> {
    if (!this.transporter) {
      // Deliberately logs that a code WOULD have been sent, never the code.
      console.warn(`[VerificationEmailService] SMTP not configured — no verification code sent to ${input.to}`);
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromEmail,
        to: input.to,
        subject: `VOLTEX — код подтверждения ${input.code}`,
        text: this.textBody(input),
        html: this.htmlBody(input),
      });
      return true;
    } catch (err) {
      // The message, not the code — err from nodemailer can echo the
      // envelope but never the body.
      console.error(
        `[VerificationEmailService] failed to send verification code to ${input.to}:`,
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  private textBody({ code, expiryMinutes }: VerificationEmailInput): string {
    return [
      'VOLTEX',
      '',
      'Код подтверждения для завершения регистрации:',
      '',
      code,
      '',
      `Код действителен ${expiryMinutes} минут.`,
      '',
      'Никому не сообщайте этот код. Сотрудники VOLTEX никогда его не запрашивают.',
      'Если вы не создавали аккаунт VOLTEX, просто проигнорируйте это письмо.',
    ].join('\n');
  }

  /** Deliberately plain and transactional: a table-free, image-free layout
   *  with inline styles, which is what survives intact across mail clients. */
  private htmlBody({ code, expiryMinutes }: VerificationEmailInput): string {
    return `<div style="margin:0;padding:24px;background:#05070a;font-family:Inter,Arial,Helvetica,sans-serif;color:#e6eaf1">
  <div style="max-width:440px;margin:0 auto;background:#0e131a;border:1px solid #1b2431;border-radius:12px;padding:28px">
    <div style="font-size:16px;font-weight:700;letter-spacing:.08em;color:#ffffff">VOLTEX</div>
    <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#8b97a8">
      Код подтверждения для завершения регистрации:
    </p>
    <div style="margin:18px 0;padding:14px 0;text-align:center;background:#121821;border:1px solid #1b2431;border-radius:8px;
                font-family:'Roboto Mono',Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:.28em;color:#f0c45a">
      ${code}
    </div>
    <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8b97a8">
      Код действителен ${expiryMinutes} минут.
    </p>
    <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #1b2431;font-size:12px;line-height:1.6;color:#5b6675">
      Никому не сообщайте этот код — сотрудники VOLTEX никогда его не запрашивают.
      Если вы не создавали аккаунт VOLTEX, просто проигнорируйте это письмо.
    </p>
  </div>
</div>`;
  }
}
