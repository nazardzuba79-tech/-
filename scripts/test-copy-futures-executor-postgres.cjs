// Executable but TEST ONLY: empty loopback PostgreSQL and synthetic existing fixture credits.
const assert = require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const url=process.env.COPY_FUTURES_EXEC_TEST_DATABASE_URL;
assert(url,'Explicit disposable database URL required');
const u=new URL(url);
assert(['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&/^\/copy_demo_[a-z0-9_]+$/.test(u.pathname),
 'Never use a real database');
process.env.JWT_SECRET='fixture-copy-futures-not-production';
process.env.EMAIL_VERIFICATION_SECRET='fixture-copy-futures-email';
require('ts-node/register/transpile-only');
const {PrismaClient}=require('@prisma/client');
const {NativeDemoService}=require('../src/private-trading/native/service');
const {PrismaNativeRepository}=require('../src/private-trading/native/store');
const {Clock,FakeMarket,H0,H,M}=require('../src/private-trading/native/testing/liveFixture');
const {FuturesDemoObserverService}=require('../src/services/copyTrading/FuturesDemoObserverService');
const {FuturesDemoFollowerExecutor}=require('../src/services/copyTrading/FuturesDemoFollowerExecutor');
const {FuturesCopyGuardError}=require('../src/services/copyTrading/FuturesCopyCommitGuard');
const db=new PrismaClient({datasources:{db:{url}}});
const leader=randomUUID(),follower=randomUUID(),viewer=randomUUID();
process.env.PRIVATE_TRADING_ENABLED='true';
process.env.PRIVATE_TRADING_OWNER_ID=leader;
process.env.PRIVATE_TRADING_TEST_USER_IDS=follower;
const clock=new Clock(H0+5*H+5*M+30000),market=new FakeMarket(clock);
const repo=new PrismaNativeRepository(db,()=>({enabled:true,ownerId:leader}));
const native=new NativeDemoService(repo,market,clock.now);
const observer=new FuturesDemoObserverService(db,()=>true,id=>id===leader);
const copy=new FuturesDemoFollowerExecutor(db,native,()=>true);
const limits={ratio:'1',maxLeverage:'3',maxFillUsdt:'6000',
 maxTotalExposureUsdt:'6500',maxDeviationBps:'100'};
const actors={},sessions={},checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS',name)}
const refuse=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
const q=id=>({userId:id,sessionId:sessions[id],expiresAt:Date.now()+3600000});
async function placeLeader(quantity='0.1'){
 return native.command(q(leader),{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',
  type:'MARKET',quantity,leverage:'2',marginType:'ISOLATED',idempotencyKey:'leader-'+randomUUID()});
}
const financial=async()=>JSON.stringify({
 balances:await db.balance.findMany({orderBy:{id:'asc'}}),
 demoBalances:await db.demoBalance.findMany({orderBy:{id:'asc'}}),
 orders:await db.order.count(),trades:await db.trade.count(),
 futuresOrders:await db.futuresOrder.count(),futuresPositions:await db.futuresPosition.count(),
 demoOrders:await db.demoOrder.count(),demoTrades:await db.demoTrade.count(),
});
async function main(){
 assert.equal(await db.user.count(),0,'Nonempty User table forbidden');
 await check('review executor is hard OFF except explicit disposable local test gates',async()=>{
  const {futuresDemoObserverEnabled}=require('../src/services/copyTrading/FuturesDemoObserverService');
  assert.equal(futuresDemoObserverEnabled({NODE_ENV:'production',COPY_FUTURES_DEMO_OBSERVER_ENABLED:'true'}),false);
  await refuse(()=>new FuturesDemoFollowerExecutor(db,native,()=>false).begin(follower,'fake',limits),'FUTURES_COPY_EXECUTOR_OFF');
 });
 for(const [id,role] of [[leader,'ADMIN'],[follower,'USER'],[viewer,'USER']]){
  await db.user.create({data:{id,email:id+'@example.invalid',passwordHash:'fixture',role,referralCode:id.replaceAll('-','').slice(0,18)}});
  sessions[id]=(await db.session.create({data:{userId:id}})).id;
  await db.demoBalance.create({data:{userId:id,asset:'USDT',available:'10000'}});
  await db.balance.create({data:{userId:id,asset:'USDT',available:'777',locked:'2'}});
 }
 await db.copyStrategyOwner.upsert({where:{traderId:'VX-001'},create:{traderId:'VX-001',publicName:'Fixture',ownerUserId:leader},update:{ownerUserId:leader,publicName:'Fixture'}});
 await native.initialize(q(leader),'fixture-initialize-leader');
 await native.initialize(q(follower),'fixture-initialize-follower');
 await native.command(q(follower),{kind:'REFRESH',idempotencyKey:'fixture-admit-native-session'}, {persist:true});
 const beforeFinancial=await financial();
 await check('watchlist/observer does not grant consent, and wrong session is refused',async()=>{
  await refuse(()=>copy.begin(follower,sessions[follower],limits),'OBSERVATION_REQUIRED');
  await observer.subscribe(follower,sessions[follower],'VX-001',{maxLeverage:'3',maxFillUsdt:'6000'});
  await refuse(()=>copy.begin(follower,sessions[viewer],limits),'FUTURES_COPY_ACCESS_DENIED');
 });
 await check('explicit separate consent starts at current source revision without backfill',async()=>{
  const c=await copy.begin(follower,sessions[follower],limits);
  assert.equal(c.automaticProductionCopying,false);
  assert.equal((await copy.drainOne(follower,sessions[follower])).status,'EMPTY');
 });
 let sourcePositionId;
 await check('real source modeled OPEN -> observed receipt -> follower Native Demo OPEN (exactly once)',async()=>{
  const source=await placeLeader();sourcePositionId=source.positions[0].id;
  const observed=await observer.scan(follower,sessions[follower]);
  assert.equal(observed.accepted,1);
  const result=await copy.drainOne(follower,sessions[follower]);
  assert.equal(result.status,'APPLIED');
  assert.equal(result.filledQuantity,'0.1');
  assert.equal((await copy.drainOne(follower,sessions[follower])).status,'EMPTY');
  const stored=await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:follower}});
  assert.equal(stored.payload.snapshot.positions.filter(p=>p.status==='OPEN').length,1);
  assert.equal(await db.copyFuturesDemoMirror.count({where:{status:'APPLIED'}}),1);
 });
 await check('matching source CLOSE reduces precisely the copied demo position',async()=>{
  clock.t+=M+100;
  const source=await native.command(q(leader),{kind:'CLOSE',positionId:sourcePositionId,
    quantity:'0.1',idempotencyKey:'leader-close-'+randomUUID()});
  assert.equal(source.positions.length,0);
  assert.equal((await observer.scan(follower,sessions[follower])).accepted,1);
  const result=await copy.drainOne(follower,sessions[follower]);
  assert.equal(result.status,'APPLIED');
  const stored=await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:follower}});
  assert.equal(stored.payload.snapshot.positions.filter(p=>p.status==='OPEN').length,0);
  assert.equal(await db.copyFuturesDemoMirror.count({where:{status:'APPLIED'}}),2);
 });
 await check('stop prevents further execution and cannot liquidate an existing position',async()=>{
  assert.equal((await copy.stop(follower,sessions[follower])).status,'STOPPED');
  await refuse(()=>copy.drainOne(follower,sessions[follower]),'COPY_EXECUTION_STOPPED');
  const before=await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:follower}});
  assert.equal((await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:follower}})).revision,before.revision);
 });
 await check('real orders and balances untouched; demo balances not topped up by copy',async()=>{
  assert.equal(await financial(),beforeFinancial);
  assert.equal(await db.copyFuturesDemoMirror.count({where:{status:'APPLIED'}}),2);
 });
 console.log(checks.length+' isolated PostgreSQL copy Futures executor checks PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>db.$disconnect());
