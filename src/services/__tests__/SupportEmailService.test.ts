import { SupportEmailService } from '../SupportEmailService';

const OLD_ENV = process.env;

describe('SupportEmailService', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('logs instead of sending when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const service = new SupportEmailService();

    await service.notifyNewMessage({
      conversationId: 'conv-1',
      subjectLabel: 'Технічна проблема',
      name: 'Іван',
      email: 'ivan@example.com',
      body: 'Не працює вивід коштів',
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP not configured'));
    logSpy.mockRestore();
  });

  it('sends via the injected transporter when configured, including the ticket id in the subject', async () => {
    process.env.SUPPORT_ADMIN_EMAIL = 'admin@voltex.local';
    process.env.SUPPORT_FROM_EMAIL = 'noreply@voltex.local';
    const sendMail = jest.fn().mockResolvedValue({});
    const service = new SupportEmailService({ sendMail } as any);

    await service.notifyNewMessage({
      conversationId: 'conv-42',
      subjectLabel: 'Питання по KYC',
      name: 'Олена',
      email: 'olena@example.com',
      body: 'Коли перевірять документи?',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@voltex.local',
        to: 'admin@voltex.local',
        replyTo: 'olena@example.com',
        subject: expect.stringContaining('[Ticket #conv-42]'),
        text: expect.stringContaining('Коли перевірять документи?'),
      })
    );
  });

  it('uses a configured inbound reply address instead of the user email when set', async () => {
    process.env.SUPPORT_ADMIN_EMAIL = 'admin@voltex.local';
    process.env.SUPPORT_INBOUND_EMAIL = 'inbound@voltex.local';
    const sendMail = jest.fn().mockResolvedValue({});
    const service = new SupportEmailService({ sendMail } as any);

    await service.notifyNewMessage({
      conversationId: 'conv-1',
      subjectLabel: 'Інше',
      name: 'Ivan',
      email: 'ivan@example.com',
      body: 'hi',
    });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'inbound@voltex.local' }));
  });

  it('does not throw when the transporter rejects (best-effort)', async () => {
    process.env.SUPPORT_ADMIN_EMAIL = 'admin@voltex.local';
    const sendMail = jest.fn().mockRejectedValue(new Error('relay down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = new SupportEmailService({ sendMail } as any);

    await expect(
      service.notifyNewMessage({ conversationId: 'conv-1', subjectLabel: 'Інше', name: 'Ivan', email: 'ivan@example.com', body: 'hi' })
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('logs instead of sending when SMTP is configured but no admin email is set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    delete process.env.SUPPORT_ADMIN_EMAIL;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const service = new SupportEmailService();

    await service.notifyNewMessage({ conversationId: 'conv-1', subjectLabel: 'Інше', name: 'Ivan', email: 'ivan@example.com', body: 'hi' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SUPPORT_ADMIN_EMAIL not set'));
    logSpy.mockRestore();
  });
});
