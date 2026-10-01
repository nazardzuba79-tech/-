import { DEPOSIT_PRICE_MAX_AGE_MS as SERVER_PRICE_AGE, DEPOSIT_USD_PEGGED_ASSETS, MIN_DEPOSIT_USD } from '../../../../src/config/limits';
import { DEPOSIT_MINIMUM_USD, DEPOSIT_PRICE_MAX_AGE_MS, DEPOSIT_USD_PEGGED, depositMinimumView } from '../depositMinimum';

/**
 * The deposit window states the minimum itself (the Cloudflare catalogue
 * carries addresses only). It must state the rule the server enforces —
 * not a copy that drifts — and never show an amount in the asset that a
 * live, current price does not back.
 */
const NONE = { estimate: null, estimateExpiresAt: null };

describe('deposit minimum shown in the deposit window', () => {
  it('is the rule the server enforces', () => {
    expect(MIN_DEPOSIT_USD).toBe(500);
    expect(DEPOSIT_MINIMUM_USD).toBe(MIN_DEPOSIT_USD);
    expect([...DEPOSIT_USD_PEGGED]).toEqual([...DEPOSIT_USD_PEGGED_ASSETS]);
    expect(DEPOSIT_PRICE_MAX_AGE_MS).toBe(SERVER_PRICE_AGE);
  });

  // The server's peg policy also covers USD and DAI when they are not listed
  // in the current catalogue; catalogue membership does not determine a peg.
  it.each(['USDT', 'USDC', 'USD', 'DAI'])('counts %s one to one, as the server counts it, whatever a quote says', asset => {
    expect(depositMinimumView(asset)).toEqual({ usd: 500, equivalent: 500, pegged: true, ...NONE });
    expect(depositMinimumView(asset, { price: '0.5', fetchedAt: 1_000, stale: false }, 1_000)).toEqual({ usd: 500, equivalent: 500, pegged: true, ...NONE });
  });

  it.each(['BTC', 'ETH', 'BNB', 'SOL', 'POL', 'TON', 'UNKNOWN'])('states only the rule for %s without a price', asset => {
    expect(depositMinimumView(asset)).toEqual({ usd: 500, equivalent: null, pegged: false, ...NONE });
  });

  it('estimates a non-pegged asset from a live price, and says when that stops being current', () => {
    const now = 1_000_000_000;
    expect(depositMinimumView('BTC', { price: '100000', fetchedAt: now - 30_000, stale: false }, now))
      .toEqual({ usd: 500, equivalent: null, pegged: false, estimate: 0.005, estimateExpiresAt: now - 30_000 + DEPOSIT_PRICE_MAX_AGE_MS });
    expect(depositMinimumView('ETH', { price: 2500, fetchedAt: now, stale: false }, now).estimate).toBe(0.2);
  });

  it('never estimates from a warm-cache or stale-served, aged, future-dated or unusable price', () => {
    const now = 1_000_000_000;
    for (const quote of [
      { price: '100000', fetchedAt: now, stale: true },
      { price: '100000', fetchedAt: now - DEPOSIT_PRICE_MAX_AGE_MS, stale: false },
      { price: '100000', fetchedAt: now - DEPOSIT_PRICE_MAX_AGE_MS - 1, stale: false },
      { price: '100000', fetchedAt: now + 1, stale: false },
      { price: '100000', fetchedAt: Number.NaN, stale: false },
      { price: '0', fetchedAt: now, stale: false }, { price: '-5', fetchedAt: now, stale: false },
      { price: 'abc', fetchedAt: now, stale: false }, { price: undefined, fetchedAt: now, stale: false },
    ]) expect(depositMinimumView('BTC', quote, now)).toEqual({ usd: 500, equivalent: null, pegged: false, ...NONE });
  });
});
