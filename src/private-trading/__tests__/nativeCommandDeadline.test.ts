import { setup, actor, key, M, outcome } from '../native/testing/liveFixture';
import { CommandScope } from '../native/commandScope';
import { instructionDigest, recoverEmptyObservationCheckpoint, replayNativeDemoAsync } from '../native/replay';
import { setDemoCollateral } from '../native/engine';
import { NativeDemoService } from '../native/service';
import { PrivateMarketDataError } from '../marketData';

const draft=()=>({kind:'OPEN' as const,symbol:'BTCUSDT',side:'LONG' as const,type:'MARKET' as const,quantity:'0.002',leverage:'3',idempotencyKey:key()});
const scope=(kind='OPEN',ms=35)=>new CommandScope(kind,ms);
const never=()=>new Promise<never>(()=>{});
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));

describe('bounded native command lifecycle',()=>{
  beforeEach(()=>jest.spyOn(console,'info').mockImplementation(()=>{}));
  afterEach(()=>jest.restoreAllMocks());
  test.each(['instrument','freshQuote'] as const)('%s stall refuses with no late fill, and frees the lane',async method=>{
    const f=setup();await f.service.initialize(actor,key());const before=outcome(f.repo.row!.snapshot);
    const spy=jest.spyOn(f.market,method).mockImplementationOnce(never);
    await expect(f.service.command(actor,draft(),{scope:scope()})).rejects.toMatchObject({code:'native_command_timeout'});
    expect(outcome(f.repo.row!.snapshot)).toEqual(before);expect(f.repo.commits).toBe(0);expect(f.service.queued(actor.userId)).toBe(0);
    spy.mockRestore();await expect(f.service.command(actor,draft())).resolves.toMatchObject({revision:2});
  });
  test('late repository read after deadline cannot execute or write',async()=>{
    const f=setup();await f.service.initialize(actor,key());let resolve!:(v:any)=>void;
    jest.spyOn(f.repo,'read').mockImplementationOnce(()=>new Promise(r=>resolve=r));
    await expect(f.service.command(actor,draft(),{scope:scope()})).rejects.toMatchObject({code:'native_command_timeout'});
    resolve(structuredClone(f.repo.row));await delay(10);
    expect(f.market.calls.quote).toBe(0);expect(f.repo.commits).toBe(0);
  });
  test('collateral mark stall cannot silently become an unpriced successful order',async()=>{
    const f=setup();await f.service.initialize(actor,key());f.repo.wallet=[{asset:'ETH',available:'1',locked:'0'}];
    jest.spyOn(f.market,'marks').mockImplementationOnce(never);
    await expect(f.service.command(actor,draft(),{scope:scope()})).rejects.toMatchObject({code:'native_command_timeout'});
    expect(f.repo.commits).toBe(0);
  });
  test('queue expiry refuses before starting; never sends a late order after predecessor settles',async()=>{
    const f=setup();await f.service.initialize(actor,key());let release!:()=>void;
    const original=f.repo.prior.bind(f.repo);
    jest.spyOn(f.repo,'prior').mockImplementationOnce(async(...args)=>{await new Promise<void>(r=>release=r);return original(...args);});
    const first=f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()},{scope:scope('REFRESH',500)});
    await delay(5);
    await expect(f.service.command(actor,draft(),{scope:scope()})).rejects.toMatchObject({code:'native_command_timeout'});
    release();await first;await delay(5);expect(f.repo.commits).toBe(0);expect(f.market.calls.quote).toBe(0);
  });
  test('a provider timeout remains a refusal and is not retried as a new order',async()=>{
    const f=setup();await f.service.initialize(actor,key());
    const quote=jest.spyOn(f.market,'freshQuote').mockRejectedValue(new PrivateMarketDataError('market_data_timeout'));
    await expect(f.service.command(actor,draft())).rejects.toMatchObject({code:'market_data_timeout'});
    expect(quote).toHaveBeenCalledTimes(1);expect(f.repo.commits).toBe(0);
  });
  test('a committed receipt is never reported as an unexecuted order when collateral refresh stalls',async()=>{
    const f=setup();await f.service.initialize(actor,key());const request=draft();
    const confirmed=await f.service.command(actor,request),before=outcome(f.repo.row!.snapshot);
    f.repo.wallet=[{asset:'ETH',available:'1',locked:'0'}];
    const marks=jest.spyOn(f.market,'marks').mockImplementationOnce(never);
    await expect(f.service.command(actor,request,{scope:scope('OPEN',250)})).rejects.toMatchObject({code:'native_confirmation_unknown'});
    expect(marks).toHaveBeenCalledTimes(1);
    expect(f.repo.row!.revision).toBe(confirmed.revision);expect(f.repo.commits).toBe(1);
    expect(outcome(f.repo.row!.snapshot)).toEqual(before);
  });
  test('receipt lookup timeout cannot claim that an earlier execution did not happen',async()=>{
    const f=setup();await f.service.initialize(actor,key());const request=draft();await f.service.command(actor,request);
    jest.spyOn(f.repo,'prior').mockImplementationOnce(never);
    await expect(f.service.command(actor,request,{scope:scope()})).rejects.toMatchObject({code:'native_confirmation_unknown'});
    expect(f.repo.commits).toBe(1);
  });
});

async function closedHistorical(){
  const f=setup();await f.service.initialize(actor,key());const v=await f.service.command(actor,draft());f.step();
  await f.service.command(actor,{kind:'CLOSE',positionId:v.positions[0].id,idempotencyKey:key()});
  const row=f.repo.row!,open=row.commands.find(c=>c.kind==='OPEN')!;
  if(open.kind==='OPEN')open.order.historical=true;
  f.clock.t+=2*M;
  const result=await replayNativeDemoAsync({deposit:row.deposit,instructions:row.commands,asOf:f.clock.t},f.bars);
  row.snapshot=result.snapshot;row.checkpoint=result.checkpoint;
  return f;
}
describe('production empty OBSERVE checkpoint regression',()=>{
  beforeEach(()=>jest.spyOn(console,'info').mockImplementation(()=>{}));afterEach(()=>jest.restoreAllMocks());
  test('persisted empty-account refresh does not invalidate its own minute checkpoint',async()=>{
    const f=await closedHistorical();f.clock.t+=20*M;await f.refresh();
    const row=f.repo.row!;expect(row.checkpoint!.digest).toBe(instructionDigest(row.commands,row.checkpoint!.time));
    const before=f.market.calls.history;f.clock.t+=M;await f.refresh();expect(f.market.calls.history).toBe(before);
  });
  test('exact legacy suffix is recoverable without historical reads or financial changes; altered evidence is not',async()=>{
    const f=await closedHistorical(),row=f.repo.row!;
    const collateral={priced:'123',complete:true,asOf:f.clock.t};
    setDemoCollateral(row.snapshot,collateral);
    row.commands.push({kind:'OBSERVE',id:'legacy-empty',at:row.snapshot.time,seq:20,marks:{},observedAt:{},collateral});
    await expect(replayNativeDemoAsync({deposit:row.deposit,instructions:row.commands,asOf:f.clock.t,checkpoint:row.checkpoint},f.bars)).rejects.toMatchObject({code:'CHECKPOINT_MISMATCH'});
    const repaired=recoverEmptyObservationCheckpoint(row.checkpoint!,row.commands,row.snapshot);expect(repaired).not.toBeNull();
    const load=jest.fn(async()=>{throw new Error('must not load history');});
    const result=await replayNativeDemoAsync({deposit:row.deposit,instructions:row.commands,asOf:f.clock.t,checkpoint:repaired},load);
    expect(outcome(result.snapshot)).toEqual(outcome(row.snapshot));expect(load).not.toHaveBeenCalled();
    const changed=structuredClone(row);changed.commands[0].at++;
    expect(recoverEmptyObservationCheckpoint(row.checkpoint!,changed.commands,row.snapshot)).toBeNull();
    changed.snapshot.walletBalance='1';expect(recoverEmptyObservationCheckpoint(row.checkpoint!,row.commands,changed.snapshot)).toBeNull();
    const before=f.market.calls.history;
    // A new service is a reload/restart: no instance-local cache can hide the bug.
    const service=new NativeDemoService(f.repo,f.service['market'],f.clock.now);
    const v=await service.command(actor,draft());expect(v.positions).toHaveLength(1);expect(f.market.calls.history).toBe(before);
  });
});
