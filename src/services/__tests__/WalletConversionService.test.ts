import BigNumber from 'bignumber.js';
import { DEFAULT_CONVERSION_ASSETS, KrakenConversionPrices, WalletConversionService, parseConversionAssets, parseConversionReserves, walletConversionConfig } from '../WalletConversionService';

const NOW = 1_800_000_000_000;
const tickers = [
  { pair: 'BTC/USD', lastPrice: '60500', bidPrice: '59000', askPrice: '60000' }, // the last trade is NOT the price
  { pair: 'EUR/USD', lastPrice: '1.25', bidPrice: '1.24', askPrice: '1.25' },
  { pair: 'USD/JPY', lastPrice: '150', bidPrice: '150', askPrice: '160' }, // 6.7% wide: not a market
  { pair: 'USD/CHF', lastPrice: '0.8', bidPrice: '0.8', askPrice: '0.801' },
  { pair: 'USDT/USD', lastPrice: '0.998', bidPrice: '0.997', askPrice: '0.998' },
  { pair: 'ETH/USD', lastPrice: '3000', bidPrice: '3001', askPrice: '3000' }, // crossed book: not a market
  { pair: 'BTC/USDT', lastPrice: '99999', bidPrice: '99998', askPrice: '99999' }, // mirror is NOT a USD execution pair
  { pair: 'NRX/USD', lastPrice: '5', bidPrice: '5', askPrice: '5' },
  { pair: 'VTA/USD', lastPrice: '2', bidPrice: '2', askPrice: '2' },
  { pair: 'BAD/USD', lastPrice: '1', bidPrice: 'NaN', askPrice: '1' },
];
const book = (entries: [string, string, string][]) => ({ bid: new Map(entries.map(([a, b]) => [a, b])), ask: new Map(entries.map(([a, , k]) => [a, k])) });
function provider(overrides = {}) {
  return new KrakenConversionPrices({ getTickersWithMeta: jest.fn().mockResolvedValue({ value: tickers, fetchedAt: NOW, stale: false, ...overrides }) } as any, () => NOW);
}
// Synthetic operator-verified reserves, ample for every test that is not about them.
const RESERVES = 'USD:1000000,EUR:1000000,USDT:1000000,USDC:1000000,BTC:100,ETH:1000';
const limits = (reserves = RESERVES, maxUsd = '1000', dailyUsd = '5000') => ({ maxUsd: new BigNumber(maxUsd), dailyUsd: new BigNumber(dailyUsd), reserves: parseConversionReserves(reserves, parseConversionAssets(DEFAULT_CONVERSION_ASSETS)!)! });
function fixture(available = '100', fetchedAt = NOW, blockedAt: Date | null = null, configured = limits()) {
  // Committed conversions so far: this account's last 24 hours (USD) and the net created per asset.
  const committed = { today: [] as { fromAmount: string; fromPriceUsd: string }[], exposure: {} as Record<string, string> };
  const prisma = { balance: { findUnique: jest.fn().mockResolvedValue({ available, locked: '1000' }), findMany: jest.fn().mockResolvedValue([{ asset: 'USD', available }]) },
    user: { findUnique: jest.fn().mockResolvedValue({ blockedAt }) }, $transaction: jest.fn(),
    auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn(async () => committed.today.map(metadata => ({ metadata }))) },
    $queryRaw: jest.fn((_strings: TemplateStringsArray, asset: string) => Promise.resolve([{ value: committed.exposure[asset] ?? '0' }])) } as any;
  // SOL has a real Kraken book but is not on the admission list.
  const prices = { read: jest.fn().mockResolvedValue({ fetchedAt, ...book([['USD', '1', '1'], ['EUR', '1.24', '1.25'], ['BTC', '59000', '60000'], ['USDT', '0.997', '0.998'], ['SOL', '150', '150.1']]) }),
    depth: jest.fn().mockResolvedValue('1000000000') };
  return { prisma, prices, committed, service: new WalletConversionService(prisma, prices, () => NOW, parseConversionAssets(DEFAULT_CONVERSION_ASSETS)!, configured) };
}
describe('wallet conversion pricing and admission', () => {
  test('prices on the actual USD bid/ask (never the last trade), inverse fiat pairs, depegged stablecoin; no synthetic, crossed or wide books', async () => {
    const p = await provider().read();
    expect([p.bid.get('BTC'), p.ask.get('BTC')]).toEqual(['59000', '60000']);
    expect([p.bid.get('USDT'), p.ask.get('USDT')]).toEqual(['0.997', '0.998']);
    expect([p.bid.get('EUR'), p.ask.get('EUR')]).toEqual(['1.24', '1.25']);
    // USD/CHF 0.8 / 0.801: selling CHF buys USD at the ask (1/0.801), buying CHF sells USD at the bid (1/0.8).
    expect(p.bid.get('CHF')).toMatch(/^1\.2484394506/); expect(p.ask.get('CHF')).toBe('1.25');
    for (const asset of ['NRX', 'VTA', 'BAD', 'JPY', 'ETH']) { expect(p.bid.has(asset)).toBe(false); expect(p.ask.has(asset)).toBe(false); }
  });
  test.each([{ stale: true }, { fetchedAt: NOW - 15001 }, { fetchedAt: NOW + 1 }, { fetchedAt: NaN }])('rejects unusable feed %j', async overrides => {
    await expect(provider(overrides).read()).rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });
  test('quote is zero-fee and server-owned, without reserve or transaction', async () => {
    const { service, prisma } = fixture();
    const q = await service.quote('customer', 'USD', 'EUR', '10.12');
    expect(q).toMatchObject({ fromAmount: '10.12', toAmount: '8.09', fromPriceUsd: '1', toPriceUsd: '1.25', fee: '0', source: 'kraken', pricing: 'bid-ask', expiresAt: NOW + 15000 });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: { id: q.quoteId, userId: 'customer', action: 'WALLET_CONVERSION_QUOTED', metadata: q } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('the result rounds DOWN once to the destination places; finer or too-small amounts are refused', async () => {
    const { service, prisma } = fixture();
    expect((await service.quote('customer', 'USD', 'BTC', '1')).toAmount).toBe('0.00001666'); // 8 places, never up
    expect((await service.quote('customer', 'BTC', 'USD', '0.00001')).toAmount).toBe('0.59'); // sold at the 59000 bid, 2 places
    expect((await service.quote('customer', 'USD', 'USDT', '1')).toAmount).toBe('1.002004'); // 6 places, real depeg
    prisma.auditLog.create.mockClear();
    for (const [from, to, amount] of [['USD', 'EUR', '0.001'], ['BTC', 'USD', '0.000000001'], ['BTC', 'USD', '0.00000001']]) {
      await expect(service.quote('customer', from, to, amount)).rejects.toMatchObject({ code: 'INVALID_CONVERSION' });
    }
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  test('0% fee keeps the market spread: a round trip never returns more than it started with', async () => {
    const { service } = fixture('1000000');
    const there = await service.quote('customer', 'USD', 'BTC', '1000'); // bought at the 60000 ask
    expect(there.toAmount).toBe('0.01666666');
    const back = await service.quote('customer', 'BTC', 'USD', there.toAmount); // sold at the 59000 bid
    expect(back.toAmount).toBe('983.33');
    const viaUsdt = await service.quote('customer', 'USD', 'USDT', '1000');
    expect(Number((await service.quote('customer', 'USDT', 'USD', viaUsdt.toAmount)).toAmount)).toBeLessThan(1000);
  });
  test('only admitted assets convert: a real Kraken price alone is not enough', async () => {
    const { service, prisma } = fixture();
    await expect(service.quote('customer', 'USD', 'SOL', '1')).rejects.toMatchObject({ code: 'UNSUPPORTED_ASSET' });
    const listed = await service.assets('customer');
    expect(listed.map(a => a.asset)).toEqual(['BTC', 'EUR', 'USD', 'USDT']);
    expect(listed.find(a => a.asset === 'BTC')).toMatchObject({ kind: 'crypto', scale: 8 });
    expect(listed.find(a => a.asset === 'EUR')).toMatchObject({ kind: 'fiat', scale: 2 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  test('an admin-blocked account cannot obtain a quote (also with a session issued before the block)', async () => {
    const { service, prisma, prices } = fixture('100', NOW, new Date(NOW - 1000));
    await expect(service.quote('customer', 'USD', 'EUR', '1')).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prices.read).not.toHaveBeenCalled();
  });
  test('admission list: default, override, and anything malformed keeps conversion off', () => {
    expect([...parseConversionAssets(DEFAULT_CONVERSION_ASSETS)!]).toEqual([['USD', 2], ['EUR', 2], ['USDT', 6], ['USDC', 6], ['BTC', 8], ['ETH', 18]]);
    expect([...parseConversionAssets('USD:2, SOL:9')!]).toEqual([['USD', 2], ['SOL', 9]]);
    for (const bad of ['', 'USD:2', 'USD:2,USD:2', 'USD:2,BTC:19', 'usd:2,BTC:8', 'USD,BTC:8', 'USD:2,NRX:8', 'USD:2,VTA:8', 'USD:2,AITH:8']) {
      expect(parseConversionAssets(bad)).toBeNull();
    }
    expect(walletConversionConfig({})).toMatchObject({ enabled: false });
    expect(walletConversionConfig({ WALLET_CONVERSION_ENABLED: '1' })).toMatchObject({ enabled: false });
    expect(walletConversionConfig({ WALLET_CONVERSION_ENABLED: 'true' })).toMatchObject({ enabled: true });
    const broken = walletConversionConfig({ WALLET_CONVERSION_ENABLED: 'true', WALLET_CONVERSION_ASSETS: 'USD:2,NRX:8' });
    expect(broken.enabled).toBe(false);
    expect(broken.problem).toMatch(/stays off/);
  });
  test('limits: safe defaults, no reserve by default, and anything malformed keeps conversion off', () => {
    const defaults = walletConversionConfig({ WALLET_CONVERSION_ENABLED: 'true' });
    expect([defaults.limits.maxUsd.toFixed(), defaults.limits.dailyUsd.toFixed(), defaults.limits.reserves.size]).toEqual(['1000', '5000', 0]);
    const set = walletConversionConfig({ WALLET_CONVERSION_ENABLED: 'true', WALLET_CONVERSION_MAX_USD: '250.50', WALLET_CONVERSION_DAILY_USD: '750', WALLET_CONVERSION_RESERVES: 'EUR:5000, BTC:0.5' });
    expect(set.enabled).toBe(true);
    expect([set.limits.maxUsd.toFixed(), set.limits.dailyUsd.toFixed(), [...set.limits.reserves].map(([a, v]) => [a, v.toFixed()])]).toEqual(['250.5', '750', [['EUR', '5000'], ['BTC', '0.5']]]);
    for (const env of [{ WALLET_CONVERSION_MAX_USD: '0' }, { WALLET_CONVERSION_MAX_USD: '-5' }, { WALLET_CONVERSION_MAX_USD: '1e3' }, { WALLET_CONVERSION_DAILY_USD: '' },
      { WALLET_CONVERSION_MAX_USD: '6000' }, // one conversion larger than the daily limit
      { WALLET_CONVERSION_RESERVES: 'SOL:10' }, { WALLET_CONVERSION_RESERVES: 'EUR:0' }, { WALLET_CONVERSION_RESERVES: 'EUR:1.001' }, { WALLET_CONVERSION_RESERVES: 'EUR:5,EUR:6' },
      { WALLET_CONVERSION_RESERVES: 'BTC' }, { WALLET_CONVERSION_RESERVES: 'btc:1' }, { WALLET_CONVERSION_RESERVES: 'NRX:1' }]) {
      const off = walletConversionConfig({ WALLET_CONVERSION_ENABLED: 'true', ...env });
      expect(off.enabled).toBe(false);
      expect(off.problem).toMatch(/stays off/);
    }
  });
  test('a single conversion above the limit is refused, valued at the source market bid', async () => {
    const { service, prisma } = fixture('1000000');
    expect((await service.quote('customer', 'USD', 'EUR', '1000')).fromAmount).toBe('1000');
    prisma.auditLog.create.mockClear();
    await expect(service.quote('customer', 'USD', 'EUR', '1000.01')).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(service.quote('customer', 'BTC', 'USD', '0.017')).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' }); // 0.017 × 59000 bid = 1003
    expect((await service.quote('customer', 'BTC', 'USD', '0.0169')).toAmount).toBe('997.1');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
  test('the account daily limit counts committed conversions of the last 24 hours', async () => {
    const { service, prisma, committed } = fixture('1000000');
    committed.today = [{ fromAmount: '4000', fromPriceUsd: '1' }, { fromAmount: '0.02', fromPriceUsd: '49500' }]; // 4000 + 990 USD
    expect((await service.quote('customer', 'USD', 'EUR', '10')).toAmount).toBe('8');
    prisma.auditLog.create.mockClear();
    await expect(service.quote('customer', 'USD', 'EUR', '10.01')).rejects.toMatchObject({ code: 'DAILY_LIMIT_EXCEEDED' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({ where: { userId: 'customer', action: 'WALLET_CONVERTED', createdAt: { gt: new Date(NOW - 86_400_000) } }, select: { metadata: true } });
  });
  test('no reserve, no credit: an asset without an operator-verified reserve is never a destination', async () => {
    const { service, prisma } = fixture('100', NOW, null, limits('EUR:1000'));
    for (const to of ['BTC', 'USDT', 'USD']) {
      await expect(service.quote('customer', 'EUR', to, '1')).rejects.toMatchObject({ code: 'RESERVE_UNVERIFIED' });
    }
    expect((await service.quote('customer', 'USD', 'EUR', '10')).toAmount).toBe('8'); // a reserved asset is still a destination
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
  test('the reserve caps the net amount all conversions have created in that asset', async () => {
    const { service, prisma, committed } = fixture('1000', NOW, null, limits('BTC:0.02,USD:1000'));
    committed.exposure.BTC = '0.015';
    expect((await service.quote('customer', 'USD', 'BTC', '300')).toAmount).toBe('0.005'); // exactly up to the reserve
    prisma.auditLog.create.mockClear();
    await expect(service.quote('customer', 'USD', 'BTC', '300.06')).rejects.toMatchObject({ code: 'RESERVE_EXHAUSTED' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  test('market depth near the quoted price must cover both legs; unknown depth refuses; USD needs none', async () => {
    const { service, prices, prisma } = fixture('1000');
    prices.depth.mockImplementation(async (asset: string, side: string) => ({ 'BTC:ask': '0.01', 'EUR:bid': '5' } as Record<string, string>)[`${asset}:${side}`] ?? null);
    expect((await service.quote('customer', 'USD', 'BTC', '600')).toAmount).toBe('0.01');
    expect(prices.depth.mock.calls).toEqual([['BTC', 'ask']]); // the USD leg is not looked up
    prisma.auditLog.create.mockClear();
    await expect(service.quote('customer', 'USD', 'BTC', '600.01')).rejects.toMatchObject({ code: 'INSUFFICIENT_LIQUIDITY' });
    expect((await service.quote('customer', 'EUR', 'BTC', '5')).toAmount).toBe('0.00010333'); // both legs covered
    prisma.auditLog.create.mockClear();
    await expect(service.quote('customer', 'EUR', 'USD', '5.01')).rejects.toMatchObject({ code: 'INSUFFICIENT_LIQUIDITY' }); // selling EUR: bid side
    await expect(service.quote('customer', 'USD', 'USDT', '1')).rejects.toMatchObject({ code: 'INSUFFICIENT_LIQUIDITY' }); // depth unknown
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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
  test('book depth: summed within 0.5 % of the touch on the side the conversion trades; stale, inverse or test books are unknown', async () => {
    const orderBook = { value: { bids: [{ price: '100', quantity: '1' }, { price: '99.6', quantity: '2' }, { price: '99.4', quantity: '50' }],
      asks: [{ price: '101', quantity: '0.5' }, { price: '101.5', quantity: '0.25' }, { price: '101.6', quantity: '40' }] }, fetchedAt: NOW, stale: false };
    const getOrderBookWithMeta = jest.fn().mockResolvedValue(orderBook);
    const depthOf = new KrakenConversionPrices({ getTickersWithMeta: jest.fn(), getOrderBookWithMeta } as any, () => NOW);
    expect(await depthOf.depth('BTC', 'bid')).toBe('3'); // 99.4 is below 100 × 0.995
    expect(await depthOf.depth('BTC', 'ask')).toBe('0.75'); // 101.6 is above 101 × 1.005
    expect(getOrderBookWithMeta).toHaveBeenCalledWith('BTC/USD', 50);
    for (const meta of [{ stale: true }, { fetchedAt: NOW - 15001 }, { fetchedAt: NOW + 1 }]) {
      getOrderBookWithMeta.mockResolvedValueOnce({ ...orderBook, ...meta });
      expect(await depthOf.depth('BTC', 'bid')).toBeNull();
    }
    getOrderBookWithMeta.mockResolvedValueOnce({ ...orderBook, value: { bids: [], asks: [] } });
    expect(await depthOf.depth('BTC', 'bid')).toBeNull();
    getOrderBookWithMeta.mockResolvedValueOnce({ ...orderBook, value: { bids: [{ price: '100', quantity: '1e3' }], asks: [] } });
    expect(await depthOf.depth('BTC', 'bid')).toBeNull();
    getOrderBookWithMeta.mockRejectedValueOnce(new Error('Unknown pair JPY/USD')); // USD/JPY is quoted the other way round
    expect(await depthOf.depth('JPY', 'bid')).toBeNull();
    getOrderBookWithMeta.mockClear();
    expect(await depthOf.depth('NRX', 'ask')).toBeNull();
    expect(getOrderBookWithMeta).not.toHaveBeenCalled();
  });
  test.each(['0', '-1', 'NaN', '1e1000000'])('rejects invalid price %s', async price => {
    const { service, prices } = fixture();
    prices.read.mockResolvedValue({ fetchedAt: NOW, ...book([['USD', '1', '1'], ['EUR', price, price]]) });
    await expect(service.quote('customer', 'USD', 'EUR', '1')).rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });
});
