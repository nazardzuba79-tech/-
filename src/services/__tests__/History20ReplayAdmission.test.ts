import BigNumber from 'bignumber.js';
import { OrderService } from '../OrderService';

// Current-main idempotency must not return a private order after participant
// admission has been revoked. No DB, ledger, venue or transaction is invoked.
function fixture() {
  const prisma = { order: { findUnique: jest.fn(async () => ({ id: 'committed-private-order' })) } };
  const price = { getTicker: jest.fn(async () => { throw new Error('Unexpected venue request'); }) };
  const service = new OrderService(prisma as never, {} as never, price as never);
  const admission = jest.spyOn(service as any, 'privateAdmitted').mockResolvedValue(false);
  const replay = jest.spyOn(service as any, 'replayOrder').mockResolvedValue({ id: 'committed-private-order' });
  const replayOco = jest.spyOn(service as any, 'replayOco').mockResolvedValue({ ocoGroupId: 'committed-private-oco' });
  return { service, prisma, price, admission, replay, replayOco };
}

const request = {
  userId: 'synthetic-former-participant', pair: 'VHX01/SIMUSDT', side: 'BUY' as const,
  quantity: new BigNumber(1), requestId: 'a6a91cc1-1234-4123-8123-123456789012',
};

test('private single-order retry checks current participant admission before reading/replaying a committed order', async () => {
  const f = fixture();
  await expect(f.service.placeOrder({ ...request, type: 'LIMIT', price: new BigNumber(2) })).rejects.toThrow();
  expect(f.admission).toHaveBeenCalledWith(request.pair, request.userId);
  expect(f.prisma.order.findUnique).not.toHaveBeenCalled();
  expect(f.replay).not.toHaveBeenCalled();
  expect(f.price.getTicker).not.toHaveBeenCalled();
});

test('private OCO retry checks current participant admission before replay', async () => {
  const f = fixture();
  await expect(f.service.placeOcoOrder({ ...request, takeProfitPrice: new BigNumber(3),
    stopTriggerPrice: new BigNumber(1), stopLimitPrice: new BigNumber('0.9') })).rejects.toThrow();
  expect(f.admission).toHaveBeenCalledWith(request.pair, request.userId);
  expect(f.replayOco).not.toHaveBeenCalled();
  expect(f.price.getTicker).not.toHaveBeenCalled();
});
