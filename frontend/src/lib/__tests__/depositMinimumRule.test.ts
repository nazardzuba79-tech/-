import { DEPOSIT_USD_PEGGED_ASSETS, MIN_DEPOSIT_USD } from '../../../../src/config/limits';
import { DEPOSIT_MINIMUM_USD, DEPOSIT_USD_PEGGED, depositMinimumView } from '../depositMinimum';

/**
 * The deposit window states the minimum itself (the Cloudflare catalogue
 * carries addresses only). It must state the rule the server enforces —
 * not a copy that drifts — and never invent an amount in the asset.
 */
describe('deposit minimum shown in the deposit window', () => {
  it('is the rule the server enforces', () => {
    expect(DEPOSIT_MINIMUM_USD).toBe(MIN_DEPOSIT_USD);
    expect([...DEPOSIT_USD_PEGGED]).toEqual([...DEPOSIT_USD_PEGGED_ASSETS]);
  });

  // The server's peg policy also covers USD and DAI when they are not listed
  // in the current catalogue; catalogue membership does not determine a peg.
  it.each(['USDT', 'USDC', 'USD', 'DAI'])('counts %s one to one, as the server counts it', asset => {
    expect(depositMinimumView(asset)).toEqual({ usd: 300, equivalent: 300, pegged: true });
  });

  it.each(['BTC', 'ETH', 'BNB', 'SOL', 'POL', 'TON'])('states only the USD minimum for catalogue asset %s', asset => {
    expect(depositMinimumView(asset)).toEqual({ usd: 300, equivalent: null, pegged: false });
  });

  it('states only the USD minimum for an unknown asset', () => {
    expect(depositMinimumView('UNKNOWN')).toEqual({ usd: 300, equivalent: null, pegged: false });
  });
});
