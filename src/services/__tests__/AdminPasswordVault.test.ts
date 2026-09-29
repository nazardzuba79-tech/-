import { decryptAdminPassword, encryptAdminPassword } from '../AdminPasswordVault';

const originalKey = process.env.API_KEY_ENCRYPTION_SECRET;
beforeEach(() => { process.env.API_KEY_ENCRYPTION_SECRET = '1'.repeat(64); });
afterAll(() => {
  if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_SECRET;
  else process.env.API_KEY_ENCRYPTION_SECRET = originalKey;
});

it('encrypts a new password with fresh randomness and binds it to its account', () => {
  const password = 'ExampleTestPassword123';
  const first = encryptAdminPassword(password, 'user@example.test');
  const second = encryptAdminPassword(password, 'user@example.test');
  expect(first).not.toBe(second);
  expect(first).not.toContain(password);
  expect(decryptAdminPassword(first, 'user@example.test')).toBe(password);
  expect(() => decryptAdminPassword(first, 'other@example.test')).toThrow();
});

it('rejects tampering and a missing encryption secret', () => {
  const encrypted = encryptAdminPassword('ExampleTestPassword123', 'user@example.test');
  const bytes = Buffer.from(encrypted.slice(3), 'base64');
  bytes[bytes.length - 1] ^= 1;
  expect(() => decryptAdminPassword(`v1.${bytes.toString('base64')}`, 'user@example.test')).toThrow();
  delete process.env.API_KEY_ENCRYPTION_SECRET;
  expect(() => encryptAdminPassword('ExampleTestPassword123', 'user@example.test')).toThrow();
});
