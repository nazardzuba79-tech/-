import { PrismaClient } from '@prisma/client';
import { PrismaNativeRepository,compact,revisionPayload,type NativeAccount } from '../native/store';
import { deriveNativeLiveProjection } from '../native/liveProjection';
import { setup,actor as fixtureActor,key } from '../native/testing/liveFixture';
import { randomUUID } from 'crypto';
import { createNativeLimitPass } from '../native/limitPass';
import { NativeDemoService } from '../native/service';
import type { PrivateTradingMarketData } from '../marketData';
import { assertHistoricalDemoCurrentPrice } from '../marketData';

const url=process.env.NATIVE_EGRESS_TEST_DATABASE_URL;
const pg=url?describe:describe.skip;
pg('native projection real PostgreSQL transactions and pagination',()=>{
  if(url){const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/voltex_native_egress_test')throw new Error('disposable localhost test database required');}
  const db=new PrismaClient({datasources:{db:{url:url??'postgresql://localhost/disabled'}},log:[{emit:'event',level:'query'}]});
  const actor={...fixtureActor,userId:'native-egress-pg-test',sessionId:'native-egress-pg-session'};
  const config=()=>({enabled:true,ownerId:actor.userId});
  const repo=new PrismaNativeRepository(db,config);
  let fixture:NativeAccount,queries:string[]=[];
  (db as any).$on('query',(e:{query:string})=>queries.push(e.query));
  beforeAll(async()=>{
    const f=setup();await f.service.initialize(fixtureActor,key());
    await f.service.command(fixtureActor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key()});
    fixture=structuredClone(f.repo.row!);
  });
  beforeEach(async()=>{
    actor.userId=randomUUID();actor.sessionId=randomUUID();
    await db.user.create({data:{id:actor.userId,email:`${actor.userId}@example.invalid`,referralCode:actor.userId,passwordHash:'TEST_ONLY',role:'ADMIN'}});
    await db.session.create({data:{id:actor.sessionId,userId:actor.userId}});
    await db.demoBalance.upsert({where:{userId_asset:{userId:actor.userId,asset:'USDT'}},create:{userId:actor.userId,asset:'USDT',available:'100000'},update:{available:'100000'}});
    await repo.initialize(actor,'initialize-test');queries=[];
  });
  afterAll(()=>db.$disconnect());
  test('successful commit atomically advances projection; steady reads have no journal/revisions/writes',async()=>{
    await repo.commit(actor,1,fixture,'commit-test','hash');
    queries=[];const p=await repo.live(actor);
    expect(p?.revision).toBe(2);expect(p).toEqual(deriveNativeLiveProjection({...fixture,revision:2}));
    const receipt=await db.nativeDemoRevision.findUniqueOrThrow({where:{userId_revision:{userId:actor.userId,revision:2}}});
    expect(receipt.payload).toEqual(JSON.parse(JSON.stringify(compact(revisionPayload({...fixture,revision:2})))));
    queries=[];await repo.live(actor);
    expect(queries.some(q=>q.includes('NativeDemoRevision'))).toBe(false);
    expect(queries.some(q=>q.includes('"NativeDemoAccount"."payload"'))).toBe(false);
    expect(queries.some(q=>/^(INSERT|UPDATE|DELETE)/.test(q))).toBe(false);
  });
  test('mark-only publication updates live projection without authority or immutable revision writes',async()=>{
    await repo.commit(actor,1,fixture,'projection-seed','hash');
    const authorityBefore=await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:actor.userId}});
    const revisionsBefore=await db.nativeDemoRevision.count({where:{userId:actor.userId}});
    const fresh=structuredClone({...fixture,revision:2});
    fresh.snapshot.positions[0].markPrice='54321';
    fresh.snapshot.positions[0].unrealizedPnl='4321';
    queries=[];
    await expect(repo.publishLive(actor,2,fresh)).resolves.toBe(true);
    const live=await repo.live(actor);
    expect(live?.positions[0]).toMatchObject({markPrice:'54321',unrealizedPnl:'4321'});
    expect(await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:actor.userId}})).toEqual(authorityBefore);
    expect(await db.nativeDemoRevision.count({where:{userId:actor.userId}})).toBe(revisionsBefore);
    expect(queries.some(q=>q.includes('UPDATE "public"."NativeDemoAccount"'))).toBe(false);
    expect(queries.some(q=>q.includes('INSERT INTO "public"."NativeDemoRevision"'))).toBe(false);
    // A stale worker can never overwrite the projection after authority moved.
    await repo.commit(actor,2,{...fixture,disabledCollateralAssets:['ETH']},'authority-moved','hash2');
    await expect(repo.publishLive(actor,2,fresh)).resolves.toBe(false);
    expect((await repo.live(actor))?.revision).toBe(3);
  });
  test('command context retains both authorization checks with one joined DB read each',async()=>{
    queries=[];await repo.commandContext(actor,'new-key','new-hash');
    expect(queries.filter(q=>q.includes('FROM "User"'))).toHaveLength(2);
    expect(queries.filter(q=>q.includes('FROM "public"."Session"'))).toHaveLength(0);
    expect(queries.filter(q=>q.includes('NativeDemoRevision'))).toHaveLength(1);
    expect(queries.filter(q=>q.includes('NativeDemoAccount'))).toHaveLength(1);
  });
  test.each(['blocked','wrong-role','revoked'])('%s actor cannot commit or create a receipt',async variant=>{
    if(variant==='blocked')await db.user.update({where:{id:actor.userId},data:{blockedAt:new Date()}});
    if(variant==='wrong-role')await db.user.update({where:{id:actor.userId},data:{role:'USER'}});
    if(variant==='revoked')await db.session.update({where:{id:actor.sessionId},data:{revokedAt:new Date()}});
    const before=await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:actor.userId}});
    await expect(repo.commit(actor,1,fixture,`denied-${variant}`,'hash')).rejects.toMatchObject({code:'private_access_denied'});
    expect(await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:actor.userId}})).toEqual(before);
    expect(await db.nativeDemoRevision.count({where:{userId:actor.userId}})).toBe(1);
  });
  test('revocation after projection write is caught by final authorization and rolls back all writes',async()=>{
    await db.$executeRawUnsafe(`CREATE FUNCTION native_test_revoke_session() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE "Session" SET "revokedAt"=now() WHERE "userId"=NEW."userId"; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER native_test_revoke_session AFTER UPDATE ON "NativeDemoLiveProjection"
      FOR EACH ROW EXECUTE FUNCTION native_test_revoke_session()`);
    try{
      const before=await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:actor.userId}});
      await expect(repo.commit(actor,1,fixture,'revoke-during-commit','hash')).rejects.toMatchObject({code:'private_access_denied'});
      expect(await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:actor.userId}})).toEqual(before);
      expect(await db.nativeDemoRevision.count({where:{userId:actor.userId}})).toBe(1);
      expect((await db.nativeDemoLiveProjection.findUniqueOrThrow({where:{userId:actor.userId}})).revision).toBe(1);
    }finally{
      await db.$executeRawUnsafe('DROP TRIGGER native_test_revoke_session ON "NativeDemoLiveProjection"');
      await db.$executeRawUnsafe('DROP FUNCTION native_test_revoke_session()');
    }
  });
  test('projection write failure rolls back authority AND immutable revision',async()=>{
    await repo.commit(actor,1,fixture,'commit-test','hash');
    // NOT VALID applies to this test's new write without scanning unrelated fixtures.
    await db.$executeRawUnsafe('ALTER TABLE "NativeDemoLiveProjection" ADD CONSTRAINT "native_test_reject_three" CHECK ("revision" <> 3) NOT VALID');
    try{
      await expect(repo.commit(actor,2,fixture,'commit-rejected','hash2')).rejects.toThrow();
      expect((await repo.read(actor))?.revision).toBe(2);
      expect(await repo.revision(actor,3)).toBeNull();expect((await repo.live(actor))?.revision).toBe(2);
    }finally{await db.$executeRawUnsafe('ALTER TABLE "NativeDemoLiveProjection" DROP CONSTRAINT "native_test_reject_three"');}
  });
  test('final 60s price guard rolls back account, receipt and projection together after their SQL writes',async()=>{
    const before=await repo.read(actor),projection=await repo.live(actor),now=Date.now();let checks=0;
    const quote={symbol:'BTCUSDT',markPrice:'81000',lastPrice:'81000',markProviderTimestamp:now,receivedAt:now,fetchedAt:now};
    queries=[];
    await expect(repo.commit(actor,1,fixture,'expired-final-guard','hash',()=>{
      assertHistoricalDemoCurrentPrice(quote,'BTCUSDT',now+(++checks===3?60001:0));
    })).rejects.toMatchObject({code:'near_live_price_stale'});
    expect(checks).toBe(3);
    expect(queries.some(q=>q.includes('INSERT INTO "public"."NativeDemoRevision"'))).toBe(true);
    expect(queries.some(q=>q.includes('INSERT INTO "public"."NativeDemoLiveProjection"'))).toBe(true);
    expect(await repo.read(actor)).toEqual(before);expect(await repo.live(actor)).toEqual(projection);
    expect(await repo.prior(actor,'expired-final-guard','hash')).toBeNull();
    expect(await db.nativeDemoRevision.count({where:{userId:actor.userId}})).toBe(1);
  });
  test.each(['missing','corrupt','stale'])('%s projection rebuilds from authority without financial writes',async variant=>{
    await repo.commit(actor,1,fixture,'commit-test','hash');
    const before=await db.nativeDemoAccount.findUnique({where:{userId:actor.userId}});
    if(variant==='missing')await db.nativeDemoLiveProjection.delete({where:{userId:actor.userId}});
    else await db.nativeDemoLiveProjection.update({where:{userId:actor.userId},data:variant==='corrupt'?{payload:{walletBalance:'invented'}}:{revision:1}});
    queries=[];expect((await repo.live(actor))?.revision).toBe(2);
    expect(await db.nativeDemoAccount.findUnique({where:{userId:actor.userId}})).toEqual(before);
    expect(await db.nativeDemoRevision.count({where:{userId:actor.userId}})).toBe(2);
    expect(queries.some(q=>/^(INSERT INTO|UPDATE) "public"\."(NativeDemoAccount|NativeDemoRevision|DemoBalance)"/.test(q))).toBe(false);
  });
  test('keyset history is complete, ordered and pinned when new authority commits',async()=>{
    const row=structuredClone(fixture);
    row.snapshot.events=Array.from({length:123},(_,i)=>({...fixture.snapshot.events[0],id:`event-${i}`,time:1_000+Math.floor(i/3)}));
    await repo.commit(actor,1,row,'history-seed','hash');
    const ids:string[]=[],times:number[]=[];let cursor:string|undefined;
    do{
      const page=await repo.history(actor,{kind:'events',revision:2,limit:50,cursor});
      expect(page.items.length).toBeLessThanOrEqual(50);
      for(const item of page.items as {id:string;time:number}[]){ids.push(item.id);times.push(item.time);}
      cursor=page.nextCursor??undefined;
      if(ids.length===50)await repo.commit(actor,2,fixture,'new-revision','next');
    }while(cursor);
    expect(ids).toHaveLength(123);expect(new Set(ids).size).toBe(123);
    expect(times).toEqual([...times].sort((a,b)=>b-a));
    expect(ids[0]).toBe('event-122');expect(ids.at(-1)).toBe('event-0');
    expect((await repo.history(actor,{kind:'events',revision:2,limit:50,symbol:'ETHUSDT'})).items).toEqual([]);
    const entries=await repo.history(actor,{kind:'entries',revision:2,limit:50});
    expect(Object.keys(entries.items[0] as object).sort()).toEqual(['candle','positionId']);
  });
  test('executor cache verifies revision each time, isolates mutation, invalidates on commit',async()=>{
    await repo.commit(actor,1,fixture,'cache-seed','hash');
    const cached=new PrismaNativeRepository(db,config,true);
    const first=await cached.commandContext(actor,'not-yet-committed','h');first.row!.snapshot.walletBalance='0';
    queries=[];const second=await cached.commandContext(actor,'not-yet-committed','h');
    expect(second.row!.snapshot.walletBalance).toBe(fixture.snapshot.walletBalance);
    expect(queries.some(q=>q.includes('"NativeDemoAccount"."payload"'))).toBe(false);
    await repo.commit(actor,2,{...fixture,disabledCollateralAssets:['ETH']},'cache-new','hash2');
    expect((await cached.commandContext(actor,'another-new-key','h')).row?.disabledCollateralAssets).toEqual(['ETH']);
    await db.session.update({where:{id:actor.sessionId},data:{revokedAt:new Date()}});
    try{await expect(cached.commandContext(actor,'another-new-key','h')).rejects.toMatchObject({code:'private_access_denied'});}
    finally{await db.session.update({where:{id:actor.sessionId},data:{revokedAt:null}});}
  });
  test('server selector includes historical-only accounts even with legacy executionPending=false',async()=>{
    const f=setup({at:Date.now()-10_000});
    const at=Math.floor(f.clock.t/60_000)*60_000-120_000;
    jest.spyOn(f.market as any,'resolveCandle').mockResolvedValue({symbol:'BTCUSDT',source:'BYBIT_LINEAR',interval:'1m',intervalMs:60_000,
      openTime:at,closeTime:at+60_000,effectiveAt:at,price:'50000',pricePoint:'OPEN',
      candle:{timestamp:at,open:'50000',high:'50000',low:'50000',close:'50000',volume:'1'},fetchedAt:f.clock.t,verification:'VERIFIED'});
    const service=new NativeDemoService(repo,f.market as unknown as PrivateTradingMarketData,f.clock.now);
    const v=await service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',
      candle:{source:'BYBIT_LINEAR',interval:'1m',openTime:at,pricePoint:'OPEN'},idempotencyKey:'historical-open'});
    expect(v.positions[0].historical).toBe(true);
    expect((await repo.read(actor))?.executionPending).toBe(false);
    await repo.activate(actor);
    f.clock.t=Date.now();queries=[];
    const worker=createNativeLimitPass(db,f.market as unknown as PrivateTradingMarketData,config);
    await worker.tick();await worker.stop();
    expect(worker.failures).toBe(0);
    expect(queries.some(q=>q.includes('NativeDemoRevision'))).toBe(true); // command idempotency check proves admission
    expect((await service.live(actor)).positions[0].historical).toBe(true);
  });
});
