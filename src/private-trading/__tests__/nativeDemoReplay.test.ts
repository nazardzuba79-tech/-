import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, demoAccount, demoPositionView,
  estimateDemoLiquidationPrice, executeDemoBook, DemoInstrument, DemoState } from '../native/engine';
import { BarRequest, defaultResolution, historicalLimitTouch, instructionDigest, NativeInstruction, nativeReplay, ReplayBar,
  replayNativeDemo, replayNativeDemoWithBars, NATIVE_MAX_CONCURRENT_CONTRACTS } from '../native/replay';

const T=1_728_000_000_000; // 2024-10-04T00:00:00Z: a UTC day and 8h funding boundary
const M=60_000, H=3_600_000, DAY=86_400_000;
const rules=(symbol:string)=>({symbol,tickSize:'0.1',qtyStep:'0.001',minOrderQty:'0.001',maxOrderQty:'1000',maxMarketOrderQty:'1000',minNotionalValue:'5',minLeverage:'1',maxLeverage:'100',leverageStep:'1'});
const profile={pricingModelVersion:'fixture',feeModelVersion:'fixture',riskModelVersion:'fixture',takerFeeRate:'0.00055',makerFeeRate:'0.0002',liquidationFeeRate:'0',slippageBps:'0',riskTiers:[{maxNotional:'1000000000',maintenanceRate:'0.005',deduction:'0',maxLeverage:'100'}],assumptions:[]};
const inst=(symbol='BTCUSDT'):DemoInstrument=>({rules:rules(symbol),profile});
function bar(time:number,o:string,l:string,h:string,c:string,intervalMs=M):ReplayBar{return{time,intervalMs,trade:{timestamp:time,open:o,low:l,high:h,close:c},mark:{timestamp:time,open:o,low:l,high:h,close:c}};}
const flat=(from:number,to:number,price:string,intervalMs=M)=>{const out:ReplayBar[]=[];for(let t=from;t<to;t+=intervalMs)out.push(bar(t,price,price,price,price,intervalMs));return out;};
const open=(id:string,at:number,extra:Partial<Extract<NativeInstruction,{kind:'OPEN'}>['order']>={},point='50000',symbol='BTCUSDT'):NativeInstruction=>
  ({id,at,kind:'OPEN',order:{id,symbol,side:'LONG',type:'MARKET',quantity:'2',leverage:'20',historical:true,...extra},instrument:inst(symbol),mark:point,last:point,point});
const view=(s:DemoState,id:string)=>demoPositionView(s,s.positions.find(p=>p.id===id)!);

describe('historical limit on the selected candle (owner OHLC rule)',()=>{
  test('buy limit fills only when Low <= limit, at the limit, as maker, on the open->low leg',()=>{
    expect(historicalLimitTouch('LONG','20000',{open:'25000',high:'26000',low:'19000',close:'24000'},T,H)).toEqual({at:T+1_000_000,price:'20000',maker:true});
    expect(historicalLimitTouch('LONG','19000',{open:'25000',high:'26000',low:'19000',close:'24000'},T,H)).toEqual({at:T+1_200_000,price:'19000',maker:true});
    expect(historicalLimitTouch('LONG','18999.9',{open:'25000',high:'26000',low:'19000',close:'24000'},T,H)).toBeNull();
  });
  test('sell limit fills only when High >= limit, on the low->high leg',()=>{
    expect(historicalLimitTouch('SHORT','78000',{open:'70000',high:'80000',low:'69000',close:'75000'},T,H)).toEqual({at:T+1_200_000+981_818,price:'78000',maker:true});
    expect(historicalLimitTouch('SHORT','80000.1',{open:'70000',high:'80000',low:'69000',close:'75000'},T,H)).toBeNull();
  });
  test('a limit already marketable at the candle open fills at the open as taker (no hindsight improvement)',()=>{
    expect(historicalLimitTouch('LONG','20000',{open:'19500',high:'21000',low:'19000',close:'20500'},T,H)).toEqual({at:T,price:'19500',maker:false});
    expect(historicalLimitTouch('SHORT','78000',{open:'79000',high:'81000',low:'77000',close:'80000'},T,H)).toEqual({at:T,price:'79000',maker:false});
  });
  test('the replayed maker wick fill uses the maker fee and the limit price',()=>{
    const touch=historicalLimitTouch('LONG','49000',{open:'50000',high:'50100',low:'48900',close:'49500'},T,M)!;
    const i=open('h1',touch.at,{type:'LIMIT',price:'49000'},touch.price);if(i.kind==='OPEN')i.maker=touch.maker;
    const s=replayNativeDemo({deposit:'1000000',instructions:[i],bars:{BTCUSDT:[bar(T,'50000','48900','50100','49500'),...flat(T+M,T+3*M,'49500')]},asOf:T+3*M});
    expect(s.positions[0]).toMatchObject({entryPrice:'49000',quantity:'2',openingFees:'19.6'});
    expect(s.events[0]).toMatchObject({kind:'OPEN',price:'49000',fee:'19.6',pricing:'SELECTED_POINT'});
  });
});

describe('canonical checkpoint: live outcomes are never recomputed away',()=>{
  const tpOpen=()=>open('o1',T,{historical:false,protection:{takeProfit:'50500',triggerBy:'LAST'}});
  const bars=()=>[...flat(T,T+7*M,'50000'),bar(T+7*M,'50000','49900','50600','50200'),...flat(T+8*M,T+10*M,'50200')];
  test('incremental continuation from a checkpoint equals the full chronological replay',()=>{
    const close:NativeInstruction={id:'c1',kind:'CLOSE',at:T+6*M+10_000,positionId:'o1',quantity:'0.5',price:'50100'};
    const full=replayNativeDemoWithBars({deposit:'1000000',instructions:[tpOpen(),close],bars:{BTCUSDT:bars()},asOf:T+10*M});
    const first=replayNativeDemoWithBars({deposit:'1000000',instructions:[tpOpen()],bars:{BTCUSDT:bars()},asOf:T+4*M+30_000});
    expect(first.checkpoint.time).toBe(T+4*M);
    const next=replayNativeDemoWithBars({deposit:'1000000',instructions:[tpOpen(),close],bars:{BTCUSDT:bars()},asOf:T+10*M,checkpoint:first.checkpoint});
    expect(next.snapshot).toEqual(full.snapshot);
    expect(next.checkpoint).toEqual(full.checkpoint);
    expect(full.snapshot.positions[0]).toMatchObject({status:'CLOSED'});
    expect(full.snapshot.events.map(e=>e.kind)).toEqual(['OPEN','CLOSE','TAKE_PROFIT']);
    expect(full.snapshot.events.at(-1)).toMatchObject({price:'50500',quantity:'1.5'});
  });
  test('a backdated instruction cannot silently reuse a checkpoint that does not contain it',()=>{
    const first=replayNativeDemoWithBars({deposit:'1000000',instructions:[tpOpen()],bars:{BTCUSDT:bars()},asOf:T+4*M+30_000});
    const backdated=open('h1',T+M);
    expect(()=>replayNativeDemoWithBars({deposit:'1000000',instructions:[tpOpen(),backdated],bars:{BTCUSDT:bars()},asOf:T+10*M,checkpoint:first.checkpoint})).toThrow('CHECKPOINT_MISMATCH');
    expect(first.checkpoint.digest).toBe(instructionDigest([tpOpen()],T+4*M));
  });
  test('a TP triggered by a live quote is journaled and survives later replays',()=>{
    const i=tpOpen(),history=flat(T,T+4*M,'50000'),asOf=T+2*M+30_000;
    const live=replayNativeDemoWithBars({deposit:'1000000',instructions:[i],bars:{BTCUSDT:history},asOf,latest:{BTCUSDT:{mark:'50000',last:'50650',time:asOf}}});
    expect(live.observed).toEqual({BTCUSDT:{mark:'50000',last:'50650'}});
    expect(live.snapshot.positions[0].status).toBe('CLOSED');
    expect(live.snapshot.events.at(-1)).toMatchObject({kind:'TAKE_PROFIT',price:'50650',pricing:'LIVE_QUOTE_MODEL'});
    const observe:NativeInstruction={id:'observe-1',kind:'OBSERVE',at:asOf,marks:live.observed!};
    const later=replayNativeDemoWithBars({deposit:'1000000',instructions:[i,observe],bars:{BTCUSDT:history},asOf:T+4*M,checkpoint:live.checkpoint});
    expect(later.snapshot.positions[0].status).toBe('CLOSED');
    expect(later.snapshot.events.at(-1)).toMatchObject({kind:'TAKE_PROFIT',price:'50650'});
    expect(later.snapshot.walletBalance).toBe(live.snapshot.walletBalance);
    // Without the journal the minute bar (which never printed the quote) would reopen it: that is why it is stored.
    expect(replayNativeDemoWithBars({deposit:'1000000',instructions:[i],bars:{BTCUSDT:history},asOf:T+4*M}).snapshot.positions[0].status).toBe('OPEN');
  });
});

describe('history windows',()=>{
  function requests(input:Parameters<typeof nativeReplay>[0],bars:Record<string,ReplayBar[]>){
    const seen:BarRequest[]=[];const run=nativeReplay(input);let step=run.next();
    while(!step.done){seen.push(step.value);const r=step.value;step=run.next((bars[r.symbol]??[]).filter(b=>b.time>=r.start&&b.time<r.end&&b.intervalMs===r.intervalMs));}
    return{seen,result:step.value};
  }
  test('idle spans without exposure are skipped instead of downloading history',()=>{
    const instructions:NativeInstruction[]=[open('a',T+M),{id:'b',kind:'CLOSE',at:T+3*M,positionId:'a',price:'50000'},open('c',T+5*DAY+M)];
    const bars={BTCUSDT:[...flat(T,T+DAY,'50000'),...flat(T+5*DAY,T+5*DAY+4*M,'50000')]};
    const {seen,result}=requests({deposit:'1000000',instructions,asOf:T+5*DAY+4*M,resolution:()=>({intervalMs:M,windowMs:DAY,eraEnd:Number.MAX_SAFE_INTEGER})},bars);
    expect(seen).toEqual([{symbol:'BTCUSDT',start:T+M,end:T+DAY,intervalMs:M},{symbol:'BTCUSDT',start:T+5*DAY+M,end:T+5*DAY+4*M,intervalMs:M}]);
    expect(result.snapshot.positions.map(p=>p.status)).toEqual(['CLOSED','OPEN']);
  });
  test('age tiers: 1m for the last 7 days, 15m to 45 days, 1h beyond, all day-aligned',()=>{
    const asOf=T+100*DAY+5*H+123;
    expect(defaultResolution(T+95*DAY,asOf)).toMatchObject({intervalMs:M,windowMs:DAY});
    expect(defaultResolution(T+60*DAY,asOf)).toMatchObject({intervalMs:15*M,windowMs:7*DAY,eraEnd:T+93*DAY});
    expect(defaultResolution(T,asOf)).toMatchObject({intervalMs:H,windowMs:30*DAY,eraEnd:T+55*DAY});
  });
  test('a months-old historical position is valued through coarse then fine windows up to now',()=>{
    const asOf=T+60*DAY+30*M;
    const bars={BTCUSDT:[...flat(T,T+15*DAY,'50000',H),...flat(T+15*DAY,T+53*DAY,'50000',15*M),...flat(T+53*DAY,T+60*DAY+30*M,'51000')]};
    const {seen,result}=requests({deposit:'1000000',instructions:[open('h',T+2*H+M)],asOf},bars);
    expect(new Set(seen.map(r=>r.intervalMs))).toEqual(new Set([H,15*M,M]));
    expect(seen.every(r=>r.end-r.start<=30*DAY)).toBe(true);
    expect(view(result.snapshot,'h')).toMatchObject({status:'OPEN',unrealizedPnl:'2000'});
    // 180 custom funding settlements (every 8h) were charged exactly once each: -0.1% of 100,000 (then 102,000) notional.
    const funding=result.snapshot.events.filter(e=>e.kind==='FUNDING');
    expect(funding).toHaveLength(180);
    expect(funding.every(e=>new BigNumber(e.cashflow).lt(0))).toBe(true);
  });
  test('a missing candle inside an exposed window is an explicit error',()=>{
    const bars={BTCUSDT:flat(T,T+10*M,'50000').filter(b=>b.time!==T+5*M)};
    expect(()=>replayNativeDemo({deposit:'1000000',instructions:[open('a',T)],bars,asOf:T+10*M})).toThrow('HISTORY_GAP');
  });
});

describe('cross account risk',()=>{
  function account(balance:string){const s=emptyDemoState(balance,T);for(const x of ['BTCUSDT','ETHUSDT'])registerDemoInstrument(s,inst(x));markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'50000'},ETHUSDT:{mark:'2500',last:'2500'}},T);return s;}
  function fill(s:DemoState,id:string,symbol:string,side:'LONG'|'SHORT',quantity:string,price:string,leverage='20',historical=false){placeDemoOrder(s,{id,symbol,side,type:'MARKET',quantity,leverage,historical},T);fillDemoOrder(s,id,quantity,price,T,'SELECTED_POINT');}
  const liquidatable=(s:DemoState,symbol:string,mark:string)=>{const p={...s,positions:s.positions.map(x=>({...x})),marks:{...s.marks,[symbol]:{mark,last:mark,time:T}}};return demoAccount(p).liquidatable;};
  test('owner profile: 5k margin at 20x on a 10M deposit has no reachable liquidation price',()=>{
    const s=account('10000000');fill(s,'a','BTCUSDT','LONG','2','50000');
    expect(view(s,'a')).toMatchObject({roiBasis:'5000',liquidationPrice:null,marginMode:'CROSS',liquidationStatus:'ACCOUNT_CROSS_ESTIMATE'});
  });
  test('with little collateral the estimate is the first tick above the account boundary',()=>{
    const s=account('5200');fill(s,'a','BTCUSDT','LONG','2','50000');
    const liq=view(s,'a').liquidationPrice!;expect(liq).toBe('47692.2');
    expect(liquidatable(s,'BTCUSDT',liq)).toBe(false);
    expect(liquidatable(s,'BTCUSDT',new BigNumber(liq).minus('0.1').toFixed())).toBe(true);
  });
  test('short estimate lies above entry and is conservative',()=>{
    const s=account('5200');fill(s,'a','BTCUSDT','SHORT','2','50000');
    const liq=view(s,'a').liquidationPrice!;expect(new BigNumber(liq).gt(50000)).toBe(true);
    expect(liquidatable(s,'BTCUSDT',liq)).toBe(false);
    expect(liquidatable(s,'BTCUSDT',new BigNumber(liq).plus('0.1').toFixed())).toBe(true);
  });
  test('another contract losing money moves this contract liquidation closer (shared collateral)',()=>{
    const s=account('20000');fill(s,'a','BTCUSDT','LONG','2','50000');fill(s,'b','ETHUSDT','LONG','10','2500');
    const before=new BigNumber(view(s,'a').liquidationPrice!);
    markDemoAccount(s,{ETHUSDT:{mark:'2000',last:'2000'}},T+1);
    expect(new BigNumber(view(s,'a').liquidationPrice!).gt(before)).toBe(true);
    expect(demoAccount(s).unrealizedPnl).toBe('-5000');
  });
  test('a fully hedged contract has no liquidation price; the account maintenance still counts both legs',()=>{
    const s=account('2000');fill(s,'a','BTCUSDT','LONG','0.2','50000');fill(s,'b','BTCUSDT','SHORT','0.2','50000');
    expect(estimateDemoLiquidationPrice(s,'a')).toBeNull();
    expect(new BigNumber(demoAccount(s).maintenanceMargin).toFixed()).toBe('111');
  });
  test('an adverse move on one contract liquidates the whole cross account, not one isolated leg',()=>{
    const instructions:NativeInstruction[]=[open('a',T,{historical:false,quantity:'0.2'}),open('b',T,{historical:false,quantity:'4'},'2500','ETHUSDT')];
    const bars={BTCUSDT:flat(T,T+3*M,'50000'),ETHUSDT:[...flat(T,T+M,'2500'),bar(T+M,'2500','1500','2500','1600'),...flat(T+2*M,T+3*M,'1600')]};
    const s=replayNativeDemo({deposit:'3000',instructions,bars,asOf:T+3*M});
    expect(s.positions.map(p=>p.status)).toEqual(['LIQUIDATED','LIQUIDATED']);
    expect(s.events.filter(e=>e.kind==='LIQUIDATION')).toHaveLength(2);
    const liquidatedAt=s.events.find(e=>e.kind==='LIQUIDATION')!.time;
    expect(liquidatedAt).toBeGreaterThan(T+M);expect(liquidatedAt).toBeLessThan(T+M+20_000);
  });
  test('historical test entries never merge into the live position; live adds still average',()=>{
    const s=account('10000000');fill(s,'live','BTCUSDT','LONG','1','50000');fill(s,'hist','BTCUSDT','LONG','1','40000','20',true);
    placeDemoOrder(s,{id:'add',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'20'},T);fillDemoOrder(s,'add','1','60000',T,'SELECTED_POINT');
    expect(s.positions.map(p=>[p.id,p.quantity,p.entryPrice,p.historical])).toEqual([['live','2','55000',false],['hist','1','40000',true]]);
  });
  test('a journal that was accepted always replays: the contract cap is an admission rule, not a replay rule',()=>{
    // 31 contracts, more than the default admission cap: the service refuses
    // the 31st OPEN before it is journaled (see nativeDemoService.test.ts), but
    // a journal that holds them — an older, larger cap — must still replay.
    const symbols=Array.from({length:NATIVE_MAX_CONCURRENT_CONTRACTS+1},(_,i)=>`C${String.fromCharCode(65+(i%26))}${Math.floor(i/26)}USDT`);
    const instructions=symbols.map((symbol,i)=>open(`o${i}`,T,{historical:false,symbol,quantity:'1'},'100',symbol));
    const bars=Object.fromEntries(symbols.map(x=>[x,flat(T,T+M,'100')]));
    expect(replayNativeDemo({deposit:'1000000',instructions,bars,asOf:T+M}).positions).toHaveLength(NATIVE_MAX_CONCURRENT_CONTRACTS+1);
  });
});

describe('orders, protection and funding through the replay',()=>{
  test('a live limit partially fills from observed depth, rests through a path that crossed it, and completes as maker only from an observed BOOK',()=>{
    const i:NativeInstruction={id:'l1',at:T+5_000,kind:'OPEN',order:{id:'l1',symbol:'BTCUSDT',side:'LONG',type:'LIMIT',price:'50000',quantity:'2',leverage:'10'},instrument:inst(),mark:'50010',last:'50010',
      book:{timestamp:T+4_000,bids:[],asks:[{price:'50000',quantity:'0.5'},{price:'50010',quantity:'9'}]}};
    const bars={BTCUSDT:[bar(T,'50010','50005','50020','50010'),bar(T+M,'50010','49990','50010','50000'),...flat(T+2*M,T+3*M,'50000')]};
    const early=replayNativeDemo({deposit:'1000000',instructions:[i],bars:{BTCUSDT:bars.BTCUSDT.slice(0,1)},asOf:T+M});
    expect(early.orders[0]).toMatchObject({status:'PARTIALLY_FILLED',filled:'0.5',remaining:'1.5'});
    // The path's low of 49 990 crossed the price: a LIVE order does not fill on that — a price is not volume.
    const rested=replayNativeDemo({deposit:'1000000',instructions:[i],bars,asOf:T+3*M});
    expect(rested.orders[0]).toMatchObject({status:'PARTIALLY_FILLED',filled:'0.5',remaining:'1.5'});
    // An observed book with 5 offered at 49 990 completes it, at the order's own price, as maker.
    const book:NativeInstruction={id:'b1',at:T+2*M+5_000,kind:'BOOK',symbol:'BTCUSDT',book:{timestamp:T+2*M+4_000,bids:[],asks:[{price:'49990',quantity:'5'}]}};
    const s=replayNativeDemo({deposit:'1000000',instructions:[i,book],bars,asOf:T+3*M});
    expect(s.orders[0]).toMatchObject({status:'FILLED',filled:'2',averagePrice:'50000'});
    expect(s.positions[0]).toMatchObject({quantity:'2',entryPrice:'50000'});
    const fees=s.events.filter(e=>e.kind==='OPEN').map(e=>e.fee);
    expect(fees).toEqual(['13.75','15']); // 0.5 taker from depth, 1.5 maker from the observed book
    // The same book journaled again brings nothing more (one provider snapshot, one consumption).
    const again=replayNativeDemo({deposit:'1000000',instructions:[i,book,{...book,id:'b2',at:T+2*M+6_000}],bars,asOf:T+3*M});
    expect(again.events.filter(e=>e.kind==='OPEN')).toHaveLength(2);
  });
  test('cancel releases the reserve; the cancelled order never fills later',()=>{
    const i:NativeInstruction={id:'l1',at:T,kind:'OPEN',order:{id:'l1',symbol:'BTCUSDT',side:'LONG',type:'LIMIT',price:'49000',quantity:'1',leverage:'10'},instrument:inst(),mark:'50000',last:'50000',book:{timestamp:T,bids:[],asks:[]}};
    const cancel:NativeInstruction={id:'x1',at:T+M+1,kind:'CANCEL',orderId:'l1'};
    const s=replayNativeDemo({deposit:'1000000',instructions:[i,cancel],bars:{BTCUSDT:[...flat(T,T+2*M,'50000'),bar(T+2*M,'50000','48000','50000','48500')]},asOf:T+3*M});
    expect(s.orders[0].status).toBe('CANCELLED');expect(s.positions).toHaveLength(0);expect(demoAccount(s).orderReserve).toBe('0');expect(s.walletBalance).toBe('1000000');
  });
  test('TP/SL can be added, changed and removed; the active SL triggers at its crossing',()=>{
    const add:NativeInstruction={id:'p1',at:T+M+1,kind:'PROTECTION',positionId:'o1',protection:{takeProfit:'52000',stopLoss:'49000',triggerBy:'LAST'}};
    const change:NativeInstruction={id:'p2',at:T+M+2,kind:'PROTECTION',positionId:'o1',protection:{stopLoss:'49500'}};
    const removeTp:NativeInstruction={id:'p3',at:T+M+3,kind:'PROTECTION',positionId:'o1',protection:{takeProfit:null}};
    const bars={BTCUSDT:[...flat(T,T+2*M,'50000'),bar(T+2*M,'50000','49000','53000','52500')]};
    const s=replayNativeDemo({deposit:'1000000',instructions:[open('o1',T,{historical:false}),add,change,removeTp],bars,asOf:T+3*M});
    expect(s.positions[0].status).toBe('CLOSED');
    expect(s.events.filter(e=>['STOP_LOSS','TAKE_PROFIT'].includes(e.kind))).toEqual([expect.objectContaining({kind:'STOP_LOSS',price:'49500',quantity:'2'})]);
    expect(demoPositionView(s,s.positions[0]).netPnl).toBe(new BigNumber(-1000).minus(55).minus('54.45').toFixed());
  });
  test.each([['LONG','-100'],['SHORT','400']] as const)('custom funding for %s is charged at each 8h UTC boundary while open',(side,flow)=>{
    const s=replayNativeDemo({deposit:'1000000',instructions:[open('o1',T+M,{side})],bars:{BTCUSDT:flat(T,T+8*H+2*M,'50000')},asOf:T+8*H+2*M});
    expect(s.events.filter(e=>e.kind==='FUNDING').map(e=>[e.time,e.cashflow])).toEqual([[T+8*H,flow]]);
    expect(s.positions[0].fundingNet).toBe(flow);
  });
  test('market depth consumption stays private and never mutates the observed book',()=>{
    const s=emptyDemoState('1000000',T);registerDemoInstrument(s,inst());markDemoAccount(s,{BTCUSDT:{mark:'50000',last:'50000'}},T);
    const book={timestamp:T,bids:[],asks:[{price:'50000',quantity:'1'}]};const snapshot=JSON.stringify(book);
    placeDemoOrder(s,{id:'m1',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'2',leverage:'10'},T);executeDemoBook(s,'m1',book,T);
    expect(JSON.stringify(book)).toBe(snapshot);expect(s.orders[0]).toMatchObject({filled:'1',status:'CANCELLED'});
  });
});
