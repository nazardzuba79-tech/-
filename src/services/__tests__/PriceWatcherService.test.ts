import { PriceWatcherService } from '../PriceWatcherService';

function makeFakePrisma(orders: any[]) {
  return { order: { findMany: jest.fn(async () => orders) } } as any;
}

function makeOrderService(triggerImpl?: (id: string) => Promise<any>) {
  return { triggerOrder: jest.fn(triggerImpl ?? (async () => ({ order: {}, trades: [] }))) } as any;
}

function makePriceSource(lastPrice: string | null) {
  return { getTicker: jest.fn(async () => (lastPrice ? { lastPrice } : null)) };
}

function baseOrder(overrides: Partial<Record<string, any>>) {
  return {
    id: 'order-1',
    pair: 'BTC/USDT',
    side: 'SELL',
    type: 'STOP_LIMIT',
    triggerPrice: { toString: () => '55000' },
    status: 'PENDING_TRIGGER',
    ocoGroupId: null,
    ...overrides,
  };
}

describe('PriceWatcherService.checkAndTrigger', () => {
  it('triggers a SELL STOP when price falls to/through the trigger', async () => {
    const order = baseOrder({ type: 'STOP_LIMIT', side: 'SELL', triggerPrice: { toString: () => '55000' } });
    const orderService = makeOrderService();
    const svc = new PriceWatcherService(makeFakePrisma([order]), orderService, makePriceSource('55000'));

    const count = await svc.checkAndTrigger();

    expect(count).toBe(1);
    expect(orderService.triggerOrder).toHaveBeenCalledWith('order-1');
  });

  it('does not trigger a SELL STOP while price is still above the trigger', async () => {
    const order = baseOrder({ type: 'STOP_LIMIT', side: 'SELL', triggerPrice: { toString: () => '55000' } });
    const orderService = makeOrderService();
    const svc = new PriceWatcherService(makeFakePrisma([order]), orderService, makePriceSource('56000'));

    const count = await svc.checkAndTrigger();

    expect(count).toBe(0);
    expect(orderService.triggerOrder).not.toHaveBeenCalled();
  });

  it('triggers a BUY STOP when price rises to/through the trigger', async () => {
    const order = baseOrder({ type: 'STOP_LIMIT', side: 'BUY', triggerPrice: { toString: () => '65000' } });
    const orderService = makeOrderService();
    const svc = new PriceWatcherService(makeFakePrisma([order]), orderService, makePriceSource('65100'));

    expect(await svc.checkAndTrigger()).toBe(1);
    expect(orderService.triggerOrder).toHaveBeenCalledWith('order-1');
  });

  it('triggers a SELL TAKE_PROFIT when price rises to/through the trigger', async () => {
    const order = baseOrder({ type: 'TAKE_PROFIT_LIMIT', side: 'SELL', triggerPrice: { toString: () => '65000' } });
    const orderService = makeOrderService();
    const svc = new PriceWatcherService(makeFakePrisma([order]), orderService, makePriceSource('65000'));

    expect(await svc.checkAndTrigger()).toBe(1);
  });

  it('does not trigger a SELL TAKE_PROFIT while price is still below the trigger', async () => {
    const order = baseOrder({ type: 'TAKE_PROFIT_LIMIT', side: 'SELL', triggerPrice: { toString: () => '65000' } });
    const orderService = makeOrderService();
    const svc = new PriceWatcherService(makeFakePrisma([order]), orderService, makePriceSource('64000'));

    expect(await svc.checkAndTrigger()).toBe(0);
  });

  it('triggers a BUY TAKE_PROFIT when price falls to/through the trigger', async () => {
    const order = baseOrder({ type: 'TAKE_PROFIT_MARKET', side: 'BUY', triggerPrice: { toString: () => '55000' } });
    const orderService = makeOrderService();
    const svc = new PriceWatcherService(makeFakePrisma([order]), orderService, makePriceSource('54900'));

    expect(await svc.checkAndTrigger()).toBe(1);
  });

  it('never triggers off a missing/failed price — an honest skip, not a guess', async () => {
    const order = baseOrder({});
    const orderService = makeOrderService();
    const svc = new PriceWatcherService(makeFakePrisma([order]), orderService, makePriceSource(null));

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(orderService.triggerOrder).not.toHaveBeenCalled();
  });

  it('does not let one order throwing during trigger stop the rest of the scan', async () => {
    const orderA = baseOrder({ id: 'order-a', triggerPrice: { toString: () => '55000' } });
    const orderB = baseOrder({ id: 'order-b', triggerPrice: { toString: () => '55000' } });
    const orderService = makeOrderService(async (id: string) => {
      if (id === 'order-a') throw new Error('boom');
      return { order: {}, trades: [] };
    });
    const svc = new PriceWatcherService(makeFakePrisma([orderA, orderB]), orderService, makePriceSource('55000'));

    const count = await svc.checkAndTrigger();

    expect(count).toBe(1); // only order-b counted as successfully triggered
    expect(orderService.triggerOrder).toHaveBeenCalledWith('order-a');
    expect(orderService.triggerOrder).toHaveBeenCalledWith('order-b');
  });

  it('fetches the price once per pair even with multiple pending orders on it', async () => {
    const orderA = baseOrder({ id: 'order-a', triggerPrice: { toString: () => '55000' } });
    const orderB = baseOrder({ id: 'order-b', triggerPrice: { toString: () => '56000' } });
    const priceSource = makePriceSource('54000');
    const svc = new PriceWatcherService(makeFakePrisma([orderA, orderB]), makeOrderService(), priceSource);

    await svc.checkAndTrigger();

    expect(priceSource.getTicker).toHaveBeenCalledTimes(1);
  });

  it('returns 0 with no pending orders and never calls the price source', async () => {
    const priceSource = makePriceSource('60000');
    const svc = new PriceWatcherService(makeFakePrisma([]), makeOrderService(), priceSource);

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(priceSource.getTicker).not.toHaveBeenCalled();
  });
});
