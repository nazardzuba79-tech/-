import { contractFacts, fundingCountdown } from '../contractDetails';
import type { LiveQuote } from '../liveMarketTypes';

/** The reference quote as the store holds it; every figure a real number so the fallbacks below are exercised by removing them. */
function quote(overrides: Partial<LiveQuote> = {}): LiveQuote {
  return {
    id: 'linear_perpetual:BTCUSDT', pair: 'BTC/USDT', symbol: 'BTC/USDT', providerSymbol: 'BTCUSDT', provider: 'bybit',
    marketType: 'linear_perpetual', baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: 'USDT',
    lastPrice: 83831, bidPrice: 83831, askPrice: 83831.1, high24h: 87282.5, low24h: 83453.7, volume24h: 128412.5,
    quoteVolume24h: 10.93e9, changePercent24h: -3.03, indexPrice: 83860.4, markPrice: 83873.75, fundingRate: 0.0001,
    fundingIntervalMinutes: 480, openInterest: 30132.2945, openInterestValue: 2.527e9,
    providerEventAt: 0, sequence: null, receivedAt: 0, fetchedAt: 0, stale: false,
    ...overrides,
  } as LiveQuote;
}

const rules = { qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000000', maxMarketOrderQty: '100', minNotionalValue: '5' };

describe('contractFacts', () => {
  it('is all unknown without a quote, and never a zero', () => {
    const facts = contractFacts(null, null, null);
    expect(Object.values(facts).every(value => value === null)).toBe(true);
  });

  it('formats the header figures the way the header does', () => {
    const facts = contractFacts(quote(), { fundingIntervalHours: 8, maxLeverage: 100 }, null);
    expect(facts).toMatchObject({
      perpetual: true,
      indexPrice: '83,860.40',
      markPrice: '83,873.75',
      openInterest: { value: '30,132.2945', unit: 'BTC' },
      turnover24h: { value: '10,930,000,000.00', unit: 'USDT' },
      fundingRate: { value: '0.0100%', negative: false },
      settleAsset: 'USDT',
      maxLeverage: '100x',
    });
    // The real engine publishes no order limits, so none are shown.
    expect(facts.minOrderQty).toBeNull();
    expect(facts.qtyStep).toBeNull();
    expect(facts.maxOrderQty).toBeNull();
  });

  it('falls back to the notional open interest in the quote asset when no venue reported base units', () => {
    const facts = contractFacts(quote({ openInterest: null }), null, null);
    expect(facts.openInterest).toEqual({ value: '2.53B', unit: 'USDT' });
    expect(contractFacts(quote({ openInterest: null, openInterestValue: null }), null, null).openInterest).toBeNull();
  });

  it('flags negative funding and keeps four decimals', () => {
    expect(contractFacts(quote({ fundingRate: -0.000375 }), null, null).fundingRate).toEqual({ value: '-0.0375%', negative: true });
    expect(contractFacts(quote({ fundingRate: null }), null, null).fundingRate).toBeNull();
  });

  it('shows the engine limits in base units when the engine publishes them', () => {
    const facts = contractFacts(quote(), null, rules);
    expect(facts.minOrderQty).toEqual({ value: '0.001', unit: 'BTC' });
    expect(facts.qtyStep).toEqual({ value: '0.001', unit: 'BTC' });
    expect(facts.maxOrderQty).toEqual({ value: '1,000,000', unit: 'BTC' });
  });

  it('marks a dated contract as not perpetual and the settlement asset falls back to the quote asset', () => {
    const facts = contractFacts(quote({ marketType: 'linear_futures', settleAsset: null }), { fundingIntervalHours: 8, maxLeverage: 0 }, null);
    expect(facts.perpetual).toBe(false);
    expect(facts.settleAsset).toBe('USDT');
    expect(facts.maxLeverage).toBeNull();
  });
});

describe('fundingCountdown', () => {
  it('counts to the next UTC multiple of the interval', () => {
    expect(fundingCountdown(8, Date.UTC(2026, 8, 24, 2, 41, 42))).toBe('05:18:18');
    expect(fundingCountdown(8, Date.UTC(2026, 8, 24, 15, 59, 59))).toBe('00:00:01');
    expect(fundingCountdown(1, Date.UTC(2026, 8, 24, 7, 0, 0))).toBe('01:00:00');
  });

  it('is unknown without a positive interval', () => {
    expect(fundingCountdown(null, Date.now())).toBeNull();
    expect(fundingCountdown(0, Date.now())).toBeNull();
    expect(fundingCountdown(Number.NaN, Date.now())).toBeNull();
  });
});
