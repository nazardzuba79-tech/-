import fs from 'fs';
import path from 'path';
import net from 'net';
import tls from 'tls';
import nodemailer, { SendMailOptions } from 'nodemailer';
import { SupportEmailService, SupportNotificationInput } from '../SupportEmailService';
import { KycEmailService, KycNotificationInput } from '../KycEmailService';

// Real Nodemailer stream transport compiles RFC 822 bytes without an SMTP
// connection. All addresses and the one attachment are local test fixtures.
const originalEnv = process.env;
const documentPath = path.join(__dirname, 'fixtures', 'mail-document.txt');
const supportInput: SupportNotificationInput = {
  conversationId: 'fixture-conversation',
  subjectLabel: 'Technical support',
  name: 'Olena',
  email: 'olena@example.com',
  body: 'Please help with this local test request.',
};
const kycInput: KycNotificationInput = {
  submissionId: 'fixture-submission',
  email: 'olena@example.com',
  fullName: 'Olena Test',
  country: 'UA',
  dateOfBirth: '1990-01-01',
  documentType: 'PASSPORT',
  documentPath,
  documentMimeType: 'application/pdf',
};

function streamTransport() {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const send = jest.spyOn(transport, 'sendMail');
  return {
    transport,
    send,
    async result() {
      expect(send).toHaveBeenCalledTimes(1);
      const result = await send.mock.results[0].value;
      expect(Buffer.isBuffer(result.message)).toBe(true);
      return { envelope: result.envelope, message: result.message.toString('utf8') as string };
    },
  };
}

describe('Nodemailer upgrade compatibility and mail option boundaries', () => {
  let netConnect: jest.SpyInstance;
  let tlsConnect: jest.SpyInstance;

  beforeEach(() => {
    // Do not inherit any developer/production SMTP configuration into tests.
    process.env = { ...originalEnv };
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
      'SUPPORT_ADMIN_EMAIL', 'SUPPORT_FROM_EMAIL', 'SUPPORT_INBOUND_EMAIL', 'KYC_ADMIN_EMAIL', 'KYC_FROM_EMAIL']) {
      delete process.env[name];
    }
    process.env.SUPPORT_ADMIN_EMAIL = 'support-admin@example.com';
    process.env.SUPPORT_FROM_EMAIL = 'support@example.com';
    process.env.KYC_ADMIN_EMAIL = 'kyc-admin@example.com';
    process.env.KYC_FROM_EMAIL = 'kyc@example.com';
    netConnect = jest.spyOn(net, 'connect').mockImplementation(() => { throw new Error('Network forbidden in mail tests'); });
    tlsConnect = jest.spyOn(tls, 'connect').mockImplementation(() => { throw new Error('Network forbidden in mail tests'); });
  });

  afterEach(() => {
    try {
      expect(netConnect).not.toHaveBeenCalled();
      expect(tlsConnect).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      process.env = originalEnv;
    }
  });

  it.each([
    { name: 'Support', create: () => new SupportEmailService() },
    { name: 'KYC', create: () => new KycEmailService() },
  ])('$name keeps explicit SMTP host/port/TLS and username/password options', ({ create }) => {
    Object.assign(process.env, {
      SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '465', SMTP_SECURE: 'true',
      SMTP_USER: 'local-test-user', SMTP_PASS: 'local-test-password',
    });
    // Constructor inspection only; no send/verify or socket is opened.
    const createTransport = jest.spyOn(nodemailer, 'createTransport');
    create();
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.invalid', port: 465, secure: true,
      auth: { user: 'local-test-user', pass: 'local-test-password' },
    });
  });

  it.each([
    { name: 'Support', create: () => new SupportEmailService() },
    { name: 'KYC', create: () => new KycEmailService() },
  ])('$name retains port 587, secure false and no auth when optional SMTP settings are absent', ({ create }) => {
    process.env.SMTP_HOST = 'smtp.example.invalid';
    const createTransport = jest.spyOn(nodemailer, 'createTransport');
    create();
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.invalid', port: 587, secure: false, auth: undefined,
    });
  });

  it('compiles the unchanged support message with a safe user reply address using real Nodemailer', async () => {
    const mail = streamTransport();
    await new SupportEmailService(mail.transport).notifyNewMessage(supportInput);
    expect(mail.send).toHaveBeenCalledWith({
      from: 'support@example.com', to: 'support-admin@example.com', replyTo: 'olena@example.com',
      subject: '[Ticket #fixture-conversation] Technical support — Olena',
      text: 'Від: Olena <olena@example.com>\nТема звернення: Technical support\nID бесіди: fixture-conversation\n\nPlease help with this local test request.',
    });
    const result = await mail.result();
    expect(result.envelope).toEqual({ from: 'support@example.com', to: ['support-admin@example.com'] });
    expect(result.message).toContain('From: support@example.com');
    expect(result.message).toContain('To: support-admin@example.com');
    expect(result.message).toContain('Reply-To: olena@example.com');
    expect(result.message).toContain('Content-Type: text/plain; charset=utf-8');
    expect(result.message).toContain('Please help with this local test request.');
  });

  it('compiles configured support replyTo without changing the actual SMTP recipient', async () => {
    process.env.SUPPORT_INBOUND_EMAIL = 'inbound@example.com';
    const mail = streamTransport();
    await new SupportEmailService(mail.transport).notifyNewMessage(supportInput);
    const result = await mail.result();
    expect(result.message).toContain('Reply-To: inbound@example.com');
    expect(result.message).not.toContain('Reply-To: olena@example.com');
    expect(result.envelope.to).toEqual(['support-admin@example.com']);
  });

  it.each([
    ['application/pdf', 'pdf'], ['image/jpeg', 'jpg'], ['image/png', 'png'],
  ])('compiles the intentional KYC local attachment for %s without changing message composition', async (mime, extension) => {
    const mail = streamTransport();
    await new KycEmailService(mail.transport).notifySubmission({ ...kycInput, documentMimeType: mime });
    expect(mail.send).toHaveBeenCalledWith({
      from: 'kyc@example.com', to: 'kyc-admin@example.com',
      subject: '[KYC] Новая заявка на верификацию — Olena Test (olena@example.com)',
      text: 'Email: olena@example.com\nФИО: Olena Test\nСтрана: UA\nДата рождения: 1990-01-01\nТип документа: PASSPORT\nID заявки: fixture-submission\n\nДокумент приложен к письму. Проверить/одобрить заявку можно в админ-панели (/admin/kyc).',
      attachments: [{ filename: `passport-fixture-submission.${extension}`, path: documentPath, contentType: mime }],
    });
    const result = await mail.result();
    expect(result.envelope).toEqual({ from: 'kyc@example.com', to: ['kyc-admin@example.com'] });
    const unfolded = result.message.replace(/\r?\n[ \t]+/g, ' ');
    expect(unfolded).toContain('Content-Type: multipart/mixed;');
    expect(unfolded).toContain(`Content-Type: ${mime}; name=passport-fixture-submission.${extension}`);
    expect(unfolded).toContain(`Content-Disposition: attachment; filename=passport-fixture-submission.${extension}`);
    expect(result.message).toContain(fs.readFileSync(documentPath).toString('base64'));
  });

  it('never passes arbitrary support raw, href, path, recipient, envelope or attachment options into Nodemailer', async () => {
    const mail = streamTransport();
    await new SupportEmailService(mail.transport).notifyNewMessage({
      ...supportInput, raw: { href: 'https://blocked.example.invalid/message' },
      href: 'https://blocked.example.invalid/', path: '/not-an-allowed-file',
      to: 'untrusted@example.com', envelope: { size: 'untrusted' },
      attachments: [{ path: '/not-an-allowed-file' }],
    } as SupportNotificationInput);
    const options = mail.send.mock.calls[0][0] as SendMailOptions;
    expect(Object.keys(options).sort()).toEqual(['from', 'replyTo', 'subject', 'text', 'to']);
    expect((await mail.result()).envelope.to).toEqual(['support-admin@example.com']);
  });

  it('never passes arbitrary KYC raw, href, root path or extra attachments beyond the intentional document', async () => {
    const mail = streamTransport();
    await new KycEmailService(mail.transport).notifySubmission({
      ...kycInput, raw: { path: '/not-an-allowed-file' },
      href: 'https://blocked.example.invalid/', path: '/not-an-allowed-file',
      to: 'untrusted@example.com', attachments: [{ href: 'https://blocked.example.invalid/extra' }],
    } as KycNotificationInput);
    const options = mail.send.mock.calls[0][0] as SendMailOptions;
    expect(Object.keys(options).sort()).toEqual(['attachments', 'from', 'subject', 'text', 'to']);
    expect(options.attachments).toEqual([
      { filename: 'passport-fixture-submission.pdf', path: documentPath, contentType: 'application/pdf' },
    ]);
    expect((await mail.result()).envelope.to).toEqual(['kyc-admin@example.com']);
  });

  it('keeps KYC best-effort behavior when real local attachment compilation fails', async () => {
    const mail = streamTransport();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(new KycEmailService(mail.transport).notifySubmission({
      ...kycInput, documentPath: path.join(__dirname, 'fixtures', 'does-not-exist.pdf'),
    })).resolves.toBeUndefined();
    // Native filesystem errors can originate outside Jest's Error realm.
    expect(error).toHaveBeenCalledWith('[KycEmailService] Failed to send admin notification:',
      expect.objectContaining({ code: 'ENOENT', syscall: 'open' }));
    expect(mail.send).toHaveBeenCalledTimes(1);
    await expect(mail.send.mock.results[0].value).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
