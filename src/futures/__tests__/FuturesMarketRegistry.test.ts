import { FuturesMarketRegistry } from '../FuturesMarketRegistry';
import { CORE_FUTURES_SYMBOLS, MAX_PERP_MARKETS, MIN_PERP_24H_QUOTE_VOLUME } from '../../config/futuresConfig';

function ticker(pair: string, lastPrice: string, quoteVolume24h: string) {
  return { pair, lastPrice, quoteVolume24h } as any;
}

function makeRegistry(tickers: any, inFlight: { positions?: string[]; orders?: string[] } = {}) {
  const marketData = {
    getTickers: jest.fn(typeof tickers === 'function' ? tickers : async () => tickers),
  } as any;
  const prisma = {
    futuresPosition: {
      findMany: jest.fn(async () => (inFlight.positions ?? []).map((symbol) => ({ symbol }))),
    },
    futuresOrder: {
      findMany: jest.fn(async () => (inFlight.orders ?? []).map((symbol) => ({ symbol }))),
    },
  } as any;
  return { registry: new FuturesMarketRegistry(marketData, prisma), marketData, prisma };
}

const BIG = String(MIN_PERP_24H_QUOTE_VOLUME * 10);

describe('FuturesMarketRegistry', () => {
  it('starts on the core contracts before any refresh', () => {
    const { registry } = makeRegistry([]);
    expect(registry.list()).toEqual(CORE_FUTURES_SYMBOLS);
  });

  it('lists eligible USDT markets beyond the core three', async () => {
    const { registry } = makeRegistry([
      ticker('BTC/USDT', '100000', BIG),
      ticker('ETH/USDT', '3000', BIG),
      ticker('SOL/USDT', '200', BIG),
      ticker('XRP/USDT', '2.5', BIG),
      ticker('DOGE/USDT', '0.4', BIG),
    ]);
    const listed = await registry.refresh();
    expect(listed).toContain('XRP/USDT');
    expect(listed).toContain('DOGE/USDT');
    expect(listed.length).toBe(5);
  });

  it('ranks non-core markets by 24h quote volume descending, core first', async () => {
    const { registry } = makeRegistry([
      ticker('BTC/USDT', '100000', '5000000'),
      ticker('ETH/USDT', '3000', '4000000'),
      ticker('SOL/USDT', '200', '3000000'),
      ticker('AAA/USDT', '1', '9000000'),
      ticker('BBB/USDT', '1', '7000000'),
      ticker('CCC/USDT', '1', '8000000'),
    ]);
    const listed = await registry.refresh();
    expect(listed.slice(0, 3)).toEqual(CORE_FUTURES_SYMBOLS);
    // Highest volume first among the rest — nothing is pinned by hand.
    expect(listed.slice(3)).toEqual(['AAA/USDT', 'CCC/USDT', 'BBB/USDT']);
  });

  it('refuses to list a market quoted in anything but USDT', async () => {
    const { registry } = makeRegistry([
      ticker('BTC/USDT', '100000', BIG),
      ticker('ETH/EUR', '3000', BIG),
      ticker('XBT/GBP', '100000', BIG),
    ]);
    const listed = await registry.refresh();
    expect(listed).not.toContain('ETH/EUR');
    expect(listed).not.toContain('XBT/GBP');
  });

  it('refuses to list a market with no live index price', async () => {
    // Mark price, funding and liquidation all read the index — a contract
    // without one must never become tradeable.
    const { registry } = makeRegistry([
      ticker('BTC/USDT', '100000', BIG),
      ticker('DEAD/USDT', '0', BIG),
      ticker('NAN/USDT', 'not-a-number', BIG),
    ]);
    const listed = await registry.refresh();
    expect(listed).not.toContain('DEAD/USDT');
    expect(listed).not.toContain('NAN/USDT');
  });

  it('refuses to list a market below the 24h volume floor', async () => {
    const { registry } = makeRegistry([
      ticker('BTC/USDT', '100000', BIG),
      ticker('THIN/USDT', '1', String(MIN_PERP_24H_QUOTE_VOLUME - 1)),
    ]);
    const listed = await registry.refresh();
    expect(listed).not.toContain('THIN/USDT');
  });

  it('caps the listing at MAX_PERP_MARKETS plus the core contracts', async () => {
    const many = Array.from({ length: MAX_PERP_MARKETS + 25 }, (_, i) =>
      ticker(`C${i}/USDT`, '1', String(MIN_PERP_24H_QUOTE_VOLUME + i))
    );
    const { registry } = makeRegistry(many);
    const listed = await registry.refresh();
    expect(listed.length).toBeLessThanOrEqual(MAX_PERP_MARKETS + CORE_FUTURES_SYMBOLS.length);
  });

  it('never delists a symbol carrying an open position', async () => {
    // Volume dipping under the floor must not strand a position behind a
    // symbol the order route would then reject.
    const { registry } = makeRegistry(
      [ticker('BTC/USDT', '100000', BIG), ticker('THIN/USDT', '1', '1')],
      { positions: ['THIN/USDT'] }
    );
    const listed = await registry.refresh();
    expect(listed).toContain('THIN/USDT');
    expect(registry.has('THIN/USDT')).toBe(true);
  });

  it('never delists a symbol carrying a resting order', async () => {
    const { registry } = makeRegistry([ticker('BTC/USDT', '100000', BIG)], { orders: ['GONE/USDT'] });
    expect(await registry.refresh()).toContain('GONE/USDT');
  });

  it('keeps the previous listing when the ticker feed fails', async () => {
    const { registry, marketData } = makeRegistry([
      ticker('BTC/USDT', '100000', BIG),
      ticker('XRP/USDT', '2.5', BIG),
    ]);
    const good = await registry.refresh();
    expect(good).toContain('XRP/USDT');

    marketData.getTickers.mockRejectedValueOnce(new Error('Kraken responded with HTTP 403'));
    expect(await registry.refresh()).toEqual(good);
  });

  it('keeps the previous listing when the feed returns nothing usable', async () => {
    const { registry, marketData } = makeRegistry([ticker('BTC/USDT', '100000', BIG)]);
    const good = await registry.refresh();
    marketData.getTickers.mockResolvedValueOnce([]);
    expect(await registry.refresh()).toEqual(good);
  });

  it('always keeps the core contracts listed even with no market data at all', async () => {
    const { registry } = makeRegistry([]);
    await registry.refresh();
    for (const symbol of CORE_FUTURES_SYMBOLS) expect(registry.has(symbol)).toBe(true);
  });

  it('rejects membership for a market that was never listed', async () => {
    const { registry } = makeRegistry([ticker('BTC/USDT', '100000', BIG)]);
    await registry.refresh();
    expect(registry.has('NOPE/USDT')).toBe(false);
  });
});
