import nodemailer, { Transporter } from 'nodemailer';

/**
 * Emails a copy of every KYC submission (data + the document itself, as an
 * attachment) to an admin mailbox the moment it's submitted — a second,
 * durable copy alongside the one on disk/in the DB. This exists because
 * this deployment's UPLOAD_DIR (see kyc.ts) is local disk, not guaranteed
 * persistent storage: a redeploy or container restart can wipe it, and an
 * admin would otherwise have no way to recover a submission's document.
 * The DB row itself can also be lost the same way if the database isn't on
 * durable storage either — this email is the one copy that survives either.
 *
 * Same SMTP-via-nodemailer approach as SupportEmailService, and the same
 * "gracefully absent, not fake" pattern: unset KYC_ADMIN_EMAIL/SMTP_HOST
 * and this just logs instead of sending, never blocks the submission.
 */

export interface KycNotificationInput {
  submissionId: string;
  email: string;
  fullName: string;
  country: string;
  dateOfBirth: string;
  documentType: string;
  documentPath: string;
  documentMimeType: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export class KycEmailService {
  private readonly transporter: Transporter | null;
  private readonly adminEmail?: string;
  private readonly fromEmail: string;

  constructor(transporter?: Transporter) {
    this.adminEmail = process.env.KYC_ADMIN_EMAIL;
    this.fromEmail = process.env.KYC_FROM_EMAIL || 'kyc@voltex.local';

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
   * user's submission — it's already saved to the DB and disk; this is
   * just an extra durable copy, not the only one. */
  async notifySubmission(input: KycNotificationInput): Promise<void> {
    const subject = `[KYC] Новая заявка на верификацию — ${input.fullName} (${input.email})`;

    if (!this.transporter || !this.adminEmail) {
      console.log(
        `[KycEmailService] SMTP not configured — would have notified ${
          this.adminEmail ?? '(KYC_ADMIN_EMAIL not set)'
        }: ${subject}`
      );
      return;
    }

    const text = [
      `Email: ${input.email}`,
      `ФИО: ${input.fullName}`,
      `Страна: ${input.country}`,
      `Дата рождения: ${input.dateOfBirth}`,
      `Тип документа: ${input.documentType}`,
      `ID заявки: ${input.submissionId}`,
      '',
      'Документ приложен к письму. Проверить/одобрить заявку можно в админ-панели (/admin/kyc).',
    ].join('\n');

    const extension = EXTENSION_BY_MIME[input.documentMimeType] ?? 'bin';

    try {
      await this.transporter.sendMail({
        from: this.fromEmail,
        to: this.adminEmail,
        subject,
        text,
        attachments: [
          {
            filename: `${input.documentType.toLowerCase()}-${input.submissionId}.${extension}`,
            path: input.documentPath,
            contentType: input.documentMimeType,
          },
        ],
      });
    } catch (err) {
      console.error('[KycEmailService] Failed to send admin notification:', err);
    }
  }
}
