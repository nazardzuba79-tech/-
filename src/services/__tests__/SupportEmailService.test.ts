import nodemailer from 'nodemailer';
import { SupportEmailService, classifySupportMailError, headerSafe, type SupportNotificationInput } from '../SupportEmailService';

const input: SupportNotificationInput = {
  conversationId: '11111111-2222-4333-8444-555555555555',
  messageId: '66666666-7777-4888-9999-000000000000',
  subjectLabel: 'Техническая проблема',
  name: 'Олена',
  email: 'olena@example.com',
  body: 'Коли перевірять документи?',
  userId: null,
};

const SECRET = 'smtp-password-that-must-never-leak';

function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { SUPPORT_ADMIN_EMAIL: 'voltex.crypto@gmail.com', SMTP_USER: 'relay-user@example.com', SMTP_PASS: SECRET, ...extra } as NodeJS.ProcessEnv;
}

describe('SupportEmailService', () => {
  it('without SMTP: reports NOT_CONFIGURED, never "sent"', async () => {
    const service = new SupportEmailService(undefined, { SUPPORT_ADMIN_EMAIL: 'voltex.crypto@gmail.com' } as NodeJS.ProcessEnv);
    expect(service.isConfigured()).toBe(false);
    expect(service.status()).toEqual({ smtpConfigured: false, recipient: 'voltex.crypto@gmail.com', inboundConfigured: false });
    await expect(service.send(input)).resolves.toEqual({ ok: false, recipient: 'voltex.crypto@gmail.com', category: 'NOT_CONFIGURED', code: null, permanent: false });
    await expect(service.sendTest()).resolves.toMatchObject({ ok: false, category: 'NOT_CONFIGURED' });
  });

  it('with SMTP but no SUPPORT_ADMIN_EMAIL: not configured either', async () => {
    const sendMail = jest.fn();
    const service = new SupportEmailService({ sendMail } as any, { SMTP_HOST: 'smtp.example.invalid' } as NodeJS.ProcessEnv);
    expect(service.isConfigured()).toBe(false);
    await expect(service.send(input)).resolves.toMatchObject({ ok: false, recipient: null, category: 'NOT_CONFIGURED' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('configured: sends one text/plain letter to SUPPORT_ADMIN_EMAIL with name, email, subject, text and ticket id', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const service = new SupportEmailService({ sendMail } as any, env());
    await expect(service.send(input)).resolves.toEqual({ ok: true, recipient: 'voltex.crypto@gmail.com' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(Object.keys(mail).sort()).toEqual(['from', 'replyTo', 'subject', 'text', 'to']);
    expect(mail.to).toBe('voltex.crypto@gmail.com');
    expect(mail.from).toBe('relay-user@example.com'); // Gmail refuses a foreign From
    expect(mail.replyTo).toBe('olena@example.com');
    expect(mail.subject).toBe(`[Ticket #${input.conversationId}] Техническая проблема — Олена`);
    for (const part of ["Ім'я: Олена", 'Email: olena@example.com', 'Тема: Техническая проблема', `Ticket ID: ${input.conversationId}`,
      `ID повідомлення: ${input.messageId}`, 'Коли перевірять документи?', 'у чат VOLTEX вона автоматично не потрапить']) {
      expect(mail.text).toContain(part);
    }
  });

  it('the recipient comes only from SUPPORT_ADMIN_EMAIL', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    await new SupportEmailService({ sendMail } as any, env({ SUPPORT_ADMIN_EMAIL: 'other-mailbox@example.com' })).send(input);
    expect(sendMail.mock.calls[0][0].to).toBe('other-mailbox@example.com');
  });

  it('SUPPORT_FROM_EMAIL wins over SMTP_USER when set', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    await new SupportEmailService({ sendMail } as any, env({ SUPPORT_FROM_EMAIL: 'noreply@voltex.example' })).send(input);
    expect(sendMail.mock.calls[0][0].from).toBe('noreply@voltex.example');
  });

  it('inbound configured: Reply-To is the inbound mailbox and the letter says the reply reaches the chat', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const service = new SupportEmailService({ sendMail } as any, env({ SUPPORT_INBOUND_EMAIL: 'inbound@voltex.example', SUPPORT_WEBHOOK_SECRET: 'x'.repeat(32) }));
    expect(service.status().inboundConfigured).toBe(true);
    await service.send(input);
    expect(sendMail.mock.calls[0][0].replyTo).toBe('inbound@voltex.example');
    expect(sendMail.mock.calls[0][0].text).toContain("з'явиться в чаті користувача");
  });

  it('an inbound mailbox without the webhook secret is not "configured"', () => {
    expect(new SupportEmailService({ sendMail: jest.fn() } as any, env({ SUPPORT_INBOUND_EMAIL: 'inbound@voltex.example' })).status().inboundConfigured).toBe(false);
  });

  it('a name with line breaks cannot add headers', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    await new SupportEmailService({ sendMail } as any, env()).send({ ...input, name: 'Eve\r\nBcc: victim@example.com' });
    const { subject } = sendMail.mock.calls[0][0];
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('Eve Bcc: victim@example.com');
    expect(headerSafe('a\u2028b\u0000c')).toBe('a b c');
    expect(headerSafe('x'.repeat(300), 20)).toHaveLength(20);
  });

  it('temporary failure: resolves (never throws) with a retryable category', async () => {
    const sendMail = jest.fn().mockRejectedValue(Object.assign(new Error(`451 try later ${SECRET}`), { responseCode: 451 }));
    const result = await new SupportEmailService({ sendMail } as any, env()).send(input);
    expect(result).toEqual({ ok: false, recipient: 'voltex.crypto@gmail.com', category: 'TEMPORARY', code: 451, permanent: false });
  });

  it('permanent failure: recipient rejected is not retried', async () => {
    const sendMail = jest.fn().mockRejectedValue(Object.assign(new Error('550 no such user'), { responseCode: 550, command: 'RCPT TO', code: 'EENVELOPE' }));
    const result = await new SupportEmailService({ sendMail } as any, env()).send(input);
    expect(result).toMatchObject({ ok: false, category: 'RECIPIENT_REJECTED', code: 550, permanent: true });
  });

  it('no secret or relay text in the outcome', async () => {
    const error = Object.assign(new Error(`Invalid login: 535 5.7.8 user relay-user@example.com pass ${SECRET}`), { code: 'EAUTH', responseCode: 535 });
    const result = await new SupportEmailService({ sendMail: jest.fn().mockRejectedValue(error) } as any, env()).send(input);
    expect(result).toEqual({ ok: false, recipient: 'voltex.crypto@gmail.com', category: 'AUTH', code: 535, permanent: false });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('Invalid login');
  });

  it.each([
    [{ code: 'EAUTH' }, 'AUTH', false],
    [{ code: 'ECONNECTION' }, 'CONNECTION', false],
    [{ code: 'ETIMEDOUT' }, 'CONNECTION', false],
    [{ code: 'EDNS' }, 'CONNECTION', false],
    [{ code: 'ESOCKET', command: 'CONN' }, 'CONNECTION', false],
    [new Error('Connection closed unexpectedly'), 'CONNECTION', false],
    [new Error('Unexpected socket close'), 'CONNECTION', false],
    [{ responseCode: 421 }, 'TEMPORARY', false],
    [{ responseCode: 552, command: 'DATA' }, 'MESSAGE_REJECTED', true],
    [{ responseCode: 553, command: 'RCPT TO:<x>' }, 'RECIPIENT_REJECTED', true],
    [{ code: 'EENVELOPE' }, 'RECIPIENT_REJECTED', true],
    [new Error('boom'), 'UNKNOWN', false],
    [undefined, 'UNKNOWN', false],
  ])('classifies %j as %s (permanent=%s)', (error, category, permanent) => {
    expect(classifySupportMailError(error)).toMatchObject({ category, permanent });
  });

  it('test letter goes to SUPPORT_ADMIN_EMAIL and mentions no conversation', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    await expect(new SupportEmailService({ sendMail } as any, env()).sendTest()).resolves.toEqual({ ok: true, recipient: 'voltex.crypto@gmail.com' });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('voltex.crypto@gmail.com');
    expect(mail.subject).not.toContain('Ticket #');
  });

  it('the real transport is built from SMTP_* with timeouts, and the password stays inside the transport', () => {
    const createTransport = jest.spyOn(nodemailer, 'createTransport');
    const service = new SupportEmailService(undefined, env({ SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '465', SMTP_SECURE: 'true' }));
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.invalid', port: 465, secure: true,
      auth: { user: 'relay-user@example.com', pass: SECRET },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    expect(JSON.stringify(service.status())).not.toContain(SECRET);
    createTransport.mockRestore();
  });
});
