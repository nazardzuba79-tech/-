import { DEPOSIT_PRICE_MAX_AGE_MS as SERVER_PRICE_AGE, DEPOSIT_USD_PEGGED_ASSETS, MIN_DEPOSIT_USD } from '../../../../src/config/limits';
import { DEPOSIT_MINIMUM_USD, DEPOSIT_PRICE_MAX_AGE_MS, DEPOSIT_USD_PEGGED, depositMinimumView } from '../depositMinimum';

/**
 * The deposit window states the minimum itself (the Cloudflare catalogue
 * carries addresses only). It must state the rule the server enforces —
 * not a copy that drifts — and never invent an amount in the asset.
 */
describe('deposit minimum shown in the deposit window', () => {
  it('is the rule the server enforces', () => {
    expect(DEPOSIT_MINIMUM_USD).toBe(MIN_DEPOSIT_USD);
    expect([...DEPOSIT_USD_PEGGED]).toEqual([...DEPOSIT_USD_PEGGED_ASSETS]);
    expect(DEPOSIT_PRICE_MAX_AGE_MS).toBe(SERVER_PRICE_AGE);
  });

  it('a USD-pegged asset counts one to one, as the server counts it', () => {
    for (const asset of ['USDT', 'USDC']) expect(depositMinimumView(asset, null)).toEqual({ usd: 300, equivalent: 300, pegged: true });
  });

  it('any other asset converts only from a fresh, positive price', () => {
    const now = 1_000_000_000;
    expect(depositMinimumView('BTC', { price: '100000', fetchedAt: now - 30_000 }, now)).toEqual({ usd: 300, equivalent: 0.003, pegged: false });
    expect(depositMinimumView('ETH', { price: 2500, fetchedAt: now }, now).equivalent).toBe(0.12);
    // Too old, from the future, missing, zero, negative or not a number: the USD rule alone.
    for (const quote of [
      { price: '100000', fetchedAt: now - DEPOSIT_PRICE_MAX_AGE_MS - 1 },
      { price: '100000', fetchedAt: now + 1 },
      { price: '0', fetchedAt: now }, { price: '-5', fetchedAt: now }, { price: 'abc', fetchedAt: now },
      { price: undefined, fetchedAt: now }, { price: '100000', fetchedAt: Number.NaN },
    ]) expect(depositMinimumView('BTC', quote, now)).toEqual({ usd: 300, equivalent: null, pegged: false });
    expect(depositMinimumView('SOL', null, now)).toEqual({ usd: 300, equivalent: null, pegged: false });
  });
});
