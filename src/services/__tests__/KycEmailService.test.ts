import { KycEmailService } from '../KycEmailService';

const OLD_ENV = process.env;

const baseInput = {
  submissionId: 'sub-1',
  email: 'ivan@example.com',
  fullName: 'Іван Іванов',
  country: 'UA',
  dateOfBirth: '1990-01-01',
  documentType: 'PASSPORT',
  documentPath: '/tmp/uploads/kyc/some-file.jpg',
  documentMimeType: 'image/jpeg',
};

describe('KycEmailService', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('logs instead of sending when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const service = new KycEmailService();

    await service.notifySubmission(baseInput);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP not configured'));
    logSpy.mockRestore();
  });

  it('logs instead of sending when SMTP is configured but no admin email is set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    delete process.env.KYC_ADMIN_EMAIL;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const service = new KycEmailService();

    await service.notifySubmission(baseInput);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('KYC_ADMIN_EMAIL not set'));
    logSpy.mockRestore();
  });

  it('sends the submission details and document attachment via the injected transporter', async () => {
    process.env.KYC_ADMIN_EMAIL = 'admin@voltex.local';
    process.env.KYC_FROM_EMAIL = 'kyc-noreply@voltex.local';
    const sendMail = jest.fn().mockResolvedValue({});
    const service = new KycEmailService({ sendMail } as any);

    await service.notifySubmission(baseInput);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'kyc-noreply@voltex.local',
        to: 'admin@voltex.local',
        subject: expect.stringContaining('Іван Іванов'),
        text: expect.stringContaining('ivan@example.com'),
        attachments: [
          expect.objectContaining({
            filename: 'passport-sub-1.jpg',
            path: baseInput.documentPath,
            contentType: 'image/jpeg',
          }),
        ],
      })
    );
  });

  it('does not throw when the transporter rejects (best-effort)', async () => {
    process.env.KYC_ADMIN_EMAIL = 'admin@voltex.local';
    const sendMail = jest.fn().mockRejectedValue(new Error('relay down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = new KycEmailService({ sendMail } as any);

    await expect(service.notifySubmission(baseInput)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
