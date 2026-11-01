// Automatic Futures copy (worker) on disposable loopback PostgreSQL only.
// Leader Native Demo trades -> FuturesCopyWorker.pass() -> follower Native Demo, with no follower click.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=process.env.COPY_FUTURES_AUTO_TEST_DATABASE_URL;
assert(url,'Explicit disposable database URL required');
const u=new URL(url);
assert(['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&/^\/copy_demo_[a-z0-9_]+$/.test(u.pathname),'Never use a real database');
const leader=randomUUID(),follower=randomUUID(),mixed=randomUUID();
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:url,JWT_SECRET:'fixture-copy-auto',EMAIL_VERIFICATION_SECRET:'fixture-copy-auto',
 COPY_DEMO_ENABLED:'true',COPY_DEMO_ISOLATED_REVIEW:'true',DEMO_SPOT_ENABLED:'true',COPY_FUTURES_DEMO_OBSERVER_ENABLED:'true',
 COPY_FUTURES_DEMO_EXECUTION_ENABLED:'true',COPY_FUTURES_DEMO_AUTOMATIC:'true',PRIVATE_TRADING_ENABLED:'true',
 PRIVATE_TRADING_OWNER_ID:leader,PRIVATE_TRADING_TEST_USER_IDS:[follower,mixed].join(','),COPY_FUTURES_DEMO_APPROVED_LEADER_IDS:leader});
require('ts-node/register/transpile-only');
const BN=require('bignumber.js');
const {PrismaClient}=require('@prisma/client');
const {NativeDemoService}=require('../src/private-trading/native/service');
const {PrismaNativeRepository}=require('../src/private-trading/native/store');
const {Clock,FakeMarket,H0,H,M}=require('../src/private-trading/native/testing/liveFixture');
const {FuturesDemoObserverService}=require('../src/services/copyTrading/FuturesDemoObserverService');
const {FuturesDemoFollowerExecutor,futuresDemoAutomaticEnabled}=require('../src/services/copyTrading/FuturesDemoFollowerExecutor');
const {FuturesCopyWorker,startFuturesCopyWorker}=require('../src/services/copyTrading/FuturesCopyWorker');
const db=new PrismaClient({datasources:{db:{url}}});
const clock=new Clock(H0+5*H+5*M+30000),market=new FakeMarket(clock);
const native=new NativeDemoService(new PrismaNativeRepository(db,()=>({enabled:true,ownerId:leader})),market,clock.now);
let on=true;
const observer=new FuturesDemoObserverService(db,()=>on);
const executor=new FuturesDemoFollowerExecutor(db,native,()=>on);
const worker=new FuturesCopyWorker(db,observer,executor,native,()=>on);
const limits={ratio:'0.5',maxLeverage:'3',maxFillUsdt:'6000',maxTotalExposureUsdt:'12000',maxDeviationBps:'100'};
const sessions={},checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS',name);}
const q=id=>({userId:id,sessionId:sessions[id],expiresAt:Date.now()+H});
const step=()=>{clock.t+=M+100;};
const open=async id=>(await db.nativeDemoAccount.findUniqueOrThrow({where:{userId:id}})).payload.snapshot.positions.filter(p=>p.status==='OPEN');
const lead=(symbol,quantity='0.1')=>native.command(q(leader),{kind:'OPEN',symbol,side:'LONG',type:'MARKET',quantity,leverage:'2',marginType:'ISOLATED',idempotencyKey:'l-'+randomUUID()});
const closeLead=(positionId,quantity)=>native.command(q(leader),{kind:'CLOSE',positionId,quantity,idempotencyKey:'lc-'+randomUUID()});
const financial=async()=>JSON.stringify({b:await db.balance.findMany({orderBy:{id:'asc'}}),o:await db.order.count(),t:await db.trade.count(),fo:await db.futuresOrder.count(),fp:await db.futuresPosition.count()});
async function main(){
 assert.equal(await db.user.count(),0,'Nonempty fixture database');
 await check('automatic mode is hard OFF without its own flag, in production and on a remote database',async()=>{
  const env={...process.env};
  assert.equal(futuresDemoAutomaticEnabled(env),true);
  assert.equal(futuresDemoAutomaticEnabled({...env,COPY_FUTURES_DEMO_AUTOMATIC:'false'}),false);
  assert.equal(futuresDemoAutomaticEnabled({...env,NODE_ENV:'production'}),false);
  assert.equal(futuresDemoAutomaticEnabled({...env,DATABASE_URL:'postgresql://db.prod.invalid/copy_demo_x'}),false);
  let calls=0;const stop=startFuturesCopyWorker({pass:async()=>{calls++;}},()=>false,()=>{});stop();assert.equal(calls,0);
 });
 for(const [id,role] of [[leader,'ADMIN'],[follower,'USER'],[mixed,'USER']]){
  await db.user.create({data:{id,email:id+'@example.invalid',passwordHash:'x',role,referralCode:id.replaceAll('-','').slice(0,16)}});
  sessions[id]=(await db.session.create({data:{userId:id}})).id;
  await db.demoBalance.create({data:{userId:id,asset:'USDT',available:'20000'}});
  await db.balance.create({data:{userId:id,asset:'USDT',available:'777',locked:'2'}});
  await native.initialize(q(id),'init-'+id);
 }
 await db.copyStrategyOwner.upsert({where:{traderId:'VX-001'},create:{traderId:'VX-001',publicName:'Fixture',ownerUserId:leader},update:{ownerUserId:leader}});
 const before=await financial();
 let delegated;
 await check('consent creates one revocable delegated session in the follower session list; no click needed afterwards',async()=>{
  await observer.subscribe(follower,sessions[follower],'VX-001',{maxLeverage:'3',maxFillUsdt:'6000'});
  // A new consent starts flat: the follower first closes what the old consent left open.
  for(const p of await open(follower)){step();await native.command(q(follower),{kind:'CLOSE',positionId:p.id,quantity:p.quantity,idempotencyKey:'fc-'+randomUUID()});}
  await executor.begin(follower,sessions[follower],limits);
  const c=await db.copyFuturesDemoConsent.findUniqueOrThrow({where:{userId:follower}});
  delegated=c.delegatedSessionId;assert.ok(delegated);
  const s=await db.session.findUniqueOrThrow({where:{id:delegated}});
  assert.equal(s.userId,follower);assert.equal(s.revokedAt,null);assert.match(s.userAgent,/copy trading/);
  assert.ok(c.delegationExpiresAt.getTime()>Date.now()+6*24*H);
  assert.equal((await executor.snapshot(follower,sessions[follower])).automatic,true);
 });
 let btc;
 await check('leader OPEN -> worker pass -> follower position at ratio, with no follower request',async()=>{
  step();btc=(await lead('BTCUSDT')).positions.find(p=>p.symbol==='BTCUSDT').id;
  const r=await worker.pass();assert.equal(r.delivered,1,JSON.stringify(r));
  const pos=await open(follower);assert.equal(pos.length,1);assert.equal(pos[0].quantity,'0.05');
 });
 await check('two concurrent passes deliver an event exactly once',async()=>{
  step();await lead('BTCUSDT','0.04');
  await Promise.allSettled([worker.pass(),worker.pass()]);await worker.pass();
  const applied=await db.copyFuturesDemoMirror.count({where:{status:'APPLIED',consent:{userId:follower}}});
  assert.equal(applied,2);
 });
 await check('a leader add-on is mirrored into the same copied position',async()=>{
  const pos=await open(follower);assert.equal(pos.length,1,'one merged position');
  assert.equal(pos[0].quantity,'0.07');
 });
 let eth;
 await check('a second symbol opens a second copied position',async()=>{
  step();eth=(await lead('ETHUSDT')).positions.find(p=>p.symbol==='ETHUSDT').id;
  await worker.pass();
  const pos=await open(follower);assert.deepEqual(pos.map(p=>p.symbol).sort(),['BTCUSDT','ETHUSDT']);
 });
 await check('a partial leader CLOSE reduces the copied position proportionally; the full close leaves no dust',async()=>{
  step();await closeLead(btc,'0.07');await worker.pass();
  let b=(await open(follower)).find(p=>p.symbol==='BTCUSDT');assert.equal(b.quantity,'0.035');
  step();await closeLead(btc,'0.07');await worker.pass();
  b=(await open(follower)).find(p=>p.symbol==='BTCUSDT');assert.equal(b,undefined);
 });
 await check('a leader take-profit closes the copied position',async()=>{
  const tp=new BN(market.price).plus(100).toFixed();
  step();await native.command(q(leader),{kind:'PROTECTION',positionId:eth,protection:{takeProfit:tp,stopLoss:null,triggerBy:'LAST',quantity:null},idempotencyKey:'tp-'+randomUUID()});
  market.price=new BN(tp).plus(200).toFixed();
  for(let i=0;i<4;i++){step();await native.command(q(leader),{kind:'REFRESH',idempotencyKey:'r-'+randomUUID()},{persist:true});
   if(!(await open(leader)).some(p=>p.id===eth))break;}
  await worker.pass();
  assert.equal((await open(follower)).length,0);
  assert.equal((await db.copyFuturesDemoMirror.findFirstOrThrow({where:{consent:{userId:follower},kind:'TAKE_PROFIT'}})).status,'APPLIED');
 });
 await check('a follower with own Futures activity is refused, never mixed',async()=>{
  await observer.subscribe(mixed,sessions[mixed],'VX-001',{maxLeverage:'3',maxFillUsdt:'6000'});
  await executor.begin(mixed,sessions[mixed],limits);
  step();await native.command(q(mixed),{kind:'OPEN',symbol:'BTCUSDT',side:'SHORT',type:'MARKET',quantity:'0.01',leverage:'2',marginType:'ISOLATED',idempotencyKey:'own-'+randomUUID()});
  step();await lead('BTCUSDT');await worker.pass();
  const m=await db.copyFuturesDemoMirror.findFirstOrThrow({where:{consent:{userId:mixed}},orderBy:{createdAt:'desc'}});
  assert.equal(m.status,'REJECTED');assert.equal(m.reason,'FOLLOWER_POSITION_MIXED_WITH_OTHER_ACTIVITY');
  assert.equal((await open(mixed)).length,1,'only the follower own position');
 });
 await check('a delegation the user revoked in the session list stops copying',async()=>{
  await db.session.update({where:{id:delegated},data:{revokedAt:new Date()}});
  const held=(await open(follower)).length;
  step();await lead('ETHUSDT');const r=await worker.pass();
  assert.equal((await open(follower)).length,held);assert.ok(r.refused.length>=1,JSON.stringify(r));
 });
 await check('stop revokes the delegation at once; later leader trades are not copied',async()=>{
  const held=(await open(follower)).length; // copied positions are kept on stop
  await executor.stop(follower,sessions[follower]);
  assert.ok((await db.session.findUniqueOrThrow({where:{id:delegated}})).revokedAt);
  assert.equal((await db.copyFuturesDemoConsent.findUniqueOrThrow({where:{userId:follower}})).status,'STOPPED');
  step();await lead('BTCUSDT');const r=await worker.pass();
  assert.equal((await open(follower)).length,held);assert.equal((await executor.snapshot(follower,sessions[follower])).automatic,false);
  assert.ok(r.followers<=1);
 });
 await check('flag OFF: the worker does nothing at all',async()=>{
  on=false;const r=await worker.pass();assert.deepEqual(r,{followers:0,delivered:0,refused:[]});on=true;
 });
 await check('real balances, orders and Futures rows unchanged',async()=>assert.equal(await financial(),before));
 console.log(checks.length+' automatic Futures copy checks PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
