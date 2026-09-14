import { replayScenario } from '../replay';
import { Candle, ModelProfile, ReplayInput, ResolvedCandleSelection } from '../types';
import { decimal } from '../math';
const profile: ModelProfile = { pricingModelVersion: 'test-price-v1', feeModelVersion: 'test-fees-v1', riskModelVersion: 'test-risk-v1', takerFeeRate: '0', makerFeeRate: '0', liquidationFeeRate: '0', slippageBps: '0', riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: ['TEST_ONLY_PARAMETERS'] };
const bar = (timestamp: number, open: string, low = open, high = open, close = open): Candle => ({timestamp, open, low, high, close});
function input(candles = [bar(120000, '100'), bar(180000, '110'), bar(240000, '120')]): ReplayInput {
  return { scenarioId: 'scenario', symbol: 'XYZUSDT', side: 'LONG', quantity: '10', leverage: '10', createdAt: 1000000, requestedOpenedAt: 60001, asOf: 300000, allocatedCapital: '1000', profile, data: { tradeCandles: candles, markCandles: candles, fundingEvents: [], expectedFundingTimestamps: [], intervalMs: 60000, complete: true } };
}
describe('private historical replay path', () => {
  test('next bar entry and exit preserve created time separately and reproduce 1200% fixture', () => {
    const i = input([bar(120000, '100'), bar(180000, '220')]); i.asOf = 240000; i.requestedClosedAt = 120001;
    expect(replayScenario(i)).toMatchObject({ verification: 'VERIFIED', status: 'CLOSED', createdAt: 1000000, effectiveOpenedAt: 120000, effectiveClosedAt: 180000, realizedGross: '1200', netPnl: '1200', roiPercent: '1200', scenarioEquity: '2200', remainingCollateral: '0' });
  });
  test('long is liquidated before a later 120% rise; future margin cannot rescue it', () => {
    const i = input([bar(120000, '100', '89', '100', '90'), bar(180000, '220'), bar(240000, '220')]);
    i.events = [{ id: 'late-rescue', effectiveAt: 240000, kind: 'MARGIN', amount: '500' }];
    const r = replayScenario(i);
    expect(r.status).toBe('LIQUIDATED'); expect(r.effectiveClosedAt).toBe(180000); expect(decimal(r.netPnl).lt(0)).toBe(true);
    expect(r.journal.some((j) => j.id.includes('late-rescue'))).toBe(false);
  });
  test('short liquidates on mark rise even if trade candle looks safe', () => {
    const i = input(); i.side = 'SHORT'; i.data.tradeCandles = [bar(120000, '100'), bar(180000, '100'), bar(240000, '100')];
    i.data.markCandles = [bar(120000, '100', '100', '112', '111'), bar(180000, '111'), bar(240000, '111')];
    expect(replayScenario(i).status).toBe('LIQUIDATED');
  });
  test('mark-based liquidation cannot be avoided by a future trade candle', () => {
    const i = input(); i.data.markCandles = [bar(120000, '100', '89', '100', '95'), bar(180000, '110'), bar(240000, '120')];
    expect(replayScenario(i).status).toBe('LIQUIDATED');
  });
  test.each([{tp:'110', sl:'95', low:'94', high:'112'}, {tp:'110', sl:null, low:'89', high:'112'}])('ambiguous intrabar ordering never selects favorable profit (%p)', ({tp,sl,low,high}) => {
    const i = input([bar(120000,'100',low,high,'100'),bar(180000,'120')]); i.takeProfit = tp; i.stopLoss = sl;
    const r = replayScenario(i); expect(r.verification).toBe('AMBIGUOUS'); expect(r.status).toBe('OPEN'); expect(r.fills).toHaveLength(1); expect(r.netPnl).toBe('0');
  });
  test('single TP trigger closes at next trade-open, not mark target or future high', () => {
    const i = input([bar(120000,'100','99','112','108'),bar(180000,'109'),bar(240000,'200')]); i.takeProfit = '110';
    const r = replayScenario(i); expect(r.status).toBe('CLOSED'); expect(r.fills[1]).toMatchObject({ kind: 'TAKE_PROFIT', price: '109', effectiveAt: 180000 }); expect(r.netPnl).toBe('90');
  });
  test('missing trade or mark candles is incomplete, no synthetic bridge', () => {
    const i = input(); i.data.markCandles = [bar(120000,'100'),bar(240000,'120')];
    const r = replayScenario(i); expect(r.verification).toBe('INCOMPLETE'); expect(r.evaluatedThrough).toBe(180000); expect(r.unrealizedPnl).toBe('0');
  });
  test('missing expected funding refuses verified result', () => {
    const i = input(); i.data.expectedFundingTimestamps = [180000]; expect(replayScenario(i).verification).toBe('INCOMPLETE');
  });
  test('funding uses quantity at settlement and cash sign, not price change', () => {
    const i = input(); i.data.fundingEvents = [{timestamp:180000,rate:'0.001',markPrice:'110'},{timestamp:240000,rate:'-0.002',markPrice:'120'}]; i.data.expectedFundingTimestamps = [180000,240000];
    i.events = [{id:'half',kind:'CLOSE',effectiveAt:180000,quantity:'5'}];
    const r = replayScenario(i); expect(r.verification).toBe('VERIFIED'); expect(r.fundingNet).toBe('0.1'); expect(r.remainingQuantity).toBe('5'); expect(r.realizedGross).toBe('50'); expect(r.netPnl).toBe('150.1');
    expect(r.journal.filter(j => j.kind === 'FUNDING')).toHaveLength(2);
  });
  test('funding at entry is not charged and at close boundary precedes closing', () => {
    const i = input(); i.requestedClosedAt = 180001; i.data.fundingEvents = [{timestamp:120000,rate:'0.001',markPrice:'100'},{timestamp:240000,rate:'0.001',markPrice:'120'}];
    const r = replayScenario(i); expect(r.fundingNet).toBe('-1.2'); expect(r.effectiveClosedAt).toBe(240000);
  });
  test('remaining collateral after partial close is distinct from cumulative ROI contribution', () => {
    const i=input();i.events=[{id:'half',kind:'CLOSE',effectiveAt:180000,quantity:'5'}];
    const r=replayScenario(i);expect(r.status).toBe('OPEN');expect(r.remainingQuantity).toBe('5');expect(r.remainingCollateral).toBe('50');expect(r.roiMarginBasis).toBe('100');expect(r.roiPercent).toBe('150');
  });
  test('margin addition reduces risk, partial/full closes conserve journal equity', () => {
    const i = input(); i.profile = { ...profile, takerFeeRate:'0.001' }; i.events = [{id:'margin',kind:'MARGIN',effectiveAt:120000,amount:'100'},{id:'half',kind:'CLOSE',effectiveAt:180000,quantity:'5'},{id:'rest',kind:'CLOSE',effectiveAt:240000,quantity:'5'}];
    const r = replayScenario(i); expect(r.status).toBe('CLOSED'); expect(r.openingFees).toBe('1'); expect(r.closingFees).toBe('1.15'); expect(r.realizedGross).toBe('150'); expect(r.netPnl).toBe('147.85'); expect(r.scenarioEquity).toBe('1147.85');
    expect(r.journal.map(j=>j.id).length).toBe(new Set(r.journal.map(j=>j.id)).size);
  });
  test('future event does not affect earlier liquidation and tied events deterministic', () => {
    const i = input(); const events = [{id:'b',kind:'MARGIN' as const,effectiveAt:180000,amount:'20'},{id:'a',kind:'MARGIN' as const,effectiveAt:180000,amount:'10'}];
    expect(replayScenario({...i,events})).toEqual(replayScenario({...i,events:[...events].reverse()}));
  });
  test('intrabar manual event asks for finer history', () => {
    const i = input(); i.events = [{id:'a',kind:'MARGIN',effectiveAt:180001,amount:'100'}]; expect(replayScenario(i).verification).toBe('AMBIGUOUS');
  });
  test('manual price is an explicit recorded assumption', () => {
    const i = input(); i.manualEntryPrice = '99'; const r = replayScenario(i); expect(r.entryPrice).toBe('99'); expect(r.assumptions).toContain('MANUAL_ENTRY_PRICE_ASSUMPTION');
  });
  test('no lookahead from open candle at asOf', () => {
    const i = input([bar(120000,'100'),bar(180000,'100','1','10000','9999')]); i.asOf=180000;
    const r=replayScenario(i); expect(r.verification).toBe('VERIFIED'); expect(r.unrealizedPnl).toBe('0'); expect(r.status).toBe('OPEN');
  });
  test('a fixed closed result does not revalue from later bars', () => {
    const i=input();i.requestedClosedAt=120001;
    const r=replayScenario(i);i.data.tradeCandles[2]=bar(240000,'999999');i.data.markCandles=[...i.data.tradeCandles];
    expect(replayScenario(i)).toEqual(r);
  });
  test('scenario advance preserves creation time while validating against current evaluation time',()=>{
    const i=input();i.createdAt=180000;i.evaluatedAt=1000000;
    const r=replayScenario(i);expect(r.createdAt).toBe(180000);expect(r.asOf).toBe(300000);expect(r.verification).toBe('VERIFIED');
  });
  test('capital and unsafe withdrawals reject', () => {
    expect(()=>replayScenario({...input(),allocatedCapital:'1'})).toThrow('INSUFFICIENT');
    expect(()=>replayScenario({...input(),events:[{id:'a',kind:'MARGIN',effectiveAt:120000,amount:'-99'}]})).toThrow('UNSAFE_MARGIN_REMOVAL');
  });
  test('invalid OHLC, zero/null prices, duplicate event, and over-close reject', () => {
    expect(()=>replayScenario(input([bar(120000,'0')]))).toThrow();
    expect(()=>replayScenario(input([bar(120000,'100','110','90')]))).toThrow('RANGE');
    const event={id:'a',kind:'CLOSE' as const,effectiveAt:180000,quantity:'11'};
    expect(()=>replayScenario({...input(),events:[event]})).toThrow('CLOSE_EXCEEDS');
    expect(()=>replayScenario({...input(),events:[event,event]})).toThrow('DUPLICATE_EVENT');
  });
});

const selected = (candle: Candle, pricePoint: 'OPEN' | 'CLOSE' = 'CLOSE'): ResolvedCandleSelection => ({ source: 'BYBIT_LINEAR', symbol: 'XYZUSDT', interval: '1m', intervalMs: 60000,
  openTime: candle.timestamp, closeTime: candle.timestamp + 60000, effectiveAt: candle.timestamp + (pricePoint === 'CLOSE' ? 60000 : 0),
  pricePoint, price: pricePoint === 'CLOSE' ? candle.close : candle.open, candle, fetchedAt: 1000000, verification: 'VERIFIED' });
const candleInput = (): ReplayInput => {
  const candles = [bar(60000, '100', '1', '250', '100'), bar(120000, '100'), bar(180000, '100', '100', '220', '220')];
  return { ...input(candles), requestedOpenedAt: 60000, asOf: 240000, profile: { ...profile, pricingModelVersion: 'VOLTEX_SELECTED_CANDLE_POINT_V2' }, candleEntry: selected(candles[0]) };
};
describe('selected candle model and incremental checkpoint', () => {
  test('selected Close uses its exact price and never liquidates from its earlier high/low', () => {
    const i = candleInput(), r = replayScenario(i);
    expect(r).toMatchObject({ status: 'OPEN', verification: 'VERIFIED', entryPrice: '100', effectiveOpenedAt: 120000, unrealizedPnl: '1200', roiPercent: '1200', scenarioEquity: '2200', remainingCollateral: '100' });
    expect(decimal(r.netPnl).div(r.allocatedCapital).times(100).toFixed()).toBe('120');
    expect(r.fills[0]).toMatchObject({ effectiveAt: 120000, price: '100' });
    expect(r.candleEntry?.openTime).toBe(60000);
  });
  test('selected Open includes its held candle risk and subsequent recovery cannot rescue liquidation', () => {
    const i = candleInput(); i.candleEntry = selected(i.data.tradeCandles[0], 'OPEN');
    expect(replayScenario(i)).toMatchObject({ status: 'LIQUIDATED', effectiveOpenedAt: 60000, effectiveClosedAt: 120000 });
  });
  test('selected price stays exact even while subsequent simulated exit slippage is configured', () => {
    const i = candleInput(); i.profile = { ...i.profile, slippageBps: '2' };
    i.candleClose = selected(i.data.tradeCandles[2]);
    expect(replayScenario(i)).toMatchObject({ entryPrice: '100', valuationPrice: '220', realizedGross: '1200', effectiveClosedAt: 240000, status: 'CLOSED' });
  });
  test('selected short Close retains 1x quantity PnL and uses exact close price', () => {
    const i = candleInput(); i.side = 'SHORT'; i.data.tradeCandles[2] = bar(180000, '100', '80', '100', '80'); i.data.markCandles = i.data.tradeCandles;
    i.candleClose = selected(i.data.tradeCandles[2]);
    expect(replayScenario(i)).toMatchObject({ status: 'CLOSED', netPnl: '200', roiPercent: '200' });
  });
  test('funding at selected close is applied once before closing', () => {
    const i = candleInput(); i.candleClose = selected(i.data.tradeCandles[2]);
    i.data.fundingEvents = [{ timestamp: 240000, rate: '0.001', markPrice: '220' }]; i.data.expectedFundingTimestamps = [240000];
    const r = replayScenario(i); expect(r).toMatchObject({ status: 'CLOSED', fundingNet: '-2.2', netPnl: '1197.8' });
    expect(r.journal.filter(j => j.kind === 'FUNDING')).toHaveLength(1);
  });
  test('a selected favorable close does not skip intermediate liquidation', () => {
    const i = candleInput(); i.data.tradeCandles[1] = bar(120000, '100', '85', '100', '100'); i.data.markCandles = i.data.tradeCandles;
    i.candleClose = selected(i.data.tradeCandles[2]);
    const r = replayScenario(i); expect(r.status).toBe('LIQUIDATED'); expect(r.effectiveClosedAt).toBe(180000); expect(decimal(r.netPnl).lt(0)).toBe(true);
  });
  test('latest completed Close opens without requiring future history', () => {
    const i = candleInput(); i.asOf = 120000; i.data.tradeCandles = [i.data.tradeCandles[0]]; i.data.markCandles = i.data.tradeCandles;
    expect(replayScenario(i)).toMatchObject({ verification: 'VERIFIED', status: 'OPEN', entryPrice: '100', unrealizedPnl: '0', evaluatedThrough: 120000 });
  });
  test('a checkpoint consumes only new candles and exactly matches one uninterrupted replay', () => {
    const whole = candleInput(); const first = { ...whole, asOf: 180000, data: { ...whole.data, tradeCandles: whole.data.tradeCandles.slice(0, 2), markCandles: whole.data.markCandles.slice(0, 2) } };
    const r = replayScenario(first), immutable = JSON.stringify(r);
    const continued = replayScenario({ ...whole, resume: r, data: { ...whole.data, tradeCandles: whole.data.tradeCandles.slice(2), markCandles: whole.data.markCandles.slice(2) } });
    expect(continued).toEqual(replayScenario(whole)); expect(JSON.stringify(r)).toBe(immutable);
    expect(continued.journal.slice(0, r.journal.length)).toEqual(r.journal); expect(continued.fills.filter(f => f.kind === 'OPEN')).toHaveLength(1);
  });
  test('a processed boundary checkpoint never double applies funding or margin', () => {
    const whole = candleInput(); whole.data.fundingEvents = [{ timestamp: 180000, rate: '0.001', markPrice: '100' }]; whole.data.expectedFundingTimestamps = [180000];
    whole.events = [{ id: 'margin', kind: 'MARGIN', effectiveAt: 180000, amount: '10' }];
    const first = replayScenario({ ...whole, asOf: 180000 }); expect(first.checkpoint?.boundaryProcessed).toBe(true);
    const continued = replayScenario({ ...whole, resume: first, data: { ...whole.data, tradeCandles: whole.data.tradeCandles.slice(2), markCandles: whole.data.markCandles.slice(2) } });
    expect(continued).toEqual(replayScenario(whole)); expect(continued.journal.filter(j => j.kind === 'FUNDING')).toHaveLength(1);
  });
  test('checkpoint identity forbids changed profile, side and events; same asOf is not another advance', () => {
    const i = candleInput(), prior = replayScenario({ ...i, asOf: 180000 });
    for (const patch of [{ side: 'SHORT' }, { profile: { ...i.profile, takerFeeRate: '0.001' } }, { events: [{ id: 'new', kind: 'MARGIN', effectiveAt: 180000, amount: '100' }] }, { asOf: 180000 }]) {
      expect(() => replayScenario({ ...i, ...patch, resume: prior } as ReplayInput)).toThrow('CHECKPOINT');
    }
  });
  test('wrong contract, source, injected price, future candle and manual override reject', () => {
    const i = candleInput();
    for (const patch of [{ symbol: 'OTHERUSDT' }, { source: 'SPOT' }, { price: '99' }, { closeTime: 2000000 }]) expect(() => replayScenario({ ...i, candleEntry: { ...i.candleEntry!, ...patch } as ResolvedCandleSelection })).toThrow('SELECTED_CANDLE');
    expect(() => replayScenario({ ...i, manualEntryPrice: '100' })).toThrow('CONFLICTING');
  });
  test('changed finer-history entry or selected-exit prices cannot silently produce a verified result', () => {
    const i = candleInput(); i.data.tradeCandles = i.data.tradeCandles.map(c => ({ ...c })); i.data.tradeCandles[0].close = '101';
    expect(replayScenario(i).verification).toBe('INCOMPLETE');
    const j = candleInput(); j.candleClose = selected({ ...j.data.tradeCandles[2], close: '219' });
    expect(replayScenario(j).verification).toBe('INCOMPLETE');
  });
  test('selected Open close is checked against the same history point and ignores its later range', () => {
    const i = candleInput(); i.data.tradeCandles[2] = bar(180000, '100', '1', '1000', '100'); i.data.markCandles = i.data.tradeCandles;
    i.candleClose = selected(i.data.tradeCandles[2], 'OPEN'); i.asOf = 180000;
    expect(replayScenario(i)).toMatchObject({ verification: 'VERIFIED', status: 'CLOSED', effectiveClosedAt: 180000 });
    i.candleClose = selected({ ...i.data.tradeCandles[2], open: '101' }, 'OPEN');
    expect(replayScenario(i).verification).toBe('INCOMPLETE');
  });
});
