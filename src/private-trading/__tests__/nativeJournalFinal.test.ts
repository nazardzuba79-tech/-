import { NativeDemoService } from '../native/service';
import { replayNativeDemoAsync, replayNativeDemoWithBars } from '../native/replay';
import { setup, actor, key, outcome, M, bn } from '../native/testing/liveFixture';
import type { PrivateTradingMarketData } from '../marketData';

const open=(f:ReturnType<typeof setup>,extra:Record<string,unknown>={})=>f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key(),...extra});
function hostileHistory(f:ReturnType<typeof setup>){
  const original=f.market.history.bind(f.market);
  f.market.history=async r=>{
    const h=await original(r);
    for(const c of [...h.tradeCandles,...h.markCandles]){c.low='1';c.high='100000';}
    return h;
  };
}
const financial=(s:Awaited<ReturnType<ReturnType<typeof setup>['replay']>>)=>({...outcome(s),marks:s.marks});

describe('final journal regressions: recorded decisions survive closed candles',()=>{
  test('new exposure is admitted on fresh marks of the OTHER contracts, not their old entries',async()=>{
    const f=setup({deposit:'10000'});await f.service.initialize(actor,key());await open(f);
    const before=structuredClone(f.repo.row);f.step();f.market.price='45000';
    await expect(open(f,{symbol:'ETHUSDT',quantity:'0.2'})).rejects.toMatchObject({code:'INSUFFICIENT_DEMO_MARGIN'});
    expect(f.repo.row).toEqual(before);
  });
  test('a pending stop remainder cannot be replaced by new protection',async()=>{
    const f=setup({price:'101'});await f.service.initialize(actor,key());await open(f,{protection:{stopLoss:'100',triggerBy:'LAST'}});
    f.step();f.market.price='100';f.market.bids=[{price:'99',quantity:'0.2'}];await f.refresh();
    const p=f.repo.row!.snapshot.positions[0],before=structuredClone(f.repo.row);
    await expect(f.service.command(actor,{kind:'PROTECTION',positionId:p.id,protection:{stopLoss:'90'},idempotencyKey:key()})).rejects.toMatchObject({code:'PROTECTION_CLOSE_PENDING'});
    expect(f.repo.row).toEqual(before);
  });
  test('a historical position on the same contract cannot overwrite a live position observation',async()=>{
    const f=setup();await f.service.initialize(actor,key());await open(f,{marginType:'ISOLATED'});
    const live=f.repo.row!.commands.find(c=>c.kind==='OPEN')!;
    if(live.kind!=='OPEN')throw new Error('missing OPEN');
    const historic={...structuredClone(live),id:'historic',seq:100,order:{...live.order,id:'historic',historical:true},point:'50000',book:undefined};
    const start=Math.floor(live.at/M)*M;
    const candle={timestamp:start,open:'50000',high:'50100',low:'49900',close:'50050'};
    const result=replayNativeDemoWithBars({deposit:'100000',instructions:[live,historic],asOf:start+2*M,bars:{BTCUSDT:[0,1].map(i=>({time:start+i*M,intervalMs:M,trade:{...candle,timestamp:start+i*M},mark:{...candle,timestamp:start+i*M}}))}});
    expect(result.snapshot.positions.find(p=>!p.historical)).toMatchObject({status:'OPEN',markPrice:live.mark,lastPrice:live.last});
  });
  test('a completed candle wick cannot liquidate or trigger a live position, even from an empty checkpoint',async()=>{
    const f=setup();await f.service.initialize(actor,key());
    await open(f,{marginType:'ISOLATED',protection:{stopLoss:'49000',takeProfit:'51000',triggerBy:'LAST'}});
    hostileHistory(f);
    const stored=financial(f.repo.row!.snapshot);
    f.clock.t=(Math.floor(f.clock.t/M)+2)*M+100;
    for(const mode of ['FULL','CHECKPOINT'] as const)expect(financial(await f.replay(mode))).toEqual(stored);
  });
  test('partial stop fills retain one action, fees and pending quantity across a closed minute and another instance',async()=>{
    const f=setup({price:'101'});await f.service.initialize(actor,key());
    await open(f,{protection:{stopLoss:'100',triggerBy:'LAST'}});
    f.step();f.market.price='100';f.market.bids=[{price:'99',quantity:'0.2'},{price:'98',quantity:'0.3'}];
    await f.refresh();const stored=financial(f.repo.row!.snapshot);
    expect(stored.positions[0].pendingClose?.quantity).toBe('0.5');
    expect(stored.events.filter(e=>e.kind==='STOP_LOSS').map(e=>[e.price,e.quantity])).toEqual([['99','0.2'],['98','0.3']]);
    hostileHistory(f);f.clock.t=(Math.floor(f.clock.t/M)+1)*M+100;
    for(const mode of ['FULL','CHECKPOINT'] as const)expect(financial(await f.replay(mode))).toEqual(stored);
    f.market.bids=[{price:'97',quantity:'0.5'}];
    const other=new NativeDemoService(f.repo,f.market as unknown as PrivateTradingMarketData,f.clock.now);
    const v=await other.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.positions).toHaveLength(0);expect(v.history[0]).toMatchObject({quantity:'0',pendingClose:null});
    const fills=v.events.filter(e=>e.kind==='STOP_LOSS');
    expect(new Set(fills.map(e=>e.actionId)).size).toBe(1);
    const exitNotional=bn(99).times('.2').plus(bn(98).times('.3')).plus(bn(97).times('.5'));
    expect(v.history[0].realizedGross).toBe(exitNotional.minus('101.1').toFixed());
    expect(v.history[0].closingFees).toBe(exitNotional.times('.00055').toFixed());
    expect(financial(await f.replay('FULL'))).toEqual(financial(f.repo.row!.snapshot));
    expect(v.ledger?.reconciled).toBe(true);
  });
  test('a card freezes silent valuation changes in the journal, including collateral, without a fill',async()=>{
    const f=setup();f.repo.wallet=[{asset:'ETH',available:'2',locked:'0'}];await f.service.initialize(actor,key());
    const v=await open(f);f.step();f.market.price='50100';
    await f.service.card(actor,v.positions[0].id);
    expect(f.repo.row!.commands.at(-1)).toMatchObject({kind:'OBSERVE',collateral:{priced:'100200'}});
    for(const mode of ['FULL','CHECKPOINT'] as const)expect(financial(await f.replay(mode))).toEqual(financial(f.repo.row!.snapshot));
  });
  test('an unchanged command id with altered decision inputs invalidates the checkpoint',async()=>{
    const f=setup();await f.service.initialize(actor,key());await open(f);
    f.clock.t=(Math.floor(f.clock.t/M)+1)*M+100;
    await f.service.card(actor,f.repo.row!.snapshot.positions[0].id);
    const row=structuredClone(f.repo.row!);const command=row.commands.find(c=>c.kind==='OPEN')!;
    if(command.kind==='OPEN')command.mark='1';
    await expect(replayNativeDemoAsync({deposit:row.deposit,instructions:row.commands,asOf:f.clock.t,checkpoint:row.checkpoint},async()=>[])).rejects.toMatchObject({code:'CHECKPOINT_MISMATCH'});
  });
});
