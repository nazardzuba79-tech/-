import fs from 'fs';
import path from 'path';
import BigNumber from 'bignumber.js';
import { computeDca, computeFees, computeLiquidation, computePnl, computePositionSize, computeRiskReward,
  formatDecimal, normalizeLevels, parseDecimal, type PnlInput, type PositionInput, type RiskRewardInput, type DcaInput, type FeesInput, type LiquidationInput } from '../index';
import { Decimal } from '../decimal';

const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, 'oracle.json'), 'utf8'));
const calculators: Record<string, (input: any) => any> = { pnl: computePnl, position: computePositionSize, liquidation: computeLiquidation, riskReward: computeRiskReward, dca: computeDca, fees: computeFees };
const pnl: PnlInput = { market: 'futures', side: 'long', quantityMode: 'quantity', entry: '60000', exit: '66000', quantity: '0.1', margin: '', leverage: '10', feeEntry: '0.05', feeExit: '0.05', slipEntry: '0', slipExit: '0', funding: '0', fixedCosts: '0' };
const position: PositionInput = { side: 'long', capital: '10000', riskPercent: '1', entry: '100', stop: '95', leverage: '5', feeEntry: '0.1', feeStop: '0.1', slipEntry: '0', slipStop: '0', fixedCosts: '0', budget: '', step: '' };
const liquidation: LiquidationInput = { side: 'long', entry: '100', quantity: '10', leverage: '10', maintenanceRate: '0.5', additionalMargin: '0', costs: '0' };
const rr: RiskRewardInput = { side: 'long', entry: '100', stop: '95', target: '110', quantity: '1', feeEntry: '0.1', feeStop: '0.1', feeTarget: '0.1', slipEntry: '0', slipStop: '0', slipTarget: '0', fixedCosts: '0' };
const dca: DcaInput = { rows: [{ mode: 'quantity', price: '10000', quantity: '1', amount: '', fee: '0' }, { mode: 'quantity', price: '20000', quantity: '2', amount: '', fee: '0' }] };
const fees: FeesInput = { market: 'futures', side: 'long', inputMode: 'notional', quantity: '', entry: '', exit: '', notionalEntry: '6000', notionalExit: '6600', includeExit: true, entryRole: 'maker', exitRole: 'taker', makerRate: '0.02', takerRate: '0.055' };

function ready<T>(result: { ok: true; value: T } | { ok: false; errors: any }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}
function equalExpected(actual: any, expected: any): void {
  if (expected === null) { expect(actual).toBeNull(); return; }
  if (typeof expected === 'object') {
    for (const key of Object.keys(expected)) equalExpected(actual[key], expected[key]);
    return;
  }
  const target = new Decimal(expected); const observed = new Decimal(actual);
  expect(observed.isFinite()).toBe(true);
  // Python uses 110 significant digits; the app uses 160 decimal places.
  // A later ratio can terminate after an intermediate repeating division, so
  // compare all oracle answers at relative 1e-80 precision. Zero stays exact.
  // Exact input cost/fee conservation has separate equality regressions below.
  if (target.isZero()) expect(observed.isZero()).toBe(true);
  else expect(observed.minus(target).abs().lte(target.abs().times('1e-80'))).toBe(true);
}

describe('independent Python Decimal golden vectors', () => {
  const cases: [string, any][] = oracle.cases.map((fixture: any) => [fixture.name, fixture]);
  test.each(cases)('%s', (_name, fixture) => {
    const result = calculators[fixture.mode](fixture.input);
    expect(result.ok).toBe(true);
    equalExpected(result.value, fixture.expected);
  });
});

describe('decimal parser and display', () => {
  test.each(['', '-', '+', '.', ','])('input %j remains incomplete', (input) => expect(parseDecimal(input)).toMatchObject({ ok: false, status: 'incomplete' }));
  test.each(['NaN', 'Infinity', '-Infinity', '1e3', '0x12', '1,234.56', '1.234,56', '1 23', '12 34 567', '--1', '1.2.3', '1,2,3', '1\t000', '9'.repeat(31), '0.' + '1'.repeat(25), ' '.repeat(100)])('rejects malformed or over-limit %j', (input) => {
    expect(parseDecimal(input)).toMatchObject({ ok: false, status: 'invalid' });
  });
  test.each([['1 234,50','1234.5'], ['1\u00a0234\u202f567.890','1234567.89'], ['.05','0.05'], ['-.05','-0.05'], ['0012,300','12.3'], ['-0','0']])('normalizes %j without binary conversion', (raw, value) => {
    expect(parseDecimal(raw)).toEqual({ ok: true, value });
  });
  test('normalizes a percentage exactly once and never changes global BigNumber configuration', () => {
    const original = BigNumber.config();
    expect(ready(computePnl(pnl)).feeOpen).toBe('3');
    expect(BigNumber.config()).toEqual(original);
    expect(Decimal.config().DECIMAL_PLACES).toBeGreaterThanOrEqual(40);
  });
  test('shows very large decimal values, small losses and actual zero honestly', () => {
    expect(formatDecimal('123456789012345678901234567890.12')).toBe('123 456 789 012 345 678 901 234 567 890,12');
    expect(formatDecimal('-0.00000000000000000001')).toBe('−<0,00000001');
    expect(formatDecimal('0.0000000123', { maxDecimals: 12 })).toBe('0,0000000123');
    expect(formatDecimal('-0')).toBe('0,00');
    expect(formatDecimal('0.0001', { minDecimals: 0, maxDecimals: 0 })).toBe('<1');
    expect(formatDecimal('Infinity')).toBe('—');
  });
  test('rejects negative input rather than sanitizing away its sign', () => {
    expect(parseDecimal('-5', { positive: true })).toMatchObject({ ok: false, status: 'invalid' });
    expect(parseDecimal('-5', { nonnegative: true })).toMatchObject({ ok: false, status: 'invalid' });
  });
  test('bounds normalized SVG coordinates without losing financial precision first', () => {
    expect(normalizeLevels(['100000000000000000000.1', '100000000000000000000.2', '100000000000000000000.3'])).toEqual(['0', '50', '100']);
    expect(normalizeLevels(['12','12'])).toEqual(['50','50']);
  });
});

describe('P&L execution and risk invariants', () => {
  test.each(['entry','exit','quantity','leverage','feeEntry','feeExit','slipEntry','slipExit','funding','fixedCosts'])('blank %s invalidates the current result instead of retaining it', (field) => {
    const result = computePnl({ ...pnl, [field]: '' });
    expect(result).toMatchObject({ ok: false, status: 'incomplete', errors: { [field]: expect.any(String) } });
    expect(result).not.toHaveProperty('value');
  });
  test.each(['feeEntry','feeExit','slipEntry','slipExit'])('validates percent bounds for %s', (field) => {
    for (const invalid of ['-0.1','100','101']) expect(computePnl({ ...pnl, [field]: invalid }).ok).toBe(false);
    expect(computePnl({ ...pnl, [field]: '0' }).ok).toBe(true);
  });
  test('Spot ignores hidden Short, leverage and funding; uses purchase-cost denominator', () => {
    const spot = ready(computePnl({ ...pnl, market: 'spot', side: 'short', leverage: '0', funding: 'Infinity' }));
    expect(spot.netPnl).toBe('593.7'); expect(spot.funding).toBe('0'); expect(spot.initialMargin).toBe('6000');
    expect(spot.purchaseCost).toBe('6003'); expect(spot.roiBasis).toBe('purchase');
    expect(new Decimal(spot.roi).minus(new Decimal('593.7').div(6003).times(100)).abs().lt('1e-100')).toBe(true);
  });
  test('only the selected quantity source participates', () => {
    expect(ready(computePnl({ ...pnl, margin: '-123' })).quantity).toBe('0.1');
    expect(ready(computePnl({ ...pnl, quantityMode: 'margin', margin: '600', quantity: 'Infinity' })).quantity).toBe('0.1');
  });
  test('adverse fees and slippage never improve money P&L at fixed quantity', () => {
    for (const side of ['long','short'] as const) {
      for (let index = 1; index <= 20; index++) {
        const input = { ...pnl, side, quantity: String(index), entry: String(100+index), exit: String(105+index), feeEntry: '0', feeExit: '0' };
        const original = ready(computePnl(input));
        for (const field of ['feeEntry','feeExit','slipEntry','slipExit']) {
          const changed = ready(computePnl({ ...input, [field]: '0.1' }));
          expect(new Decimal(changed.netPnl).lte(original.netPnl)).toBe(true);
        }
      }
    }
  });
  test('deterministic linearity, sign symmetry, leverage invariance and fixed-cost accounting', () => {
    for (let index = 1; index <= 24; index++) {
      const input = { ...pnl, entry: String(100+index), exit: String(80+index*2), quantity: String(index), feeEntry: '0', feeExit: '0' };
      const original = ready(computePnl(input));
      const doubled = ready(computePnl({ ...input, quantity: String(index*2) }));
      const short = ready(computePnl({ ...input, side: 'short' }));
      const lev = ready(computePnl({ ...input, leverage: '20' }));
      const costs = ready(computePnl({ ...input, funding: '-2', fixedCosts: '5' }));
      expect(new Decimal(doubled.netPnl).eq(new Decimal(original.netPnl).times(2))).toBe(true);
      expect(new Decimal(short.grossPnl).eq(new Decimal(original.grossPnl).negated())).toBe(true);
      expect(lev.netPnl).toBe(original.netPnl); expect(lev.feeOpen).toBe(original.feeOpen);
      expect(new Decimal(costs.netPnl).eq(new Decimal(original.netPnl).minus(3))).toBe(true);
    }
  });
  test('break-even uses the same execution equation for both directions with all expenses', () => {
    for (const side of ['long','short'] as const) {
      const input = { ...pnl, side, slipEntry: '0.1', slipExit: '0.2', funding: '-2', fixedCosts: '3' };
      const result = ready(computePnl(input));
      const q = new Decimal(result.quantity); const ef = new Decimal(result.entryExecution);
      const xf = new Decimal(result.breakEvenTarget!).times(new Decimal(1).minus(new Decimal(side==='long' ? 1 : -1).times('0.002')));
      const net = new Decimal(side==='long' ? 1 : -1).times(q).times(xf.minus(ef)).minus(q.times(ef).times('0.0005')).minus(q.times(xf).times('0.0005')).plus(2).minus(3);
      expect(net.abs().lt('1e-100')).toBe(true);
    }
  });
  test('nonpositive break-even is absent; never renders a negative market threshold', () => {
    const result = ready(computePnl({ ...pnl, side: 'short', fixedCosts: '10000' }));
    expect(result.breakEvenExecution).toBeNull(); expect(result.breakEvenTarget).toBeNull();
    expect(result.breakEvenState).toBe('no_positive_threshold');
  });
  test('maximum supported input precision does not underflow the initial margin or emit Infinity', () => {
    const result = ready(computePnl({ ...pnl, side:'short', entry:'0.000000000000000000000001',exit:'0.000000000000000000000002',quantity:'0.000000000000000000000001',leverage:'999999999999999999999999999999',slipEntry:'99.999999999999999999999999' }));
    expect(new Decimal(result.initialMargin).gt(0)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });
  test('chart points come from the same P&L model and coordinate values stay bounded', () => {
    const result = ready(computePnl(pnl));
    expect(result.chart).toHaveLength(41);
    for (const point of result.chart) {
      for (const coord of [point.x,point.y]) expect(new Decimal(coord).gte(0) && new Decimal(coord).lte(100)).toBe(true);
      const expected = new Decimal(point.price).minus(60000).times('0.1').minus(3).minus(new Decimal(point.price).times('0.00005'));
      expect(new Decimal(point.pnl).eq(expected)).toBe(true);
    }
  });
});

describe('risk size and liquidation boundaries', () => {
  test('a repeating per-unit margin never understates the actual reserved margin', () => {
    const budget = '10000000000000000000000000000';
    const value = ready(computePositionSize({ ...position, capital: '999999999999999999999999999999', riskPercent: '100', entry: '100', stop: '99', leverage: '3', feeEntry: '0', feeStop: '0', budget }));
    expect(new Decimal(value.margin).lte(budget)).toBe(true);
    expect(new Decimal(value.reserved).gte(value.margin)).toBe(true);
  });
  test.each(['0.001','0.005','1','10'])('rounds quantity down at step %s and respects both budgets', (step) => {
    for (let index=1; index<=20; index++) {
      const input = { ...position, budget:String(index*13), step };
      const value=ready(computePositionSize(input));
      expect(new Decimal(value.quantity).mod(step).isZero()).toBe(true);
      expect(new Decimal(value.plannedLoss).lte(value.riskBudget)).toBe(true);
      expect(new Decimal(value.reserved).lte(input.budget)).toBe(true);
    }
  });
  test('budget is optional; a small budget cannot silently enlarge leverage or quantity', () => {
    expect(ready(computePositionSize(position)).theoretical).toBe(true);
    const value=ready(computePositionSize({...position,budget:'1',step:'10'}));
    expect(value.state).toBe('no_size');expect(value.quantity).toBe('0');expect(value.limitingFactor).toBe('budget');
  });
  test.each([{stop:'100'},{stop:'105'},{riskPercent:'0'},{riskPercent:'101'},{fixedCosts:'100'},{budget:'10',fixedCosts:'10'},{step:'-1'}])('rejects impossible risk inputs %j', (patch) => {
    expect(computePositionSize({...position,...patch}).ok).toBe(false);
  });
  test('does not assume a maintenance rate and distinguishes insufficient collateral', () => {
    expect(computeLiquidation({...liquidation,maintenanceRate:''})).toMatchObject({ok:false,status:'incomplete'});
    expect(computeLiquidation({...liquidation,costs:'100'})).toMatchObject({ok:true,status:'insufficient_margin',value:{liquidationPrice:null}});
    expect(computeLiquidation({...liquidation,maintenanceRate:'10'})).toMatchObject({ok:true,status:'insufficient_margin',value:{liquidationPrice:null}});
  });
  test('distinguishes no positive threshold from a guarantee that liquidation cannot happen', () => {
    expect(computeLiquidation({...liquidation,leverage:'1',maintenanceRate:'0'})).toMatchObject({ok:true,status:'no_positive_threshold',value:{liquidationPrice:null}});
    const zero=ready(computeLiquidation({...liquidation,maintenanceRate:'0'}));
    expect(zero.liquidationPrice).toBe(zero.zeroMarginPrice);
  });
  test('additional margin shifts each liquidation threshold away from entry; costs shift it back', () => {
    expect(ready(computeLiquidation({...liquidation,additionalMargin:'50',costs:'25'})).liquidationPrice).toBe('88');
    expect(ready(computeLiquidation({...liquidation,side:'short',additionalMargin:'50',costs:'25'})).liquidationPrice).toBe('112');
  });
});

describe('risk/reward, DCA and fees edge cases', () => {
  test('does not show a positive coefficient when the target fails to cover costs', () => {
    expect(ready(computeRiskReward({...rr,fixedCosts:'20'}))).toMatchObject({state:'target_not_profitable',ratio:null,breakEvenWinRate:null,reward:'-10.21'});
    for (const patch of [{stop:'100'},{target:'100'},{stop:'105'},{target:'90'}]) expect(computeRiskReward({...rr,...patch}).ok).toBe(false);
  });
  test('DCA is weighted, order independent and amount input excludes the additional fee', () => {
    const value=ready(computeDca(dca));
    const reversed=ready(computeDca({...dca,rows:[...dca.rows].reverse()}));
    expect(value.averageBare).toBe(reversed.averageBare);expect(value.costBasis).toBe(reversed.costBasis);
    expect(new Decimal(value.averageBare).gte(10000) && new Decimal(value.averageBare).lte(20000)).toBe(true);
    const amount=ready(computeDca({rows:[{mode:'amount',price:'3',quantity:'garbage',amount:'1',fee:'0.1'}]}));
    expect(amount.purchaseSum).toBe('1');expect(amount.entryFees).toBe('0.001');expect(amount.costBasis).toBe('1.001');
    expect(value.exit).toBeNull();
  });
  test('DCA validates rows, capped at50, and does not ignore partially entered exit data', () => {
    expect(computeDca({rows:[]})).toMatchObject({ok:false,status:'incomplete'});
    expect(computeDca({rows:Array.from({length:51},()=>dca.rows[0])}).ok).toBe(false);
    expect(computeDca({...dca,exit:{price:'',fee:'0'}})).toMatchObject({ok:false,status:'incomplete'});
    expect(computeDca({rows:[{...dca.rows[0],quantity:'-1'}]})).toMatchObject({ok:false,status:'invalid'});
  });
  test.each([['15000','10000','ready'],['16666.666666666666666666','17000','unreachable'],['10000','10000','no_finite_quantity'],['9000','10000','unreachable'],['20000','10000','not_reduction']])('DCA target %s at purchaseprice %s yields %s', (target,price,state) => {
    expect(ready(computeDca({...dca,targetAverage:{price,fee:'0',target}})).targetAverage?.state).toBe(state);
  });
  test('DCA already-achieved target requires no extra purchase', () => {
    const value=ready(computeDca({rows:[dca.rows[0]],targetAverage:{price:'9000',fee:'0',target:'10000'}}));
    expect(value.targetAverage).toMatchObject({state:'achieved',quantity:'0',totalNewCost:'0'});
  });
  test('fees have one-side semantics and do not count hidden exit or Spot funding values', () => {
    expect(ready(computeFees({...fees,includeExit:false,notionalExit:'Infinity'}))).toMatchObject({feeOpen:'1.2',feeClose:null,feesTotal:'1.2'});
    expect(ready(computeFees({...fees,market:'spot',funding:{notional:'',rate:'Infinity',periods:'-1'}}))).toMatchObject({fundingCost:null,netCost:null});
  });
  test('funding sign is applied once and periods are nonnegative integers', () => {
    for (const side of ['long','short'] as const) {
      const direction=side==='long' ? '1.8' : '-1.8';
      const base={...fees,side,funding:{notional:'6000',rate:'0.01',periods:'3'}};
      expect(ready(computeFees(base)).fundingCost).toBe(direction);
      expect(new Decimal(ready(computeFees({...base,funding:{...base.funding,rate:'-0.01'}})).fundingCost!).eq(new Decimal(direction).negated())).toBe(true);
      expect(ready(computeFees({...base,funding:{...base.funding,periods:'0'}})).fundingCost).toBe('0');
      for (const periods of ['1.1','-1']) expect(computeFees({...base,funding:{...base.funding,periods}}).ok).toBe(false);
    }
  });
});
