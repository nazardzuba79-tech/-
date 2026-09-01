import { CoinGeckoService, ExternalRankingError } from '../CoinGeckoService';

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const MARKETS_BODY = [
  { symbol: 'btc', name: 'Bitcoin', image: 'btc.png', market_cap_rank: 1 },
  { symbol: 'eth', name: 'Ethereum', image: 'eth.png', market_cap_rank: 2 },
  { symbol: 'usdt', name: 'Tether', image: 'usdt.png', market_cap_rank: 3 },
];

describe('CoinGeckoService', () => {
  it('returns rankings sorted ascending by market cap rank', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(MARKETS_BODY));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    expect(rankings.map((r) => r.symbol)).toEqual(['BTC', 'ETH', 'USDT']);
    expect(rankings[0]).toMatchObject({ symbol: 'BTC', rank: 1, name: 'Bitcoin', image: 'btc.png' });
  });

  it('sends the API key header on every request when configured', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(MARKETS_BODY));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn, 'test-demo-key');

    await service.getRankings();

    expect(fetchFn.mock.calls[0][1]).toMatchObject({ headers: { 'x-cg-demo-api-key': 'test-demo-key' } });
  });

  it('omits the API key header when none is configured', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(MARKETS_BODY));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await service.getRankings();

    expect(fetchFn.mock.calls[0][1]).toMatchObject({ headers: undefined });
  });

  it('tags coins with categories from the per-category endpoints', async () => {
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('category=stablecoins')) {
        return Promise.resolve(jsonResponse([{ symbol: 'usdt', name: 'Tether', image: 'usdt.png', market_cap_rank: 3 }]));
      }
      if (url.includes('category=')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(MARKETS_BODY));
    });
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    const usdt = rankings.find((r) => r.symbol === 'USDT');
    expect(usdt?.categories).toEqual(['STABLECOIN']);
    // BTC isn't returned by any category endpoint in this mock, but it's
    // still tagged LAYER_1 via the local fallback merged in afterwards.
    const btc = rankings.find((r) => r.symbol === 'BTC');
    expect(btc?.categories).toEqual(['LAYER_1']);
  });

  it('falls back to the local category mapping when every category endpoint fails', async () => {
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('category=')) return Promise.reject(new Error('rate limited'));
      return Promise.resolve(jsonResponse(MARKETS_BODY));
    });
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    expect(rankings.find((r) => r.symbol === 'BTC')?.categories).toEqual(['LAYER_1']);
    expect(rankings.find((r) => r.symbol === 'ETH')?.categories).toEqual(['LAYER_1']);
    expect(rankings.find((r) => r.symbol === 'USDT')?.categories).toEqual(['STABLECOIN']);
  });

  it('leaves a coin uncategorized when it has no API-derived or local-fallback category', async () => {
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('category=')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(
        jsonResponse([{ symbol: 'zzz', name: 'Not A Real Coin', image: 'zzz.png', market_cap_rank: 4 }])
      );
    });
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    expect(rankings.find((r) => r.symbol === 'ZZZ')?.categories).toEqual([]);
  });

  it('merges API-derived categories with the local fallback without duplicating', async () => {
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('category=layer-1')) {
        return Promise.resolve(jsonResponse([{ symbol: 'btc', name: 'Bitcoin', image: 'btc.png', market_cap_rank: 1 }]));
      }
      if (url.includes('category=')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(MARKETS_BODY));
    });
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    // Both the API call and the local fallback say BTC is LAYER_1 — should
    // collapse to a single entry, not ['LAYER_1', 'LAYER_1'].
    expect(rankings.find((r) => r.symbol === 'BTC')?.categories).toEqual(['LAYER_1']);
  });

  it('keeps the ranking list even when one category endpoint fails', async () => {
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('category=meme-token')) return Promise.reject(new Error('boom'));
      if (url.includes('category=')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(MARKETS_BODY));
    });
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    expect(rankings).toHaveLength(3);
  });

  it('deduplicates coins that share a ticker, keeping the higher-ranked one', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse([
        { symbol: 'btc', name: 'Bitcoin', image: 'btc.png', market_cap_rank: 1 },
        { symbol: 'btc', name: 'Some Other BTC', image: 'other.png', market_cap_rank: 150 },
      ])
    );
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    expect(rankings).toHaveLength(1);
    expect(rankings[0].name).toBe('Bitcoin');
  });

  it('caches rankings and does not refetch within the TTL', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(MARKETS_BODY));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await service.getRankings();
    const callsAfterFirst = fetchFn.mock.calls.length;
    await service.getRankings();

    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);
  });

  it('throws ExternalRankingError on a non-OK response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 429));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await expect(service.getRankings()).rejects.toThrow(ExternalRankingError);
  });

  it('throws ExternalRankingError when the network request itself fails', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('DNS failure'));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await expect(service.getRankings()).rejects.toThrow('Failed to reach CoinGecko');
  });

  it('serves the last successful snapshot instead of throwing when a refresh fails after the cache expires', async () => {
    jest.useFakeTimers();
    try {
      const fetchFn = jest.fn().mockResolvedValueOnce(jsonResponse(MARKETS_BODY)).mockRejectedValue(new Error('rate limited'));
      const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

      const first = await service.getRankings();
      expect(first.map((r) => r.symbol)).toEqual(['BTC', 'ETH', 'USDT']);

      // Past RANKINGS_TTL_MS (1 hour) — the next call refetches, which
      // this mock now fails.
      jest.advanceTimersByTime(60 * 60_000 + 1000);

      const second = await service.getRankings();
      expect(second).toEqual(first);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still throws on a refresh failure when there is no prior successful snapshot to fall back to', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('rate limited'));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await expect(service.getRankings()).rejects.toThrow(ExternalRankingError);
  });

  it('carries the real market-wide price/24h change/volume/market cap/sparkline through from the same markets call', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse([
        {
          symbol: 'btc',
          name: 'Bitcoin',
          image: 'btc.png',
          market_cap_rank: 1,
          current_price: 65000.5,
          price_change_percentage_24h: -2.34,
          total_volume: 31_700_000_000,
          market_cap: 1_500_000_000_000,
          sparkline_in_7d: { price: [64000, 64500, 65000.5] },
        },
      ])
    );
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    expect(rankings[0]).toMatchObject({
      price: 65000.5,
      changePercent24h: -2.34,
      volume24h: 31_700_000_000,
      marketCap: 1_500_000_000_000,
      sparkline: [64000, 64500, 65000.5],
    });
    // sparkline=true, not sparkline=false, is what actually asked CoinGecko
    // for that history — otherwise sparkline_in_7d never comes back at all.
    expect(fetchFn.mock.calls[0][0]).toContain('sparkline=true');
  });

  it('falls back to safe defaults when CoinGecko omits a market-wide field', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse([{ symbol: 'zzz', name: 'Thin Coin', image: 'zzz.png', market_cap_rank: 199 }])
    );
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const rankings = await service.getRankings();

    expect(rankings[0]).toMatchObject({ price: 0, changePercent24h: null, volume24h: 0, marketCap: null, sparkline: [] });
  });
});

describe('CoinGeckoService.getGlobalMarket', () => {
  const GLOBAL_BODY = {
    data: {
      total_volume: { usd: 76_360_000_000, btc: 1_200_000 },
      total_market_cap: { usd: 2_410_000_000_000 },
      market_cap_percentage: { btc: 57.4, eth: 12.1 },
      market_cap_change_percentage_24h_usd: 1.83,
    },
  };

  it('returns the market-wide USD totals, dominance and 24h cap change', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(GLOBAL_BODY));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    const data = await service.getGlobalMarket();

    expect(data).toEqual({
      totalVolume24hUsd: 76_360_000_000,
      totalMarketCapUsd: 2_410_000_000_000,
      btcDominancePercent: 57.4,
      marketCapChangePercent24h: 1.83,
    });
    expect(fetchFn.mock.calls[0][0]).toBe('https://mock-coingecko/global');
  });

  it('caches within the TTL instead of refetching on every request', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(GLOBAL_BODY));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await service.getGlobalMarket();
    await service.getGlobalMarket();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serves the last good snapshot when a later refresh fails', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(GLOBAL_BODY))
      .mockResolvedValue(jsonResponse({}, false, 429));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await service.getGlobalMarket();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60_000);
    const data = await service.getGlobalMarket();

    expect(data.totalVolume24hUsd).toBe(76_360_000_000);
    jest.restoreAllMocks();
  });

  it('throws when the very first call fails, with nothing cached to serve', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 429));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await expect(service.getGlobalMarket()).rejects.toBeInstanceOf(ExternalRankingError);
  });

  it('rejects a response with no usable USD totals rather than reporting NaN', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ data: { total_volume: {} } }));
    const service = new CoinGeckoService('https://mock-coingecko', fetchFn);

    await expect(service.getGlobalMarket()).rejects.toBeInstanceOf(ExternalRankingError);
  });
});
