import BigNumber from 'bignumber.js';
import { MarkPriceService } from '../MarkPriceService';

function makeMarketData(lastPrice: string | null) {
  return {
    getTicker: jest.fn().mockResolvedValue(lastPrice ? { lastPrice } : null),
  } as any;
}

describe('MarkPriceService', () => {
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
    await svc.getIndexPrice('BTC/USDT'); // establish the index price used by recordFuturesTrade
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(50500)); // futures trading at a premium

    const mark = await svc.getMarkPrice('BTC/USDT');
    // EMA alpha 0.2 on a first sample = the full basis (no prior EMA to blend with).
    expect(mark!.toNumber()).toBeCloseTo(50500, 6);
  });

  it('smooths across multiple trades rather than jumping to the latest one', async () => {
    const svc = new MarkPriceService(makeMarketData('50000'));
    await svc.getIndexPrice('BTC/USDT');
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(50500)); // basis 500, ema -> 500
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(50500)); // basis 500, ema -> 500
    svc.recordFuturesTrade('BTC/USDT', new BigNumber(60000)); // basis 10000 (a manipulative wick)

    const mark = await svc.getMarkPrice('BTC/USDT');
    // ema = 500*0.8 + 10000*0.2 = 400 + 2000 = 2400 -> mark = 52400, nowhere
    // near the manipulated 60000 print.
    expect(mark!.toNumber()).toBeCloseTo(52400, 2);
    expect(mark!.isLessThan(55000)).toBe(true);
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
