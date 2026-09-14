import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, demoAccount, demoPositionView,
  closeDemoPosition, setDemoLeverage, protectDemoPosition, evaluateDemoRiskAndProtection, executeDemoBook, settleDemoFunding,
  cancelDemoOrder, NATIVE_DEMO_MODEL, DemoInstrument } from '../native/engine';
import { replayNativeDemo, NativeInstruction, ReplayBar } from '../native/replay';
const T=1_728_000_000_000;
const instrument:DemoInstrument={rules:{symbol:'BTCUSDT',tickSize:'0.1',qtyStep:'0.001',minOrderQty:'0.001',maxOrderQty:'1000',maxMarketOrderQty:'1000',minNotionalValue:'5',minLeverage:'1',maxLeverage:'100',leverageStep:'1'},profile:{pricingModelVersion:'fixture',feeModelVersion:'fixture',riskModelVersion:'fixture',takerFeeRate:'0.00055',makerFeeRate:'0.0002',liquidationFeeRate:'0',slippageBps:'0',riskTiers:[{maxNotional:'1000000000',maintenanceRate:'0.005',deduction:'0',maxLeverage:'100'}],assumptions:[]}};
function state(balance='10000000') {const s=emptyDemoState(balance,T);registerDemoInstrument(s,instrument);markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'50000'}},T);return s;}
const order=(id='o1',side:'LONG'|'SHORT'='LONG')=>({id,symbol:'BTCUSDT',side,type:'MARKET' as const,quantity:'2',leverage:'20'});
function opened(balance='10000000',side:'LONG'|'SHORT'='LONG'){const s=state(balance);placeDemoOrder(s,order('o1',side),T);fillDemoOrder(s,'o1','2','50000',T,'SELECTED_POINT');return s;}
function bar(time:number,o:string,l:string,h:string,c:string):ReplayBar{return{time,intervalMs:60000,trade:{timestamp:time,open:o,low:l,high:h,close:c},mark:{timestamp:time,open:o,low:l,high:h,close:c}};}
const instr=(side:'LONG'|'SHORT'='LONG'):NativeInstruction=>({id:'c1',at:T,kind:'OPEN',order:{...order('o1',side),historical:true},instrument,mark:'50000',last:'50000',point:'50000'});

describe('native demo math and execution (synthetic fixtures)',()=>{
  test('uses requested signed FRACTION rates and explicit interval, never claims provider funding',()=>{
    expect(NATIVE_DEMO_MODEL.funding).toEqual({longCashflow:'-0.001',shortCashflow:'0.004',unit:'FRACTION',intervalMs:28800000});
  });
  test('known zero is kept, empty wallet has no fictitious liquidation',()=>{
    const a=demoAccount(emptyDemoState('0',T));expect(a.walletBalance).toBe('0');expect(a.liquidatable).toBe(false);expect(a.maintenanceRatio).toBeNull();
  });
  test('5,000 margin × 20 creates 100,000 notional, not a multiplier applied twice',()=>{
    const s=opened();expect(s.positions[0].quantity).toBe('2');expect(s.positions[0].roiBasis).toBe('5000');
    markDemoAccount(s,{BTCUSDT:{mark:'55000',last:'55000'}},T+1);
    expect(demoPositionView(s,s.positions[0])).toMatchObject({unrealizedPnl:'10000',roiPercent:'200',netPnl:'9945'});
  });
  test.each([['LONG','60000','20000'],['SHORT','40000','20000']] as const)('%s P&L sign is correct', (side,price,pnl)=>{
    const s=opened('10000000',side);markDemoAccount(s,{BTCUSDT:{mark:price,last:price}},T+1);expect(demoAccount(s).unrealizedPnl).toBe(pnl);
  });
  test('whole account supports a drawdown larger than entry margin',()=>{
    const s=opened();markDemoAccount(s,{BTCUSDT:{mark:'20000',last:'20000'}},T+1);evaluateDemoRiskAndProtection(s,T+1);
    expect(s.positions[0].status).toBe('OPEN');expect(demoAccount(s).unrealizedPnl).toBe('-60000');
  });
  test('small collateral liquidates and cannot resurrect on the later rally',()=>{
    const s=opened('5200');markDemoAccount(s,{BTCUSDT:{mark:'45000',last:'45000'}},T+1);evaluateDemoRiskAndProtection(s,T+1);
    markDemoAccount(s,{BTCUSDT:{mark:'100000',last:'100000'}},T+2);evaluateDemoRiskAndProtection(s,T+2);
    expect(s.positions[0].status).toBe('LIQUIDATED');expect(s.positions[0].quantity).toBe('0');
    expect(s.events.filter(e=>e.kind==='LIQUIDATION')).toHaveLength(1);expect(new BigNumber(demoAccount(s).deficit).gt(0)).toBe(true);
  });
  test('trade-price wick alone does not liquidate a solvent Mark-priced portfolio',()=>{
    const s=opened('5200');markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'20000'}},T+1);evaluateDemoRiskAndProtection(s,T+1);
    expect(s.positions[0].status).toBe('OPEN');
  });
  test('changing leverage changes margin, not absolute P&L or quantity',()=>{
    const s=opened();markDemoAccount(s,{BTCUSDT:{mark:'51000',last:'51000'}},T+1);const pnl=demoAccount(s).unrealizedPnl;
    setDemoLeverage(s,'o1','10',T+2);expect(s.positions[0].quantity).toBe('2');expect(demoAccount(s).unrealizedPnl).toBe(pnl);expect(s.positions[0].roiBasis).toBe('10000');
  });
  test('same-direction add uses weighted entry',()=>{
    const s=opened();markDemoAccount(s,{BTCUSDT:{mark:'60000',last:'60000'}},T+1);placeDemoOrder(s,order('o2'),T+1);fillDemoOrder(s,'o2','2','60000',T+1,'SELECTED_POINT');
    expect(s.positions).toHaveLength(1);expect(s.positions[0].entryPrice).toBe('55000');expect(s.positions[0].quantity).toBe('4');
  });
  test('both directions share ONE account collateral',()=>{
    const s=opened();placeDemoOrder(s,order('o2','SHORT'),T+1);fillDemoOrder(s,'o2','2','50000',T+1,'SELECTED_POINT');markDemoAccount(s,{BTCUSDT:{mark:'80000',last:'80000'}},T+2);
    expect(demoAccount(s).unrealizedPnl).toBe('0');expect(demoAccount(s).walletBalance).toBe('9999890');
  });
  test('partial close releases only matching basis and records real closed quantity',()=>{
    const s=opened();closeDemoPosition(s,'o1','0.5','55000',T+1);
    expect(s.positions[0]).toMatchObject({quantity:'1.5',realizedGross:'2500',roiBasis:'3750',closedRoiBasis:'1250'});
    expect(s.events.at(-1)).toMatchObject({quantity:'0.5',price:'55000',fee:'15.125',cashflow:'2484.875'});
  });
  test('cancellation releases reservation without changing cash or creating a fill',()=>{
    const s=state();placeDemoOrder(s,{...order(),type:'LIMIT',price:'20000'},T);expect(new BigNumber(demoAccount(s).orderReserve).gt(0)).toBe(true);
    cancelDemoOrder(s,'o1',T+1);expect(demoAccount(s).orderReserve).toBe('0');expect(s.walletBalance).toBe('10000000');expect(s.positions).toHaveLength(0);
  });
  test('idempotent identical order repeats return the original; changed payload is rejected',()=>{
    const s=state();const a=placeDemoOrder(s,order(),T);s.time=T+100;expect(placeDemoOrder(s,order(),T)).toBe(a);expect(s.orders).toHaveLength(1);
    expect(()=>placeDemoOrder(s,{...order(),quantity:'3'},T)).toThrow('IDEMPOTENCY_CONFLICT');
  });
  test.each(['0','-1','NaN','1e3','0.0001'])('invalid quantity %s is never accepted',quantity=>{
    const s=state();expect(()=>placeDemoOrder(s,{...order(),quantity},T)).toThrow();expect(s.orders).toHaveLength(0);
  });
  test('market IOC consumes only observed volume, no invented counterparty or duplicate depth',()=>{
    const s=state(),book={timestamp:T,bids:[{price:'49999',quantity:'1'}],asks:[{price:'50000',quantity:'0.5'}]};
    placeDemoOrder(s,order(),T);executeDemoBook(s,'o1',book,T);expect(s.orders[0]).toMatchObject({filled:'0.5',remaining:'1.5',status:'CANCELLED'});
    placeDemoOrder(s,order('o2'),T);executeDemoBook(s,'o2',book,T);expect(s.orders[1].filled).toBe('0');expect(s.positions[0].quantity).toBe('0.5');
    expect(book.asks[0].quantity).toBe('0.5');
  });
  test('stale depth fails rather than inventing a market fill',()=>{
    const s=state();placeDemoOrder(s,order(),T);expect(()=>executeDemoBook(s,'o1',{timestamp:T-6000,bids:[],asks:[]},T)).toThrow('STALE_BOOK');expect(s.positions).toHaveLength(0);
  });
  test('TP/SL is optional, add/change/remove works, partial TP never reverses the position',()=>{
    const s=opened();protectDemoPosition(s,'o1',{takeProfit:'55000',quantity:'0.5',triggerBy:'LAST'},T+1);
    markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'55000'}},T+2);evaluateDemoRiskAndProtection(s,T+2);
    expect(s.positions[0].quantity).toBe('1.5');expect(s.events.at(-1)?.kind).toBe('TAKE_PROFIT');
    protectDemoPosition(s,'o1',{stopLoss:'48000',triggerBy:'MARK'},T+3);protectDemoPosition(s,'o1',{stopLoss:null},T+4);
    expect(s.positions[0].protection.stopLoss).toBeNull();
  });
  test('a MARK stop ignores LAST until Mark reaches trigger',()=>{
    const s=opened();protectDemoPosition(s,'o1',{stopLoss:'48000'},T);
    markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'47000'}},T+1);evaluateDemoRiskAndProtection(s,T+1);expect(s.positions[0].status).toBe('OPEN');
    markDemoAccount(s,{BTCUSDT:{mark:'48000',last:'47990'}},T+2);evaluateDemoRiskAndProtection(s,T+2);expect(s.positions[0].status).toBe('CLOSED');expect(s.events.at(-1)?.kind).toBe('STOP_LOSS');
  });
  test.each([['LONG','-100'],['SHORT','400']] as const)('funding for %s settles exactly once per boundary', (side,flow)=>{
    const s=opened('10000000',side),t=T+28800000;markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'50000'}},t);settleDemoFunding(s,t);settleDemoFunding(s,t);
    expect(s.positions[0].fundingNet).toBe(flow);expect(s.events.filter(e=>e.kind==='FUNDING')).toHaveLength(1);
  });
  test('no charge after close or for an entry exactly at settlement',()=>{
    const s=opened();settleDemoFunding(s,T);expect(s.events.some(e=>e.kind==='FUNDING')).toBe(false);closeDemoPosition(s,'o1',undefined,'50000',T+1);
    markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'50000'}},T+28800000);settleDemoFunding(s,T+28800000);expect(s.events.some(e=>e.kind==='FUNDING')).toBe(false);
  });
  test('cashflow conservation and decimal precision',()=>{
    const s=opened();closeDemoPosition(s,'o1','0.001','77736.2',T+1);closeDemoPosition(s,'o1',undefined,'78526.7',T+2);
    expect(new BigNumber(s.initialDeposit).plus(s.events.reduce((v,e)=>v.plus(e.cashflow),new BigNumber(0))).toFixed()).toBe(s.walletBalance);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('portfolio history replay',()=>{
  test('selected historical entry immediately produces server P&L at end of history',()=>{
    const s=replayNativeDemo({deposit:'10000000',instructions:[instr()],bars:{BTCUSDT:[bar(T,'50000','40000','60000','55000')]},asOf:T+60000});
    expect(demoPositionView(s,s.positions[0])).toMatchObject({unrealizedPnl:'10000',netPnl:'9945'});
  });
  test('wick fill is at limit, not at the low after wick; absent touch leaves order open',()=>{
    const i=instr();if(i.kind!=='OPEN')throw new Error();delete i.point;i.order.type='LIMIT';i.order.price='20000';
    const s=replayNativeDemo({deposit:'10000000',instructions:[i],bars:{BTCUSDT:[bar(T,'50000','19000','60000','55000')]},asOf:T+60000});
    expect(s.orders[0].averagePrice).toBe('20000');expect(s.positions[0].entryPrice).toBe('20000');
    i.order.price='18000';const waiting=replayNativeDemo({deposit:'10000000',instructions:[i],bars:{BTCUSDT:[bar(T,'50000','19000','60000','55000')]},asOf:T+60000});expect(waiting.positions).toHaveLength(0);
  });
  test('TP executes at crossing before later high, without hindsight fill improvement',()=>{
    const i=instr();if(i.kind==='OPEN')i.order.protection={takeProfit:'55000'};
    const s=replayNativeDemo({deposit:'10000000',instructions:[i],bars:{BTCUSDT:[bar(T,'50000','49000','60000','59000')]},asOf:T+60000});
    expect(s.positions[0].status).toBe('CLOSED');expect(s.events.find(e=>e.kind==='TAKE_PROFIT')?.price).toBe('55000');
  });
  test('candle close entry does not inherit the preceding wick risk',()=>{
    const i=instr();i.at=T+60000;
    const s=replayNativeDemo({deposit:'5200',instructions:[i],bars:{BTCUSDT:[bar(T,'50000','1','60000','50000')]},asOf:T+60000});expect(s.positions[0].status).toBe('OPEN');
  });
  test('history gap is explicit error, not a fictitious successful trade',()=>{
    expect(()=>replayNativeDemo({deposit:'10000000',instructions:[instr()],bars:{BTCUSDT:[bar(T,'50000','49000','51000','50000')]},asOf:T+180000})).toThrow('HISTORY_GAP');
  });
  test('manual historical exit is journaled and later candles no longer change it',()=>{
    const close:NativeInstruction={id:'c2',kind:'CLOSE',at:T+60000,positionId:'o1',price:'55000'};
    const s=replayNativeDemo({deposit:'10000000',instructions:[instr(),close],bars:{BTCUSDT:[bar(T,'50000','49000','55000','55000'),bar(T+60000,'55000','1','100000','100000')]},asOf:T+120000});
    expect(s.positions[0].status).toBe('CLOSED');expect(s.positions[0].realizedGross).toBe('10000');
  });
});
