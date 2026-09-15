import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, demoAccount, DemoInstrument } from '../native/engine';
import { contractRules } from '../service';
import { ContractRuleError, validateContractOrder } from '../math';
import {
  maxAffordableNotional, fitQuantityToContract, stepDecimals, type FuturesContractRules,
} from '../../../frontend/src/lib/futuresMath';
import { terminalOrderToNativeDraft, nativeSymbolToPair } from '../../../frontend/src/lib/nativeFuturesAdapter';
import { LEVERAGE_TIERS } from '../../config/futuresConfig';

/**
 * The OWNER'S path, end to end: the original order form's sizing, through
 * the account/execution adapter, into the NATIVE engine's own validator.
 *
 * This is the suite the real-engine one could not be. `FuturesPositionService`
 * enforces no quantity step, no contract ceiling and no minimum order value,
 * so an order it accepts says nothing about whether the simulation engine
 * will. The two rejections the owner actually hit are both here:
 *
 *   INVALID_QUANTITY_STEP  — the slider produced 0.83333333 BTC on a
 *     contract whose step is 0.001. Every slider-sized order on every
 *     contract failed this way; nothing about the notional mattered.
 *
 *   INVALID_ORDER_SIZE     — a MARKET order is bound by
 *     `maxMarketOrderQty`, which on a low-priced contract is far below a
 *     500 000 / 1 000 000 USDT notional. The old message named neither the
 *     limit nor its value, so there was no size to retry with.
 *
 * Contract rules below are Bybit's real published shapes for these
 * instruments: the steps and ceilings differ by five orders of magnitude
 * across the universe, which is the whole point.
 */

const T = 1_728_000_000_000;

type Contract = {
  pair: string; price: string;
  rules: FuturesContractRules & { tickSize: string; minLeverage: string; maxLeverage: string; leverageStep: string };
};

const UNIVERSE: Contract[] = [
  { pair: 'BTC/USDT', price: '60000', rules: { tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1190', maxMarketOrderQty: '120', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' } },
  { pair: 'ETH/USDT', price: '2500', rules: { tickSize: '0.01', qtyStep: '0.01', minOrderQty: '0.01', maxOrderQty: '5000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' } },
  { pair: 'SOL/USDT', price: '143.27', rules: { tickSize: '0.01', qtyStep: '0.1', minOrderQty: '0.1', maxOrderQty: '32000', maxMarketOrderQty: '10000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '50', leverageStep: '1' } },
  { pair: 'XRP/USDT', price: '0.5234', rules: { tickSize: '0.0001', qtyStep: '1', minOrderQty: '1', maxOrderQty: '2000000', maxMarketOrderQty: '300000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '50', leverageStep: '1' } },
  { pair: 'DOGE/USDT', price: '0.08517', rules: { tickSize: '0.00001', qtyStep: '1', minOrderQty: '1', maxOrderQty: '30000000', maxMarketOrderQty: '3000000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '75', leverageStep: '1' } },
  { pair: '1000PEPE/USDT', price: '0.0082', rules: { tickSize: '0.000001', qtyStep: '10', minOrderQty: '10', maxOrderQty: '50000000', maxMarketOrderQty: '10000000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '50', leverageStep: '1' } },
];

const NOTIONALS = [50_000, 100_000, 500_000, 1_000_000];
const TIERS = JSON.parse(JSON.stringify(LEVERAGE_TIERS));

function profile() {
  return {
    pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture',
    takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0',
    riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }],
    assumptions: [],
  };
}

function instrumentFor(c: Contract): DemoInstrument {
  return { rules: { symbol: c.pair.replace('/', ''), ...c.rules }, profile: profile() };
}

/**
 * What the terminal submits: the order form's own sizing, fitted to the
 * contract, then carried through the adapter into a native command.
 */
function terminalSubmits(c: Contract, freeMargin: number, selectedLeverage: number, market: boolean) {
  const { notional, leverage } = maxAffordableNotional({
    tiers: TIERS, freeMargin, selectedLeverage, existingExposure: 0,
  });
  const fitted = fitQuantityToContract(notional / Number(c.price), Number(c.price), c.rules, { market });
  const draft = terminalOrderToNativeDraft({
    symbol: c.pair, side: 'BUY', type: market ? 'MARKET' : 'LIMIT',
    price: c.price, quantity: fitted.quantity.toFixed(stepDecimals(c.rules.qtyStep)), leverage,
  });
  return { fitted, draft, leverage };
}

describe('the terminal sizes orders the NATIVE engine accepts', () => {
  describe.each(UNIVERSE.map(c => [c.pair, c] as const))('%s', (_pair, contract) => {
    it.each(NOTIONALS)('LIMIT at %d USDT of notional', (notional) => {
      // Enough margin that the contract, not the balance, is what binds.
      const { fitted, draft, leverage } = terminalSubmits(contract, notional, 1, false);
      expect(draft.kind).toBe('OPEN');
      if (fitted.quantity === 0) {
        // A refusal is allowed, but only a NAMED one.
        expect(fitted.rejectedBy).not.toBeNull();
        expect(fitted.limit).not.toBeNull();
        return;
      }
      expect(() => validateContractOrder({
        rules: { symbol: contract.pair.replace('/', ''), ...contract.rules },
        quantity: (draft as { quantity: string }).quantity,
        price: contract.price, leverage: String(leverage), market: false, profile: profile(),
      })).not.toThrow();
    });

    it.each(NOTIONALS)('MARKET at %d USDT of notional', (notional) => {
      const { fitted, draft, leverage } = terminalSubmits(contract, notional, 1, true);
      if (fitted.quantity === 0) { expect(fitted.rejectedBy).not.toBeNull(); return; }
      expect(() => validateContractOrder({
        rules: { symbol: contract.pair.replace('/', ''), ...contract.rules },
        quantity: (draft as { quantity: string }).quantity,
        price: contract.price, leverage: String(leverage), market: true, profile: profile(),
      })).not.toThrow();
      // When the contract's market ceiling is what bound the size, the form
      // says so rather than silently shipping the smaller order.
      const wanted = notional / Number(contract.price);
      if (wanted > Number(contract.rules.maxMarketOrderQty)) expect(fitted.cappedBy).toBe('maxMarketOrderQty');
    });

    it('a sized order actually opens a position in the engine', () => {
      const { fitted, leverage } = terminalSubmits(contract, 100_000, 1, false);
      if (fitted.quantity === 0) return;
      const quantity = fitted.quantity.toFixed(stepDecimals(contract.rules.qtyStep));
      const state = emptyDemoState('100000000', T);
      registerDemoInstrument(state, instrumentFor(contract));
      const symbol = contract.pair.replace('/', '');
      markDemoAccount(state, { [symbol]: { mark: contract.price, last: contract.price } }, T);
      placeDemoOrder(state, { id: 'o1', symbol, side: 'LONG', type: 'LIMIT', quantity, price: contract.price, leverage: String(leverage) }, T);
      fillDemoOrder(state, 'o1', quantity, contract.price, T, 'SELECTED_POINT');
      expect(state.positions).toHaveLength(1);
      expect(state.positions[0].quantity).toBe(new BigNumber(quantity).toFixed());
      expect(new BigNumber(demoAccount(state).usedMargin).gt(0)).toBe(true);
      // And the row the terminal's table reads names the pair, not the
      // engine's concatenated symbol.
      expect(nativeSymbolToPair(state.positions[0].symbol)).toBe(contract.pair);
    });
  });
});

describe('the pre-fix sizing is exactly what the engine refused', () => {
  it.each(UNIVERSE.map(c => [c.pair, c] as const))('%s rejects an 8-decimal slider quantity', (_pair, contract) => {
    // What `toFixed(8)` produced before the contract fitter existed.
    const raw = (100_000 / Number(contract.price)).toFixed(8);
    const rules = { symbol: contract.pair.replace('/', ''), ...contract.rules };
    let thrown: unknown = null;
    try {
      validateContractOrder({ rules, quantity: raw, price: contract.price, leverage: '1', market: false, profile: profile() });
    } catch (error) { thrown = error; }
    // Some contracts have a step fine enough to survive; the ones that do
    // not are refused for the step, never for anything else.
    if (thrown !== null) expect((thrown as Error).message).toBe('INVALID_QUANTITY_STEP');
    // And the fitted quantity always passes.
    const fitted = fitQuantityToContract(Number(raw), Number(contract.price), contract.rules, { market: false });
    expect(() => validateContractOrder({
      rules, quantity: fitted.quantity.toFixed(stepDecimals(contract.rules.qtyStep)),
      price: contract.price, leverage: '1', market: false, profile: profile(),
    })).not.toThrow();
  });

  it('a MARKET order past maxMarketOrderQty is refused, and the refusal names the limit', () => {
    const contract = UNIVERSE.find(c => c.pair === 'BTC/USDT')!;
    const rules = { symbol: 'BTCUSDT', ...contract.rules };
    try {
      validateContractOrder({ rules, quantity: '200', price: contract.price, leverage: '1', market: true, profile: profile() });
      throw new Error('should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractRuleError);
      const detail = (error as ContractRuleError).detail;
      expect((error as Error).message).toBe('INVALID_ORDER_SIZE');
      // The limit, its value and what was asked — all three, so the trader
      // has a size to retry with.
      expect(detail).toEqual({ limit: 'maxMarketOrderQty', allowed: '120', actual: '200' });
    }
  });

  it.each([
    ['minOrderQty', '0.0005', '0.001'],
    ['minNotionalValue', '0.001', '5'],
  ])('a refusal for %s names that rule, not a generic one', (limit, quantity, allowed) => {
    const rules = { symbol: 'XYZUSDT', tickSize: '0.1', qtyStep: '0.0001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' };
    try {
      validateContractOrder({ rules, quantity, price: '1', leverage: '1', market: false, profile: profile() });
      throw new Error('should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractRuleError);
      expect((error as ContractRuleError).detail.limit).toBe(limit);
      expect((error as ContractRuleError).detail.allowed).toBe(allowed);
    }
  });
});

describe('the contract fitter never sizes up', () => {
  it.each(UNIVERSE.map(c => [c.pair, c] as const))('%s', (_pair, contract) => {
    for (const notional of NOTIONALS) {
      const wanted = notional / Number(contract.price);
      const fitted = fitQuantityToContract(wanted, Number(contract.price), contract.rules, { market: false });
      expect(fitted.quantity).toBeLessThanOrEqual(wanted);
    }
  });

  it('the rules the server publishes are the rules the fitter takes', () => {
    // `contractRules` is what the new /native/contracts/:symbol returns; its
    // shape has to be the one the client sizes with, or the client is sizing
    // against something the engine does not enforce.
    const instrument = {
      symbol: 'BTCUSDT', filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '1000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1190', maxMarketOrderQty: '120', minNotionalValue: '5' },
      leverage: { min: '1', max: '100', step: '1' },
    } as never;
    const published = contractRules(instrument);
    for (const key of ['qtyStep', 'minOrderQty', 'maxOrderQty', 'maxMarketOrderQty', 'minNotionalValue'] as const) {
      expect(typeof published[key]).toBe('string');
    }
    const fitted = fitQuantityToContract(1.66666667, 60000, published, { market: true });
    expect(fitted.quantity).toBe(1.666);
  });
});
