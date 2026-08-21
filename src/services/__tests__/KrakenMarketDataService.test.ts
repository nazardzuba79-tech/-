import { KrakenMarketDataService, ExternalMarketDataError, pairToKrakenSymbol } from '../KrakenMarketDataService';

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const ASSET_PAIRS_BODY = {
  error: [],
  result: {
    XXBTZUSDT: { altname: 'XBTUSDT', wsname: 'XBT/USDT', base: 'XXBT', quote: 'USDT' },
    XETHZUSDT: { altname: 'ETHUSDT', wsname: 'ETH/USDT', base: 'XETH', quote: 'USDT' },
    DARKPOOLD: { altname: 'DARKUSDT', base: 'XDARK', quote: 'USDT' }, // no wsname — skipped
  },
};

const TICKER_BODY = {
  error: [],
  result: {
    XBTUSDT: {
      a: ['60001', '1', '1'],
      b: ['59999', '1', '1'],
      c: ['60000', '0.5'],
      h: ['60500', '61000'],
      l: ['59500', '59000'],
      v: ['100', '1234.5'],
      o: '58800',
    },
  },
};

const DEPTH_BODY = {
  error: [],
  result: {
    XBTUSDT: {
      bids: [['59999', '1.5', 1700000000], ['59998', '2', 1700000000]],
      asks: [['60001', '1', 1700000000], ['60002', '3', 1700000000]],
    },
  },
};

const OHLC_BODY = {
  error: [],
  result: {
    XBTUSDT: [
      [1700000000, '59000', '59500', '58800', '59200', '59100', '10', 5],
      [1700000060, '59200', '59600', '59100', '59400', '59300', '12', 6],
    ],
    last: 1700000060,
  },
};

const TRADES_BODY = {
  error: [],
  result: {
    XBTUSDT: [
      ['59000', '0.1', 1700000000, 'b', 'l', ''],
      ['59100', '0.2', 1700000001, 's', 'm', ''],
    ],
    last: '1700000001000000000',
  },
};

describe('pairToKrakenSymbol', () => {
  it('strips the slash and uppercases', () => {
    expect(pairToKrakenSymbol('btc/usdt')).toBe('BTCUSDT');
  });
});

describe('KrakenMarketDataService', () => {
  it('lists symbols from AssetPairs, normalizing XBT to BTC and skipping dark pool entries', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(ASSET_PAIRS_BODY));
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    const symbols = await service.listSymbols();

    expect(symbols).toEqual([
      { pair: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
      { pair: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT' },
    ]);
  });

  it('caches the symbol list and does not refetch within the TTL', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(ASSET_PAIRS_BODY));
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    await service.listSymbols();
    await service.listSymbols();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fetches tickers keyed by altname and computes 24h change from open price', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(jsonResponse(url.includes('AssetPairs') ? ASSET_PAIRS_BODY : TICKER_BODY))
      );
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    const ticker = await service.getTicker('BTC/USDT');

    expect(ticker).toEqual({
      pair: 'BTC/USDT',
      lastPrice: '60000',
      bidPrice: '59999',
      askPrice: '60001',
      high24h: '61000',
      low24h: '59000',
      volume24h: '1234.5',
      changePercent24h: '2.0408',
    });
  });

  it('fetches the order book for a pair, converting it to our symbol format', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(jsonResponse(url.includes('AssetPairs') ? ASSET_PAIRS_BODY : DEPTH_BODY))
      );
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    const book = await service.getOrderBook('btc/usdt');

    expect(book).toEqual({
      pair: 'BTC/USDT',
      bids: [
        { price: '59999', quantity: '1.5' },
        { price: '59998', quantity: '2' },
      ],
      asks: [
        { price: '60001', quantity: '1' },
        { price: '60002', quantity: '3' },
      ],
      timestamp: expect.any(Number),
    });
  });

  it('fetches candles oldest-first without needing to reverse', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(jsonResponse(url.includes('AssetPairs') ? ASSET_PAIRS_BODY : OHLC_BODY))
      );
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    const candles = await service.getCandles('BTC/USDT', '1m', 300);

    expect(candles).toEqual([
      { time: 1700000000, open: 59000, high: 59500, low: 58800, close: 59200, volume: 10 },
      { time: 1700000060, open: 59200, high: 59600, low: 59100, close: 59400, volume: 12 },
    ]);
  });

  it('rejects an unsupported interval', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(ASSET_PAIRS_BODY));
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    await expect(service.getCandles('BTC/USDT', '2m', 300)).rejects.toThrow('Unsupported interval');
  });

  it('fetches recent trades newest-first', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(jsonResponse(url.includes('AssetPairs') ? ASSET_PAIRS_BODY : TRADES_BODY))
      );
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    const trades = await service.getRecentTrades('BTC/USDT', 60);

    expect(trades).toEqual([
      { id: expect.any(String), price: '59100', quantity: '0.2', side: 'SELL', time: 1700000001000 },
      { id: expect.any(String), price: '59000', quantity: '0.1', side: 'BUY', time: 1700000000000 },
    ]);
  });

  it('throws ExternalMarketDataError for an unknown pair', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(ASSET_PAIRS_BODY));
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    await expect(service.getOrderBook('NOPE/USDT')).rejects.toThrow(ExternalMarketDataError);
  });

  it('throws ExternalMarketDataError on a non-ok HTTP response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    await expect(service.listSymbols()).rejects.toThrow(ExternalMarketDataError);
  });

  it('throws ExternalMarketDataError when Kraken returns a business error', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ error: ['EQuery:Unknown asset pair'], result: {} }));
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    await expect(service.listSymbols()).rejects.toThrow('Kraken error: EQuery:Unknown asset pair');
  });

  it('throws ExternalMarketDataError when the network request fails', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const service = new KrakenMarketDataService('https://api.kraken.com', fetchFn);

    await expect(service.listSymbols()).rejects.toThrow(ExternalMarketDataError);
  });
});
