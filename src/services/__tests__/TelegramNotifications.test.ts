import { createPublicKey, verify } from 'crypto';
import { notificationPublicKey, notifyDeposit } from '../TelegramNotifications';

const transfer = { id: 'synthetic-deposit', amount: { toString: () => '15' }, createdAt: new Date() };
const original = process.env.JWT_SECRET;
beforeEach(() => { process.env.JWT_SECRET = 'synthetic-notification-key-not-production-123'; });
afterEach(() => { if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original; jest.restoreAllMocks(); });

test('one signed call from existing transfer; no DB dependency, no user lookup, correct signature', async () => {
  const mock = jest.fn(async (_url, init) => {
    expect(_url).toBe('https://notify.voltextech.net/v1/deposit');
    const headers = init.headers;
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: notificationPublicKey()! }, format: 'jwk' });
    expect(verify(null, Buffer.from(`voltex-notifications-v1\n${headers['x-voltex-timestamp']}\n/v1/deposit\n${init.body}`), key, Buffer.from(headers['x-voltex-signature'], 'base64url'))).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ eventId: transfer.id, eventType: 'DEPOSIT_DISCOVERED', timestamp: transfer.createdAt.getTime(), amount: '15', asset: 'USDT', network: 'TRC20' });
    return Response.json({ status: 'SENT' });
  });
  await notifyDeposit(transfer, mock as typeof fetch);
  expect(mock).toHaveBeenCalledTimes(1);
});
test.each(['timeout', 'http'])('%s never rejects or retries; logs contain no payload/secret', async mode => {
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const mock = jest.fn(async () => { if (mode === 'timeout') throw new Error('secret-token private@email.test'); return new Response('secret-token', { status: 503 }); });
  await expect(notifyDeposit(transfer, mock)).resolves.toBeUndefined();
  expect(mock).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|private@|synthetic-deposit/);
});
test('missing configuration cannot send, no timer or polling starts on import', async () => {
  delete process.env.JWT_SECRET;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const mock = jest.fn(); await notifyDeposit(transfer, mock);
  expect(mock).not.toHaveBeenCalled(); expect(notificationPublicKey()).toBeNull();
});
