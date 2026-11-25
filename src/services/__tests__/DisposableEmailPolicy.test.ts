import { isDisposableRegistrationEmail, parseDisposableDomains } from '../DisposableEmailPolicy';
import { DISPOSABLE_EMAIL_SNAPSHOT } from '../disposableEmailDomains.snapshot';

describe('disposable registration domain policy', () => {
  const oldAllow = process.env.DISPOSABLE_EMAIL_ALLOW_DOMAINS;
  const oldBlock = process.env.DISPOSABLE_EMAIL_BLOCK_DOMAINS;
  beforeEach(() => { delete process.env.DISPOSABLE_EMAIL_ALLOW_DOMAINS; delete process.env.DISPOSABLE_EMAIL_BLOCK_DOMAINS; });
  afterAll(() => {
    if (oldAllow === undefined) delete process.env.DISPOSABLE_EMAIL_ALLOW_DOMAINS; else process.env.DISPOSABLE_EMAIL_ALLOW_DOMAINS = oldAllow;
    if (oldBlock === undefined) delete process.env.DISPOSABLE_EMAIL_BLOCK_DOMAINS; else process.env.DISPOSABLE_EMAIL_BLOCK_DOMAINS = oldBlock;
  });
  it.each(['fixture@euploading.com','fixture@MAIL.TM','fixture@sub.mail.tm','fixture@mailinator.com','fixture@guerrillamail.com','fixture@10minutemail.com'])('blocks %s', email => expect(isDisposableRegistrationEmail(email)).toBe(true));
  it.each(['fixture@gmail.com','fixture@outlook.com','fixture@hotmail.com','fixture@icloud.com','fixture@proton.me','fixture@mail.ru','fixture@yandex.ru','fixture@example.invalid','fixture@notmail.tm.invalid','bad','a@@mail.tm',null])('does not classify %s as disposable', email => expect(isDisposableRegistrationEmail(email)).toBe(false));
  it('retains an explicit exact-domain allow override and a manual block', () => {
    process.env.DISPOSABLE_EMAIL_ALLOW_DOMAINS = 'euploading.com';
    process.env.DISPOSABLE_EMAIL_BLOCK_DOMAINS = 'manual-test.example.invalid';
    expect(isDisposableRegistrationEmail('fixture@euploading.com')).toBe(false);
    expect(isDisposableRegistrationEmail('fixture@manual-test.example.invalid')).toBe(true);
  });
  it('validates the bundled snapshot and rejects broken or truncated updates', () => {
    const snapshot = parseDisposableDomains(DISPOSABLE_EMAIL_SNAPSHOT);
    expect(snapshot?.size).toBe(109341);
    expect(snapshot?.has('euploading.com')).toBe(true);
    expect(parseDisposableDomains('')).toBeNull();
    expect(parseDisposableDomains('mail.tm\n')).toBeNull();
    expect(parseDisposableDomains(DISPOSABLE_EMAIL_SNAPSHOT + '\n<html>')).toBeNull();
  });
});
