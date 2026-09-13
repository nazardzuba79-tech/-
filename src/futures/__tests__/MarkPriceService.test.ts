import BigNumber from 'bignumber.js';
import { MarkPriceService } from '../MarkPriceService';

function makeMarketData(lastPrice: string | null) {
  return {
    getTicker: jest.fn().mockResolvedValue(lastPrice ? { lastPrice } : null),
  } as any;
}

describe('MarkPriceService', () => {
  it('uses the single-pair best bid/ask midpoint instead of the full ticker universe', async () => {
    const marketData = {
      getOrderBook: jest.fn().mockResolvedValue({
        bids: [{ price: '49990', quantity: '1' }],
        asks: [{ price: '50010', quantity: '1' }],
      }),
      getTicker: jest.fn().mockResolvedValue({ lastPrice: '12345' }),
    } as any;
    const svc = new MarkPriceService(marketData);

    const index = await svc.getIndexPrice('BTC/USDT');
    expect(index!.toNumber()).toBe(50000);
    expect(marketData.getOrderBook).toHaveBeenCalledWith('BTC/USDT', 1);
    expect(marketData.getTicker).not.toHaveBeenCalled();
  });

  it('defaults mark price to the index price when the contract has never traded', async () => {
    const svc = new MarkPriceService(makeMarketData('50000'));
    const mark = await svc.getMarkPrice('BTC/USDT');
    expect(mark!.toNumber()).toBe(50000);
  });

  it('returns null when the index price is unavailable', async () => {
    const svc = new MarkPriceService(makeMarketData(null));
    const mark = await svc.getMarkPrice('BTC/USDT');
    expect(mark).toBeNull();
  });

  it('shifts mark price by a smoothed basis once the futures book has traded', async () => {
    const svc = new MarkPriceService(makeMarketData('50000'));
    await svc.getIndexPrice('BTC/USDT');
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(50500));

    const mark = await svc.getMarkPrice('BTC/USDT');
    expect(mark!.toNumber()).toBeCloseTo(50500, 6);
  });

  it('smooths across multiple trades rather than jumping to the latest one', async () => {
    const svc = new MarkPriceService(makeMarketData('50000'));
    await svc.getIndexPrice('BTC/USDT');
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(50500));
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(50500));
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(60000));

    const mark = await svc.getMarkPrice('BTC/USDT');
    expect(mark!.toNumber()).toBeCloseTo(52400, 2);
    expect(mark!.isLessThan(55000)).toBe(true);
  });

  it('returns null instead of throwing when the upstream market-data call fails', async () => {
    const marketData = { getTicker: jest.fn().mockRejectedValue(new Error('Kraken responded with HTTP 403')) } as any;
    const svc = new MarkPriceService(marketData);

    await expect(svc.getIndexPrice('BTC/USDT')).resolves.toBeNull();
    await expect(svc.getMarkPrice('BTC/USDT')).resolves.toBeNull();
  });

  it('keeps separate basis state per symbol', async () => {
    const marketData = {
      getTicker: jest.fn((symbol: string) =>
        Promise.resolve({ lastPrice: symbol === 'BTC/USDT' ? '50000' : '3000' })
      ),
    } as any;
    const svc = new MarkPriceService(marketData);
    await svc.getIndexPrice('BTC/USDT');
    await svc.getIndexPrice('ETH/USDT');
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(50100));

    const btcMark = await svc.getMarkPrice('BTC/USDT');
    const ethMark = await svc.getMarkPrice('ETH/USDT');
    expect(btcMark!.toNumber()).toBeCloseTo(50100, 6);
    expect(ethMark!.toNumber()).toBeCloseTo(3000, 6);
  });
});
