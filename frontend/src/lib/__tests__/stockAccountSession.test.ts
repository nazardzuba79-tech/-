import { StockSessionFence, pendingOrderKey } from '../../pages/stocks/global/accountSession';

test('a late response cannot expose the previous account after login change, logout or same-token re-login', () => {
  let token: string | null = 'alice-test'; const fence = new StockSessionFence(() => token);
  const alice = fence.capture(); expect(alice.current()).toBe(true);
  token = 'bob-test'; expect(alice.current()).toBe(false);
  const bob = fence.capture(); token = null; expect(bob.current()).toBe(false);
  token = 'bob-test'; fence.invalidate(); expect(bob.current()).toBe(false);
  expect(fence.capture().headers).toEqual({ Authorization: 'Bearer bob-test' });
});
test('pending order idempotency keys are separated by server-resolved account, never by token', () => {
  expect(pendingOrderKey('alice')).not.toBe(pendingOrderKey('bob'));
  expect(pendingOrderKey('alice')).not.toBe(pendingOrderKey());
});
