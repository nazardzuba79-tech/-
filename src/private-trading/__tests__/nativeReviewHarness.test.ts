import { resolve } from 'path';
// Exercise the actual isolated adapter against the same built helpers as its server.
const { ReviewRepository } = require(resolve('scripts/native-demo-review-repository.cjs'));
const { deriveNativeLiveProjection } = require(resolve('dist/private-trading/native/liveProjection'));
const { setup, actor, key } = require(resolve('dist/private-trading/native/testing/liveFixture'));

describe('isolated review repository live contract',()=>{
  let session:any,repo:any,save:jest.Mock;
  beforeEach(async()=>{
    const f=setup();await f.service.initialize(actor,key());
    const opened=await f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key()});
    f.clock.t+=5001;await f.service.command(actor,{kind:'CLOSE',positionId:opened.positions[0].id,idempotencyKey:key()});
    const row=structuredClone(f.repo.row);
    session={userId:actor.userId,row,revisions:{[row.revision]:structuredClone(row)},commands:{}};
    save=jest.fn();repo=new ReviewRepository({session:(id:string)=>id===actor.sessionId?session:null,save,now:f.clock.now,walletBtc:'2'});
  });
  test('live matches production derivation without balance, command, revision or persistence writes',async()=>{
    const before=structuredClone(session),live=await repo.live(actor);
    expect(live).toEqual(deriveNativeLiveProjection(session.row));expect(live.revision).toBe(session.row.revision);
    expect(live.state.positions).toEqual([]);expect(live.state.events).toEqual([]);
    live.state.walletBalance='0';expect(session).toEqual(before);expect(save).not.toHaveBeenCalled();
    session.row=null;expect(await repo.live(actor)).toBeNull();
  });
  test('activate only persists admission; absent account stays absent; wrong session denied',async()=>{
    const before=structuredClone(session);await repo.activate(actor);
    expect(session.executionSession).toEqual(actor);
    expect({...session,executionSession:undefined}).toEqual({...before,executionSession:undefined});
    expect(save).toHaveBeenCalledTimes(1);
    await expect(repo.live({...actor,sessionId:'another'})).rejects.toThrow('Denied');
    session.row=null;await repo.activate(actor);expect(save).toHaveBeenCalledTimes(1);
  });
  test.each(['events','positions','orders','entries'])('%s pages are pinned, complete and ordered with production cursors',async(kind:string)=>{
    const row=session.row,revision=row.revision;
    const original=kind==='entries'?row.commands.find((c:any)=>c.kind==='OPEN'):row.snapshot[kind][0];
    const values=Array.from({length:123},(_,i)=>({...original,id:`row-${i}`,time:1000+Math.floor(i/3),closedAt:1000+Math.floor(i/3),createdAt:1000+Math.floor(i/3),at:1000+Math.floor(i/3),...(kind==='entries'?{order:{...original.order,id:`row-${i}`}}:{})}));
    if(kind==='entries')row.commands=values;else row.snapshot[kind]=values;
    session.revisions[revision]=structuredClone(row);
    let cursor:undefined|string,items:any[]=[];
    do{
      const page=await repo.history(actor,{kind,revision,limit:50,cursor});expect(page.items.length).toBeLessThanOrEqual(50);
      items.push(...page.items);cursor=page.nextCursor??undefined;
      if(cursor){const c=JSON.parse(Buffer.from(cursor,'base64url').toString());expect(c).toMatchObject({kind,revision,symbol:''});}
      session.row={...row,revision:revision+1};
    }while(cursor);
    expect(items.map(v=>kind==='entries'?v.positionId:v.id)).toEqual(values.map(v=>v.id).reverse());
    expect((await repo.history(actor,{kind,revision,limit:50,symbol:'ETHUSDT'})).items).toEqual([]);
    await expect(repo.history(actor,{kind,revision:999,limit:50})).rejects.toMatchObject({code:'history_revision_missing'});
    await expect(repo.history(actor,{kind,revision,limit:50,cursor:'malformed'})).rejects.toMatchObject({code:'invalid_history_cursor'});
    const first=await repo.history(actor,{kind,revision,limit:50});
    await expect(repo.history(actor,{kind,revision,limit:50,symbol:'ETHUSDT',cursor:first.nextCursor})).rejects.toMatchObject({code:'invalid_history_cursor'});
    expect(save).not.toHaveBeenCalled();
  });
});
