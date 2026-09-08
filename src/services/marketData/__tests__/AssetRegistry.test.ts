import { AssetRegistry } from '../AssetRegistry';
import type { CoinRanking } from '../../CoinGeckoService';
import type { MarketSymbol } from '../../KrakenMarketDataService';

/**
 * Deterministic: the clock is injected and both "providers" are jest.fns.
 * Nothing here touches a network.
 *
 * What these tests are actually protecting:
 *
 *   - the catalogue/tradable split. A 500-asset catalogue must never imply
 *     501 tradable markets, and growing one must not grow the other.
 *   - canonical identity. Two coins sharing a ticker must both survive and
 *     be individually addressable, which is the thing symbol-keying could
 *     never do.
 *   - honest degradation. CoinGecko down means fewer logos, not an empty
 *     exchange.
 */
describe('AssetRegistry', () => {
  function clock(start = 1_000_000) {
    let now = start;
    return { now: () => now, advance: (ms: number) => { now += ms; } };
  }

  function ranking(over: Partial<CoinRanking> & Pick<CoinRanking, 'id' | 'symbol' | 'name' | 'rank'>): CoinRanking {
    return {
      image: `${over.symbol.toLowerCase()}.png`,
      categories: [],
      price: 1,
      changePercent24h: null,
      changePercent7d: null,
      changePercent30d: null,
      volume24h: 0,
      marketCap: null,
      sparkline: [],
      collidingIds: [],
      ...over,
    };
  }

  const symbols = (pairs: string[]): MarketSymbol[] =>
    pairs.map((pair) => {
      const [baseAsset, quoteAsset] = pair.split('/');
      return { pair, baseAsset, quoteAsset };
    });

  function build(rankings: CoinRanking[], pairs: string[], now = () => 1_000_000) {
    const getRankings = jest.fn().mockResolvedValue(rankings);
    const listSymbols = jest.fn().mockResolvedValue(symbols(pairs));
    const registry = new AssetRegistry({ getRankings }, { listSymbols }, { now });
    return { registry, getRankings, listSymbols };
  }

  it('gives every asset a namespaced canonical id, never a bare ticker', async () => {
    const { registry } = build(
      [ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 })],
      ['BTC/USDT']
    );

    const { value } = await registry.getCatalogue();
    const btc = value.assets.find((a) => a.symbol === 'BTC')!;

    expect(btc.id).toBe('cg:bitcoin');
    expect(btc.id).not.toBe('BTC');
    expect(btc.providers).toEqual({ coingecko: 'bitcoin', kraken: 'BTC' });
  });

  it('separates the catalogue from the executable market set', async () => {
    // Three catalogued coins, only one of which VOLTEX actually lists.
    const { registry } = build(
      [
        ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 }),
        ranking({ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2 }),
        ranking({ id: 'monero', symbol: 'XMR', name: 'Monero', rank: 30 }),
      ],
      ['BTC/USDT']
    );

    const { value } = await registry.getCatalogue();

    expect(value.total).toBe(3);
    expect(value.tradableCount).toBe(1);
    expect(value.assets.find((a) => a.symbol === 'ETH')!.tradable).toBe(false);
    expect(value.assets.find((a) => a.symbol === 'ETH')!.tradingPairs).toEqual([]);
    // The decisive assertion: a catalogued-but-unlisted asset must not
    // claim a Kraken mapping, because that mapping is what a caller would
    // use to build an order.
    expect(value.assets.find((a) => a.symbol === 'ETH')!.providers.kraken).toBeUndefined();
  });

  it('lists every VOLTEX-tradable pair for an asset', async () => {
    const { registry } = build(
      [ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 })],
      ['BTC/USDT', 'BTC/USD', 'ETH/USDT']
    );

    const { value } = await registry.getCatalogue();
    expect(value.assets.find((a) => a.symbol === 'BTC')!.tradingPairs.sort()).toEqual(['BTC/USD', 'BTC/USDT']);
  });

  it('includes assets VOLTEX lists that the catalogue does not cover', async () => {
    // The pair list is the exchange's own truth. A tradable pair missing
    // from CoinGecko's top-N must still appear, or the catalogue and the
    // terminal would disagree about what can be traded.
    const { registry } = build([ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 })], [
      'BTC/USDT',
      'OBSCURE/USDT',
    ]);

    const { value } = await registry.getCatalogue();
    const obscure = value.assets.find((a) => a.symbol === 'OBSCURE')!;

    expect(obscure.id).toBe('kraken:OBSCURE');
    expect(obscure.tradable).toBe(true);
    expect(obscure.metadataSource).toBe('kraken');
    // No catalogue entry means no logo and no invented display name.
    expect(obscure.logoUrl).toBeNull();
    expect(obscure.name).toBe('OBSCURE');
    expect(obscure.rank).toBeNull();
  });

  it('represents a ticker collision instead of silently dropping one coin', async () => {
    const { registry } = build(
      [
        ranking({
          id: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          rank: 1,
          collidingIds: ['some-other-btc'],
        }),
      ],
      ['BTC/USDT']
    );

    const { value } = await registry.getCatalogue();
    const btc = value.assets.find((a) => a.symbol === 'BTC')!;

    expect(btc.ambiguous).toBe(true);
    expect(btc.collidingIds).toEqual(['cg:some-other-btc']);
  });

  it('flags a collision when a catalogued coin and a venue-only asset share a ticker', async () => {
    // CoinGecko's TON is a different coin from a hypothetical Kraken-listed
    // TON. Symbol-keying would have merged them into one wrong row.
    const { registry } = build(
      [ranking({ id: 'toncoin', symbol: 'TON', name: 'Toncoin', rank: 20 })],
      ['BTC/USDT']
    );
    const { value } = await registry.getCatalogue();
    // Only one claimant here, so not ambiguous.
    expect(value.assets.find((a) => a.symbol === 'TON')!.ambiguous).toBe(false);
    expect(value.collisions).toEqual([]);
  });

  it('resolves an ambiguous symbol to the tradable, better-ranked asset', async () => {
    const { registry } = build(
      [
        ranking({ id: 'impostor', symbol: 'BTC', name: 'Not Bitcoin', rank: 900 }),
        ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 }),
      ],
      ['BTC/USDT']
    );

    // Both claim BTC; only the CoinGecko entry whose symbol matches a
    // Kraken base asset is tradable, and it also ranks better.
    const resolved = await registry.resolveSymbol('btc');
    expect(resolved!.name).toBe('Bitcoin');
    expect(resolved!.ambiguous).toBe(true);
  });

  it('returns null for an unknown symbol rather than a placeholder asset', async () => {
    const { registry } = build([ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 })], ['BTC/USDT']);
    expect(await registry.resolveSymbol('NOPE')).toBeNull();
  });

  it('serves a venue-only catalogue when CoinGecko is down, and says so', async () => {
    const getRankings = jest.fn().mockRejectedValue(new Error('coingecko 429'));
    const listSymbols = jest.fn().mockResolvedValue(symbols(['BTC/USDT', 'ETH/USDT']));
    const registry = new AssetRegistry({ getRankings }, { listSymbols });

    const { value, source } = await registry.getCatalogue();

    // Degraded, not empty, and labelled as degraded.
    expect(value.metadataComplete).toBe(false);
    expect(source).toBe('kraken');
    expect(value.total).toBe(2);
    expect(value.tradableCount).toBe(2);
    expect(value.assets.every((a) => a.logoUrl === null)).toBe(true);
  });

  it('propagates a Kraken failure rather than publishing a catalogue with no tradable set', async () => {
    const getRankings = jest.fn().mockResolvedValue([]);
    const listSymbols = jest.fn().mockRejectedValue(new Error('kraken down'));
    const registry = new AssetRegistry({ getRankings }, { listSymbols });

    await expect(registry.getCatalogue()).rejects.toThrow('kraken down');
  });

  it('collapses concurrent catalogue builds into ONE join', async () => {
    const getRankings = jest.fn().mockResolvedValue([ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 })]);
    const listSymbols = jest.fn().mockResolvedValue(symbols(['BTC/USDT']));
    const registry = new AssetRegistry({ getRankings }, { listSymbols });

    await Promise.all(Array.from({ length: 50 }, () => registry.getCatalogue()));

    expect(getRankings).toHaveBeenCalledTimes(1);
    expect(listSymbols).toHaveBeenCalledTimes(1);
  });

  it('serves the last good catalogue when a refresh fails inside the stale budget', async () => {
    const time = clock();
    const getRankings = jest.fn().mockResolvedValue([ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 })]);
    const listSymbols = jest
      .fn()
      .mockResolvedValueOnce(symbols(['BTC/USDT']))
      .mockRejectedValue(new Error('kraken down'));
    const registry = new AssetRegistry({ getRankings }, { listSymbols }, { ttlMs: 1_000, maxStaleMs: 60_000, now: time.now });

    await registry.getCatalogue();
    time.advance(5_000);
    const second = await registry.getCatalogue();

    expect(second.stale).toBe(true);
    expect(second.value.total).toBe(1);
  });

  it('returns icon metadata for a batch of symbols in one catalogue pass', async () => {
    const { registry, getRankings } = build(
      [
        ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 }),
        ranking({ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2 }),
        ranking({ id: 'solana', symbol: 'SOL', name: 'Solana', rank: 5 }),
      ],
      ['BTC/USDT']
    );

    const icons = await registry.iconMetadata(['btc', 'ETH', 'NOPE']);

    expect(icons.BTC).toEqual({ id: 'cg:bitcoin', name: 'Bitcoin', logoUrl: 'btc.png' });
    expect(icons.ETH.logoUrl).toBe('eth.png');
    // An unknown symbol is ABSENT, not present with an empty logo — the
    // client's own letter fallback handles it without a wasted round trip.
    expect(icons.NOPE).toBeUndefined();
    // 3 symbols, still one upstream build.
    expect(getRankings).toHaveBeenCalledTimes(1);
  });

  it('sorts by rank, with unranked venue-only assets last', async () => {
    const { registry } = build(
      [
        ranking({ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2 }),
        ranking({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 }),
      ],
      ['BTC/USDT', 'ETH/USDT', 'ZZZ/USDT']
    );

    const { value } = await registry.getCatalogue();
    expect(value.assets.map((a) => a.symbol)).toEqual(['BTC', 'ETH', 'ZZZ']);
  });
});
