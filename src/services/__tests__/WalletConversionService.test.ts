import { KrakenConversionPrices, WalletConversionService } from '../WalletConversionService';

const NOW = 1_800_000_000_000;
const tickers = [
  { pair: 'BTC/USD', lastPrice: '60000' },
  { pair: 'EUR/USD', lastPrice: '1.25' },
  { pair: 'USD/JPY', lastPrice: '150' },
  { pair: 'USDT/USD', lastPrice: '0.998' },
  { pair: 'BTC/USDT', lastPrice: '99999' }, // mirror is NOT a USD execution pair
  { pair: 'NRX/USD', lastPrice: '5' },
  { pair: 'VTA/USD', lastPrice: '2' },
  { pair: 'BAD/USD', lastPrice: 'NaN' },
];
function provider(overrides = {}) {
  return new KrakenConversionPrices({ getTickersWithMeta: jest.fn().mockResolvedValue({ value: tickers, fetchedAt: NOW, stale: false, ...overrides }) } as any, () => NOW);
}
function fixture(available = '100', fetchedAt = NOW) {
  const prisma = { balance: { findUnique: jest.fn().mockResolvedValue({ available, locked: '1000' }), findMany: jest.fn().mockResolvedValue([{ asset: 'USD', available }]) }, auditLog: { create: jest.fn().mockResolvedValue({}) }, $transaction: jest.fn() } as any;
  const prices = { read: jest.fn().mockResolvedValue({ fetchedAt, values: new Map([['USD', '1'], ['EUR', '1.25'], ['BTC', '60000'], ['USDT', '0.998']]) }) };
  return { prisma, prices, service: new WalletConversionService(prisma, prices, () => NOW) };
}
describe('wallet conversion pricing and admission', () => {
  test('uses last actual USD market price, inverse fiat pairs and depegged stablecoin; excludes synthetic assets', async () => {
    const p = await provider().read();
    expect(p.values.get('BTC')).toBe('60000');
    expect(p.values.get('USDT')).toBe('0.998');
    expect(p.values.get('EUR')).toBe('1.25');
    expect(p.values.get('JPY')).toMatch(/^0\.006666666/);
    for (const asset of ['NRX', 'VTA', 'BAD']) expect(p.values.has(asset)).toBe(false);
  });
  test.each([{ stale: true }, { fetchedAt: NOW - 15001 }, { fetchedAt: NOW + 1 }, { fetchedAt: NaN }])('rejects unusable feed %j', async overrides => {
    await expect(provider(overrides).read()).rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });
  test('quote is zero-fee and server-owned, without reserve or transaction', async () => {
    const { service, prisma } = fixture();
    const q = await service.quote('customer', 'USD', 'EUR', '10.125');
    expect(q).toMatchObject({ fromAmount: '10.125', toAmount: '8.1', fee: '0', source: 'kraken', expiresAt: NOW + 15000 });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: { id: q.quoteId, userId: 'customer', action: 'WALLET_CONVERSION_QUOTED', metadata: q } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('crypto output floors only once to the ledger precision', async () => {
    const { service } = fixture();
    expect((await service.quote('customer', 'USD', 'BTC', '1')).toAmount).toBe('0.000016666666666666');
    expect((await service.quote('customer', 'BTC', 'USD', '0.000000000000000001')).toAmount).toBe('0.00000000000006');
  });
  test.each(['0', '-1', '1e2', '1.0000000000000000001', '1000000000000000000', 'NaN', '01', '+1'])('rejects invalid amount %s before writes', async amount => {
    const { service, prisma } = fixture();
    await expect(service.quote('customer', 'USD', 'EUR', amount)).rejects.toMatchObject({ code: 'INVALID_CONVERSION' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  test('locked, Demo and missing assets cannot finance conversion', async () => {
    const { service } = fixture('0');
    await expect(service.quote('customer', 'USD', 'EUR', '1')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await expect(service.quote('customer', 'NRX', 'USD', '1')).rejects.toMatchObject({ code: 'UNSUPPORTED_ASSET' });
    await expect(service.quote('customer', 'USD', 'ZZZ', '1')).rejects.toMatchObject({ code: 'UNSUPPORTED_ASSET' });
  });
  test.each(['0', '-1', 'NaN', '1e1000000'])('rejects invalid price %s', async price => {
    const { service, prices } = fixture();
    prices.read.mockResolvedValue({ fetchedAt: NOW, values: new Map([['USD', '1'], ['EUR', price]]) });
    await expect(service.quote('customer', 'USD', 'EUR', '1')).rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });
});
