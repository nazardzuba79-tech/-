import { replayScenario } from '../replay';
import { Candle, ModelProfile, ReplayInput } from '../types';
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
