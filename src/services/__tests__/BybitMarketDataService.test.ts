import { BybitMarketDataService, ExternalMarketDataError, pairToBybitSymbol } from '../BybitMarketDataService';

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

const INSTRUMENTS_BODY = {
  retCode: 0,
  result: {
    list: [
      { symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'Trading' },
      { symbol: 'ETHUSDT', baseCoin: 'ETH', quoteCoin: 'USDT', status: 'Trading' },
      { symbol: 'DELISTEDUSDT', baseCoin: 'DELISTED', quoteCoin: 'USDT', status: 'Closed' },
    ],
  },
};

const TICKERS_BODY = {
  retCode: 0,
  result: {
    list: [
      {
        symbol: 'BTCUSDT',
        lastPrice: '60000',
        bid1Price: '59999',
        ask1Price: '60001',
        highPrice24h: '61000',
        lowPrice24h: '59000',
        volume24h: '1234.5',
        price24hPcnt: '0.02',
      },
      // No matching instrument in INSTRUMENTS_BODY — should be skipped.
      {
        symbol: 'UNKNOWNUSDT',
        lastPrice: '1',
        bid1Price: '1',
        ask1Price: '1',
        highPrice24h: '1',
        lowPrice24h: '1',
        volume24h: '1',
        price24hPcnt: '0',
      },
    ],
  },
};

const ORDERBOOK_BODY = {
  retCode: 0,
  result: {
    s: 'BTCUSDT',
    b: [['59999', '1.5'], ['59998', '2']],
    a: [['60001', '1'], ['60002', '3']],
    ts: 1700000000000,
  },
};

describe('pairToBybitSymbol', () => {
  it('strips the slash and uppercases', () => {
    expect(pairToBybitSymbol('btc/usdt')).toBe('BTCUSDT');
  });
});

describe('BybitMarketDataService', () => {
  it('lists only Trading spot symbols, mapped to our pair format', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(INSTRUMENTS_BODY));
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    const symbols = await service.listSymbols();

    expect(symbols).toEqual([
      { pair: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
      { pair: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT' },
    ]);
  });

  it('caches the symbol list and does not refetch within the TTL', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(INSTRUMENTS_BODY));
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    await service.listSymbols();
    await service.listSymbols();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('joins tickers with known symbols and skips unresolvable ones', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(jsonResponse(url.includes('instruments-info') ? INSTRUMENTS_BODY : TICKERS_BODY))
      );
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    const tickers = await service.getTickers();

    expect(tickers).toEqual([
      {
        pair: 'BTC/USDT',
        lastPrice: '60000',
        bidPrice: '59999',
        askPrice: '60001',
        high24h: '61000',
        low24h: '59000',
        volume24h: '1234.5',
        changePercent24h: '0.02',
      },
    ]);
  });

  it('getTicker returns null for a pair with no ticker data', async () => {
    const fetchFn = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(jsonResponse(url.includes('instruments-info') ? INSTRUMENTS_BODY : TICKERS_BODY))
      );
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    expect(await service.getTicker('ETH/USDT')).toBeNull();
  });

  it('fetches the order book for a pair, converting it to our symbol format', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(ORDERBOOK_BODY));
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    const book = await service.getOrderBook('btc/usdt');

    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('symbol=BTCUSDT'));
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
      timestamp: 1700000000000,
    });
  });

  it('caches the order book per pair within the TTL', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse(ORDERBOOK_BODY));
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    await service.getOrderBook('BTC/USDT');
    await service.getOrderBook('BTC/USDT');

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws ExternalMarketDataError on a non-ok HTTP response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    await expect(service.listSymbols()).rejects.toThrow(ExternalMarketDataError);
  });

  it('throws ExternalMarketDataError when Bybit returns a business error', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ retCode: 10001, retMsg: 'bad request' }));
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    await expect(service.listSymbols()).rejects.toThrow('Bybit error: bad request');
  });

  it('throws ExternalMarketDataError when the network request fails', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const service = new BybitMarketDataService('https://api.bybit.com', fetchFn);

    await expect(service.listSymbols()).rejects.toThrow(ExternalMarketDataError);
  });
});
