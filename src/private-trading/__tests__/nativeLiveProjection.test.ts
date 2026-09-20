import { setup,actor,key,outcome,H,H0,M } from '../native/testing/liveFixture';
import { deriveNativeLiveProjection,projectionDigest,verifiedProjection } from '../native/liveProjection';
import { NativeDemoService } from '../native/service';
import { NativeLimitPass } from '../native/limitPass';
import type { NativeRepository } from '../native/store';
import type { PrivateTradingMarketData } from '../marketData';

async function prepared(marginType:'CROSS'|'ISOLATED'='CROSS'){
  const f=setup();await f.service.initialize(actor,key());
  await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',marginType,idempotencyKey:key()});
  const repo:NativeRepository={...f.repo,live:async()=>deriveNativeLiveProjection(f.repo.row!),holdings:()=>f.repo.holdings(),
    read:jest.fn(async()=>{throw new Error('full account read forbidden');}),revision:jest.fn(async()=>{throw new Error('revision read forbidden');}),
    prior:jest.fn(),initialize:jest.fn(),commit:jest.fn(),available:jest.fn()};
  const live=new NativeDemoService(repo,f.market as unknown as PrivateTradingMarketData,f.clock.now);
  return{...f,live,liveRepo:repo};
}
describe('compact native live read model',()=>{
  test.each(['CROSS','ISOLATED'] as const)('%s revaluation exactly equals existing display helpers; no financial writes/full reads',async mode=>{
    const f=await prepared(mode);f.step();f.market.price='51000';
    const before=JSON.stringify(f.repo.row);
    const expected=await f.refresh(),actual=await f.live.live(actor);
    expect(actual.account).toEqual(expected.account);expect(actual.positions).toEqual(expected.positions);
    expect(actual.ledger).toEqual({...expected.ledger,entries:[]});
    expect(JSON.stringify(f.repo.row)).toBe(before);
    expect(f.liveRepo.read).not.toHaveBeenCalled();expect(f.liveRepo.revision).not.toHaveBeenCalled();expect(f.liveRepo.commit).not.toHaveBeenCalled();
    expect(actual.revision).toBe(f.repo.row!.revision);
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
  });
  test('funding and protection remain executor work, pure live never settles even across boundary',async()=>{
    const f=await prepared();f.clock.t=H0+8*H+2*M;
    const old=JSON.stringify(f.repo.row);await f.live.live(actor);expect(JSON.stringify(f.repo.row)).toBe(old);
    const worker=new NativeLimitPass(f.service,async()=>[actor],f.clock.now);await worker.tick();
    expect(f.repo.row!.snapshot.events.some(e=>e.kind==='FUNDING')).toBe(true);
    expect((await f.live.live(actor)).account).toEqual((await f.service.state(actor)).account);
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
  });
  test('bounded response excludes large journal, closed history, events and checkpoint',async()=>{
    const f=await prepared();const row=f.repo.row!;
    // Deliberately huge historical payload. Projection must not spread it.
    row.commands=Array.from({length:2000},()=>structuredClone(row.commands[0]));
    row.snapshot.positions.push(...Array.from({length:1000},(_,i)=>({...row.snapshot.positions[0],id:`closed-${i}`,status:'CLOSED' as const,closedAt:f.clock.t})));
    const p=deriveNativeLiveProjection(row),v=await f.live.live(actor);
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(25_000);
    expect(Buffer.byteLength(JSON.stringify(v))).toBeLessThan(25_000);
    expect(Buffer.byteLength(JSON.stringify(v))).toBeLessThan(50_000);
    expect(v.history).toEqual([]);expect(v.events).toEqual([]);expect(v.ledger?.entries).toEqual([]);
    expect(p.state.positions).toHaveLength(1);expect(p.state.events).toEqual([]);
    for(const forbidden of ['commands','checkpoint','executionSession','instrumentTable'])expect(JSON.stringify(v)).not.toContain(`"${forbidden}"`);
    expect(v.orders.every(o=>['OPEN','PARTIALLY_FILLED'].includes(o.status))).toBe(true);
  });
  test('digest rejects corruption and revision mismatch, accepts JSONB key reordering',async()=>{
    const f=await prepared(),p=deriveNativeLiveProjection(f.repo.row!),hash=projectionDigest(p);
    expect(verifiedProjection(p,hash,p.revision)).toEqual(p);
    expect(verifiedProjection({...p,revision:p.revision+1},hash,p.revision)).toBeNull();
    expect(verifiedProjection(p,hash,p.revision+1)).toBeNull();
    expect(verifiedProjection({...p,state:{...p.state,walletBalance:'999999'}},hash,p.revision)).toBeNull();
    expect(projectionDigest(Object.fromEntries(Object.entries(p).reverse()))).toBe(hash);
  });
});
