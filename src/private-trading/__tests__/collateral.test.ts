import { valueCollateral, type CollateralHolding, type CollateralPrice } from '../native/collateral';

/**
 * The rule under test is a single sentence: an unavailable price is not a
 * price of zero.
 *
 * Every other assertion here exists to stop that rule being defeated by a
 * convenience — a missing map entry, a zero quote, a stale timestamp, a
 * float that loses the last cents of a large wallet.
 */

const hold = (asset: string, available: string, locked?: string): CollateralHolding => ({ asset, available, ...(locked === undefined ? {} : { locked }) });
const at = (asset: string, price: string | null, asOf: number | null = 1_700_000_000_000): CollateralPrice => ({ asset, price, source: 'bybit', asOf });

describe('multi-asset cross collateral valuation', () => {
  it('values the settle asset at itself, with no quote and no chance of being unpriced', () => {
    const v = valueCollateral([hold('USDT', '58454972.52')], []);
    expect(v.priced).toBe('58454972.52');
    expect(v.complete).toBe(true);
    expect(v.unpriced).toEqual([]);
    expect(v.lines[0]).toMatchObject({ status: 'SETTLE', price: '1', value: '58454972.52' });
  });

  it('counts locked collateral: it backs the account, it is not gone', () => {
    const v = valueCollateral([hold('USDT', '400', '100')], []);
    expect(v.priced).toBe('500');
  });

  it('adds every priced asset at its own quote', () => {
    const v = valueCollateral(
      [hold('USDT', '1000'), hold('BTC', '2'), hold('ETH', '10')],
      [at('BTC', '104000.5'), at('ETH', '3200.25')],
    );
    // 1000 + 208001 + 32002.5
    expect(v.priced).toBe('241003.5');
    expect(v.complete).toBe(true);
  });

  it('NEVER values an unpriced holding at zero — it names it and leaves the total incomplete', () => {
    const v = valueCollateral(
      [hold('USDT', '1000'), hold('BTC', '2'), hold('XYZ', '5000')],
      [at('BTC', '100000')],
    );
    expect(v.unpriced).toEqual(['XYZ']);
    expect(v.complete).toBe(false);
    // The known part is still known, and the unknown part is still unknown.
    expect(v.priced).toBe('201000');
    const line = v.lines.find((l) => l.asset === 'XYZ')!;
    expect(line.status).toBe('UNPRICED');
    expect(line.price).toBeNull();
    expect(line.value).toBeNull();
  });

  it('treats an explicit null price, a missing entry and a zero quote identically', () => {
    const holdings = [hold('BTC', '1')];
    const explicit = valueCollateral(holdings, [at('BTC', null)]);
    const missing = valueCollateral(holdings, []);
    const zero = valueCollateral(holdings, [at('BTC', '0')]);
    const negative = valueCollateral(holdings, [at('BTC', '-5')]);
    for (const v of [explicit, missing, zero, negative]) {
      expect(v.unpriced).toEqual(['BTC']);
      expect(v.complete).toBe(false);
      expect(v.priced).toBe('0');
      expect(v.lines[0].value).toBeNull();
    }
  });

  it('holding none of an unpriced asset is not an unknown', () => {
    const v = valueCollateral([hold('USDT', '100'), hold('XYZ', '0')], []);
    expect(v.unpriced).toEqual([]);
    expect(v.complete).toBe(true);
    expect(v.priced).toBe('100');
  });

  it('reports the STALEST input as the valuation time', () => {
    const v = valueCollateral(
      [hold('BTC', '1'), hold('ETH', '1'), hold('SOL', '1')],
      [at('BTC', '100000', 5_000), at('ETH', '3000', 1_000), at('SOL', '200', 9_000)],
    );
    expect(v.asOf).toBe(1_000);
  });

  it('is exact on a wallet large enough to lose cents in floating point', () => {
    // 3 731 245.678901 BTC-priced value plus a settle row whose last digits
    // a double would drop. The sum is asserted to the last decimal.
    const v = valueCollateral(
      [hold('USDT', '58454972.529999999999'), hold('BTC', '0.000000000001')],
      [at('BTC', '104000.5')],
    );
    // 58454972.529999999999 + 0.000000000001 x 104000.5
    expect(v.priced).toBe('58454972.5300001039995');
    // The same sum in doubles loses the tail entirely.
    expect(String(58454972.529999999999 + 0.000000000001 * 104000.5)).not.toBe(v.priced);
  });

  it('refuses a negative quantity rather than netting it against the wallet', () => {
    expect(() => valueCollateral([hold('BTC', '-1')], [at('BTC', '100000')])).toThrow('INVALID_COLLATERAL_QUANTITY');
    expect(() => valueCollateral([hold('BTC', '1', '-1')], [at('BTC', '100000')])).toThrow('INVALID_COLLATERAL_QUANTITY');
  });

  it('refuses a quantity that is not a decimal string rather than coercing it', () => {
    expect(() => valueCollateral([{ asset: 'BTC', available: '1e5' }], [at('BTC', '1')])).toThrow(/INVALID_COLLATERAL_QUANTITY/);
    expect(() => valueCollateral([{ asset: 'BTC', available: 'NaN' }], [at('BTC', '1')])).toThrow(/INVALID_COLLATERAL_QUANTITY/);
  });

  it('keeps one line per holding, in the order given, so the wallet is auditable', () => {
    const v = valueCollateral([hold('USDT', '1'), hold('BTC', '1'), hold('XYZ', '1')], [at('BTC', '2')]);
    expect(v.lines.map((l) => l.asset)).toEqual(['USDT', 'BTC', 'XYZ']);
    expect(v.lines.map((l) => l.status)).toEqual(['SETTLE', 'PRICED', 'UNPRICED']);
  });

  it('an empty wallet is a complete valuation of zero, not an unknown', () => {
    const v = valueCollateral([], []);
    expect(v).toMatchObject({ priced: '0', complete: true, unpriced: [], asOf: null });
  });
});
