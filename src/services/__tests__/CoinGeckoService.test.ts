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
    const btc = rankings.find((r) => r.symbol === 'BTC');
    expect(btc?.categories).toEqual([]);
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
});
