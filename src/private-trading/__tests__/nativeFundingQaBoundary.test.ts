import { setup, actor, key, M, H, H0 } from '../native/testing/liveFixture';
const settledBoundaries: (openedAt:number,heldUntil:number,observedAt:number)=>number[] = require('../../../scripts/native-funding-qa-boundaries.cjs');

test('browser QA expects funding only once the engine has the completed boundary candle',async()=>{
  const boundary=H0+8*H;
  const f=setup({at:boundary-M});
  await f.service.initialize(actor,key());
  const opened=await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key()});
  const openedAt=opened.positions[0].openedAt;
  for(const offset of [1,59_999,60_000,2*M]){
    f.clock.t=boundary+offset; await f.refresh();
    const actual=f.repo.row!.snapshot.events.filter(e=>e.kind==='FUNDING').map(e=>e.time);
    expect(settledBoundaries(openedAt,f.clock.t,f.clock.t)).toEqual(actual);
    expect(actual).toHaveLength(offset<M?0:1);
  }
});

test('a close during the forming minute still owes the original quantity after completion',async()=>{
  const boundary=H0+8*H;
  const f=setup({at:boundary-M}); await f.service.initialize(actor,key());
  const opened=await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key()});
  const openedAt=opened.positions[0].openedAt,closedAt=boundary+1000;
  f.clock.t=closedAt;
  await f.service.command(actor,{kind:'CLOSE',positionId:opened.positions[0].id,quantity:'0.2',idempotencyKey:key()});
  expect(settledBoundaries(openedAt,closedAt,f.clock.t)).toEqual(f.repo.row!.snapshot.events.filter(e=>e.kind==='FUNDING').map(e=>e.time));
  f.clock.t=boundary+2*M; await f.refresh();
  const funding=f.repo.row!.snapshot.events.filter(e=>e.kind==='FUNDING');
  expect(settledBoundaries(openedAt,closedAt,f.clock.t)).toEqual(funding.map(e=>e.time));
  expect(funding).toHaveLength(1);
  expect(funding[0]).toMatchObject({time:boundary,quantity:'1',cashflow:'-50'});
});
