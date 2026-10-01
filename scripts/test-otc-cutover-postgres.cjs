// Only the disposable parent may invoke this. No copied old financial logic:
// OLD modules come from git archive of the explicit fresh main SHA; NEW from PR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const base = process.env.OTC_CUTOVER_BASE_ROOT;
const url = new URL(process.env.OTC_DIAGNOSTIC_URL || '');
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/voltex_otc_safety_test'); assert.ok(url.port);
assert.match(process.env.OTC_CUTOVER_BASE_SHA || '', /^[0-9a-f]{40}$/);
assert.ok(base && path.resolve(base).startsWith(path.join(root, 'node_modules', '.cache') + path.sep));
global.fetch = async () => { throw Error('External network forbidden'); };
require('ts-node/register/transpile-only');
const { PrismaClient } = require('./fixtures/isolated-prisma.cjs')(process.env.OTC_DIAGNOSTIC_CLIENT);
const old = file => require(path.join(base, 'src', file));
const { OrderService } = require('../src/services/OrderService');
const { WithdrawalService } = require('../src/services/WithdrawalService');
const { transferWalletBalance } = require('../src/services/WalletTransferService');
const { auditSpotReserves } = require('../src/otc/auditReserves');
const { SpotBookTransaction } = require('../src/services/SpotBookTransaction');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const bn = value => new (require('bignumber.js'))(value);
const db = new PrismaClient({ datasources:{db:{url:url.toString()}} });
const other = new PrismaClient({ datasources:{db:{url:url.toString()}} });
const price = { getTicker:async () => ({ lastPrice:'100' }) };
const buy = (service, userId, amount) => service.placeOrder({ userId, pair:'BTC/USDT', side:'BUY', type:'LIMIT', price:bn(100), quantity:bn(amount).div(100) });
const withdraw = (service, userId, amount) => service.requestWithdrawal({ userId, amount, asset:'USDT', network:'FIXTURE', toAddress:'NO_REAL_ADDRESS' });
function gate() {
  let arrive, release;
  const arrived = new Promise(r => { arrive=r; }), resumed = new Promise(r => { release=r; });
  return { arrived, release, pause:async () => { arrive(); await resumed; } };
}
// Scheduling hooks only: every delegate and transaction is real PostgreSQL.
function instrument(client, hook) {
  return new Proxy(client, { get(t,k) {
    if (k !== '$transaction') { const v=t[k]; return typeof v === 'function' ? v.bind(t) : v; }
    return (work, options) => t.$transaction(tx => work(new Proxy(tx, { get(t,m) {
      const v=t[m];
      if (['balance','futuresBalance','order'].includes(m)) return new Proxy(v, { get(d,op) {
        const fn=d[op]; if (typeof fn !== 'function') return fn;
        return async args => { const result=await fn.call(d,args); await hook(m,op,args,result,tx); return result; };
      } });
      return typeof v === 'function' ? v.bind(t) : v;
    } })), { ...options, timeout:30000, maxWait:10000 });
  } });
}
async function user(asset='USDT', available='100', locked='0') {
  const id=randomUUID();
  await db.user.create({data:{id,email:`${id}@fixture.invalid`,passwordHash:'FIXTURE_ONLY',referralCode:id,createdAt:new Date('2020-01-01')}});
  await db.balance.create({data:{userId:id,asset,available,locked}}); return id;
}
async function balance(id, model='balance', asset='USDT') {
  const r=await db[model].findUniqueOrThrow({where:{userId_asset:{userId:id,asset}}});
  return { available:r.available.toString(), locked:r.locked.toString() };
}
async function snapshot() {
  // All existing public tables, including positions, orders, balances, funding,
  // histories and deposits. Schema/migration metadata is not financial data.
  const tables=await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'Otc%' AND tablename<>'_prisma_migrations' ORDER BY tablename`;
  const result={};
  for (const {tablename} of tables) {
    const rows=await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row FROM "${tablename.replaceAll('"','""')}" t ORDER BY row_to_json(t)::text`);
    result[tablename]=rows.map(x=>x.row);
  }
  return result;
}
async function oldInFlight() {
  const id=process.argv[3];
  const service=new (old('services/OrderService').OrderService)(instrument(db,async(m,op,args,result,tx)=>{
    if(m==='order' && op==='create') {
      const [row]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      process.send({ ready:true, pid:row.pid, orderId:result.id });
      await new Promise(()=>{}); // parent really terminates this old process
    }
  }),new (old('matching-engine/MatchingEngine').MatchingEngine)(),price);
  await buy(service,id,'30');
}
async function run() {
  if (process.argv[2]==='--old-inflight') return oldInFlight();
  assert.equal(process.argv[2],'--local-child');
  const watchdog=setTimeout(()=>{console.error('CUTOVER TIMEOUT');process.exit(1);},150000);
  let passed=0;
  const test=async(name,fn)=>{await fn();passed++;console.log('PASS:',name);};
  const OldOrder=old('services/OrderService').OrderService;
  const OldWithdrawal=old('services/WithdrawalService').WithdrawalService;
  const oldEngine=()=>new (old('matching-engine/MatchingEngine').MatchingEngine)();
  try {
    // Existing obligations precede the additive migration. Never use an empty
    // post-migration DB as evidence of safe legacy cutover.
    const keeper=await user();
    await withdraw(new OldWithdrawal(db),keeper,'10');
    await buy(new OldOrder(db,oldEngine(),price),keeper,'20');
    const before=await snapshot();
    await test('exact operator hold command serves 503 to financial routes, has no DB sessions and changes no rows',async()=>{
      const doc=fs.readFileSync(path.join(root,'docs/OTC_SHARED_WALLET_CUTOVER.md'),'utf8');
      const match=/<!-- hold-start-command -->\s+```sh\s+node -e "([^"\r\n]+)"\s+```/.exec(doc);
      assert.ok(match,'Runbook command must remain executable and tested');
      const net=require('node:net'),http=require('node:http');
      const existingSessions=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' ORDER BY pid`;
      const probe=net.createServer().listen(0,'127.0.0.1');await once(probe,'listening');
      const port=probe.address().port;await new Promise(r=>probe.close(r));
      const held=spawn(process.execPath,['-e',match[1]],{cwd:base,windowsHide:true,
        env:{SystemRoot:process.env.SystemRoot,PORT:String(port),DATABASE_URL:url.toString()},stdio:['ignore','pipe','pipe']});
      const request=(route,method='GET')=>new Promise((resolve,reject)=>{
        const q=http.request({host:'127.0.0.1',port,path:route,method},s=>{let body='';s.on('data',b=>body+=b);s.on('end',()=>resolve({status:s.statusCode,body:JSON.parse(body)}));});q.on('error',reject);q.end();
      });
      try {
        let ready;
        for(let i=0;i<100&&!ready;i++){try{ready=await request('/health');}catch{await new Promise(r=>setTimeout(r,20));}}
        assert.deepEqual(ready,{status:200,body:{status:'maintenance',financialWriters:false}});
        for(const route of ['/api/v1/orders','/api/v1/deposits','/api/v1/futures/orders','/api/v1/otc'])assert.equal((await request(route,'POST')).status,503);
        assert.deepEqual(await snapshot(),before);
        const sessions=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' ORDER BY pid`;
        assert.deepEqual(sessions,existingSessions); // only the known fixture parent/observer, no hold-process backend
      } finally {const exited=once(held,'exit');held.kill();await exited;}
    });
    await test('actual old process killed mid-transaction: provisional hold/order roll back before migration',async()=>{
      const worker=spawn(process.execPath,[__filename,'--old-inflight',keeper],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
      let error='';worker.stderr.on('data',x=>{error+=x;});
      const ready=await Promise.race([once(worker,'message').then(([m])=>m),once(worker,'exit').then(()=>{throw Error(error||'Old worker exited before barrier');})]);
      const exited=once(worker,'exit'); worker.kill('SIGTERM'); await exited;
      // No blind time delay: verify that the actual transaction backend vanished.
      for(let i=0;i<50;i++) {
        const [r]=await db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=${ready.pid}`;
        if(r.n===0) break;
        if(i===49) throw Error('Old backend still present: migration forbidden');
        await new Promise(r=>setTimeout(r,20));
      }
      assert.deepEqual(await snapshot(),before);
    });
    await test('only after old exit: real additive migration preserves every legacy obligation byte-for-byte',async()=>{
      const { createRequire }=require('node:module');
      const pg=createRequire(path.join(root,'node_modules/.cache/deposit-qa/package.json'))('pg');
      const sql=new pg.Client({connectionString:url.toString()});await sql.connect();
      try {
        const names=fs.readdirSync(path.join(root,'prisma/migrations')).filter(name=>!fs.existsSync(path.join(base,'prisma/migrations',name))).sort();
        assert.deepEqual(names,['20261001000000_otc_cash_requests']);
        for(const name of names)await sql.query(fs.readFileSync(path.join(root,'prisma/migrations',name,'migration.sql'),'utf8'));
      } finally {await sql.end();}
      assert.deepEqual(await snapshot(),before);
      const result=await auditSpotReserves(db);assert.equal(result.result,'CLEAN');assert.equal(result.readOnly,true);
      assert.equal(result.activeOrdersExamined,1);
    });
    await test('post-migration audit failure/unavailability never releases holds or starts writers',async()=>{
      await assert.rejects(()=>auditSpotReserves(new Proxy(db,{get(t,k){if(k==='$transaction')return async()=>{throw Error('FIXTURE audit unavailable');};return t[k];}})));
      assert.deepEqual(await snapshot(),before);
      assert.ok(await db.$queryRaw`SELECT 1 FROM "OtcCashRequest" LIMIT 1`);
    });
    // These passing assertions prove INCOMPATIBILITY, not rolling-deploy safety.
    for(const kind of ['Spot request','withdrawal request','manual credit']) await test(`REPRODUCED mixed main/head lost update: ${kind}`,async()=>{
      const id=await user(),pause=gate();let armed=true;
      const client=instrument(db,async(m,op)=>{if(armed&&m==='balance'&&op==='findUnique'){armed=false;await pause.pause();}});
      const pending=kind==='Spot request'?buy(new OldOrder(client,oldEngine(),price),id,'80')
        :kind==='withdrawal request'?withdraw(new OldWithdrawal(client),id,'80')
        :new (old('services/BalanceAdjustmentService').BalanceAdjustmentService)(client).adjust({userId:id,asset:'USDT',amount:'10',reason:'fixture',performedByAdminId:keeper});
      await pause.arrived;
      await withdraw(new WithdrawalService(other),id,'60');pause.release();await pending;
      assert.deepEqual(await balance(id),kind==='manual credit'?{available:'110',locked:'60'}:{available:'20',locked:'80'});
      if(kind!=='manual credit')assert.equal((await db.withdrawal.aggregate({where:{userId:id},_sum:{amount:true}}))._sum.amount.toString(),kind==='Spot request'?'60':'140');
    });
    await test('REPRODUCED actual deposit approval credit lost to old Spot; sequential stopped-writer ordering preserves it',async()=>{
      const {DepositBatchService}=require('../src/services/deposits/DepositBatchService');
      assert.equal(require('../src/config/limits').MIN_DEPOSIT_USD,500);
      const admin=await user();await db.user.update({where:{id:admin},data:{role:'ADMIN'}});
      const credit=async id=>{
        const row=await db.deposit.create({data:{userId:id,chain:'TRON',asset:'USDT',txHash:randomUUID(),amount:'500',status:'PENDING',verifiedAt:new Date(),confirmations:100,finalized:true}});
        const service=new DepositBatchService(other,price,async()=>({chain:'TRON',type:'tron',treasuryAddress:'FIXTURE_ONLY',minConfirmations:20}),
          async()=>({amount:bn(500),confirmations:100,finalized:true,recipient:'FIXTURE_ONLY',blockNumber:null,blockTimestamp:null}));
        const preview=await service.preview({userId:id,chain:'TRON',asset:'USDT'});
        const result=await service.confirm({adminId:admin,userId:id,chain:'TRON',asset:'USDT',depositIds:[row.id],token:preview.token,idempotencyKey:randomUUID()});
        assert.equal(result.status,'CREDITED');assert.equal((await db.deposit.findUniqueOrThrow({where:{id:row.id}})).status,'CREDITED');
      };
      const id=await user(),pause=gate();let armed=true;
      const client=instrument(db,async(m,op)=>{if(armed&&m==='balance'&&op==='findUnique'){armed=false;await pause.pause();}});
      const pending=buy(new OldOrder(client,oldEngine(),price),id,'80');await pause.arrived;
      await credit(id);assert.equal((await balance(id)).available,'600');pause.release();await pending;
      assert.deepEqual(await balance(id),{available:'20',locked:'80'}); // CREDITED 500 disappeared
      const safe=await user();await buy(new OldOrder(db,oldEngine(),price),safe,'80');
      // No older writer can resume after this point in the stop/start procedure.
      await credit(safe);await withdraw(new WithdrawalService(other),safe,'10');
      assert.deepEqual(await balance(safe),{available:'510',locked:'90'});
    });
    for(const kind of ['funding','liquidation']) await test(`REPRODUCED mixed main/head background ${kind} overwrites transfer`,async()=>{
      const id=await user('USDT','0'),pause=gate();let armed=true;
      await db.futuresBalance.create({data:{userId:id,asset:'USDT',available:'100',locked:'10'}});
      const position=await db.futuresPosition.create({data:{userId:id,symbol:'BTC/USDT',side:'LONG',size:'1',entryPrice:'100',leverage:10,marginType:'ISOLATED',initialMargin:'10',liquidationPrice:'91'}});
      const client=instrument(db,async(m,op,args)=>{if(armed&&m==='futuresBalance'&&op==='upsert'&&args.where.userId_asset.userId===id){armed=false;await pause.pause();}});
      const marks={getMarkPrice:async()=>bn(100),getIndexPrice:async()=>bn(100)};
      const pending=kind==='funding'?new (old('futures/FundingRateService').FundingRateService)(client,marks).settleFundingForSymbol('BTC/USDT')
        :new (old('futures/LiquidationEngine').LiquidationEngine)(client,marks).liquidatePosition(position.id,bn(90));
      await pause.arrived;await transferWalletBalance(other,id,'USDT',bn(60),'TO_SPOT');pause.release();await pending;
      assert.deepEqual(await balance(id,'futuresBalance'),kind==='funding'?{available:'99.99',locked:'10'}:{available:'100',locked:'0'});
      assert.equal((await balance(id)).available,'60');
      if(kind==='funding')assert.equal((await db.fundingPayment.findFirstOrThrow({where:{positionId:position.id}})).amount.toString(),'-0.01');
      else assert.equal((await db.futuresPosition.findUniqueOrThrow({where:{id:position.id}})).status,'LIQUIDATED');
      await db.futuresPosition.update({where:{id:position.id},data:{status:'CLOSED'}}); // fixture isolation only
    });
    await test('REPRODUCED old conditional background refund overwrites new withdrawal reserve',async()=>{
      const id=await user('USDT','120'),pause=gate();let armed=true;
      const service=new OldOrder(db,oldEngine(),price);
      const placed=await service.placeOrder({userId:id,pair:'BTC/USDT',side:'BUY',type:'STOP_MARKET',triggerPrice:bn(110),quantity:bn(0.5)});
      const held=await balance(id);
      const client=instrument(db,async(m,op,args)=>{if(armed&&m==='balance'&&op==='upsert'&&args.where.userId_asset.userId===id){armed=false;await pause.pause();}});
      const pending=new (old('services/PriceWatcherService').PriceWatcherService)(client,new OldOrder(client,oldEngine(),price),{getTicker:async()=>({lastPrice:'120'})}).checkAndTrigger();
      await pause.arrived;await withdraw(new WithdrawalService(other),id,'10');pause.release();assert.ok(await pending);
      assert.deepEqual(await balance(id),{available:'120',locked:'0'}); // 10 held withdrawal still exists
      assert.ok(bn(held.locked).gt(0));
      assert.equal((await db.order.findUniqueOrThrow({where:{id:placed.order.id}})).status,'CANCELLED');
    });
    // Legacy rows with no correct reserve/fill provenance must block the release
    // audit before any new Spot placement/trigger/cancellation, OTC still off.
    await test('actual main partial maker persists stale remaining; audit and new cancel fail closed without refund',async()=>{
      // Use a different real pair to isolate executable liquidity from previous cases.
      const seller=await user('ETH','1'),buyer=await user(),engine=oldEngine(),service=new OldOrder(db,engine,price);
      const maker=await service.placeOrder({userId:seller,pair:'ETH/USDT',side:'SELL',type:'LIMIT',price:bn(100),quantity:bn(1)});
      const fill=await service.placeOrder({userId:buyer,pair:'ETH/USDT',side:'BUY',type:'LIMIT',price:bn(100),quantity:bn('.4')});
      assert.equal(fill.trades.length,1);
      const saved=await db.order.findUniqueOrThrow({where:{id:maker.order.id}});
      assert.equal(saved.remainingQuantity.toString(),'1');assert.equal((await balance(seller,'balance','ETH')).locked,'0.6');
      const state=await snapshot(),result=await auditSpotReserves(db);
      assert.ok(result.issues.some(x=>x.category==='LEGACY_ORDER_RECONCILIATION_REQUIRED'&&x.activeOrderIds?.includes(maker.order.id)));
      await assert.rejects(()=>new OrderService(db,new MatchingEngine(),price).cancelOrder(seller,maker.order.id),/Invalid active Spot order/);
      assert.deepEqual(await snapshot(),state);
    });
    for(const problem of ['sell-price','negative-price','bad-side','bad-type','stale-maker','orphan-fill','bad-trigger','orphan-oco','unbacked-withdrawal']) await test(`READ ONLY audit blocks ${problem}; failure preserves all rows`,async()=>{
      const id=await user('BTC','1','1');let order;
      if(problem==='unbacked-withdrawal')await db.withdrawal.create({data:{userId:id,asset:'BTC',amount:'2',network:'FIXTURE',toAddress:'NONE',status:'PENDING',balanceHeld:true}});
      else if(problem==='orphan-fill')await db.trade.create({data:{pair:'BTC/USDT',makerOrderId:randomUUID(),takerOrderId:randomUUID(),makerUserId:id,takerUserId:keeper,quantity:'1',price:'100',side:'BUY'}});
      else order=await db.order.create({data:{userId:id,pair:'BTC/USDT',side:problem==='bad-side'?'INVALID':'SELL',type:problem==='bad-type'?'MARKET':problem.includes('trigger')||problem.includes('oco')?'STOP_LIMIT':'LIMIT',price:problem==='sell-price'?null:problem==='negative-price'?'-1':'100',
        originalQuantity:'1',remainingQuantity:problem==='stale-maker'?'.5':'1',status:problem.includes('trigger')||problem.includes('oco')?'PENDING_TRIGGER':'OPEN',
        ...(problem==='bad-trigger'?{triggerPrice:'0',lockedAsset:'BTC',lockedAmount:'1'}:{}),
        ...(problem==='orphan-oco'?{triggerPrice:'90',lockedAsset:'BTC',lockedAmount:'1',ocoGroupId:randomUUID()}:{})}});
      const beforeIssue=await snapshot(),result=await auditSpotReserves(db);
      assert.equal(result.result,'ISSUES_FOUND');assert.equal(result.rowsChanged,0);
      assert.ok(result.issues.some(x=>problem==='orphan-fill'?x.category==='LEGACY_TRADE_RECONCILIATION_REQUIRED':x.userId===id));
      if(order&&['sell-price','stale-maker'].includes(problem))await assert.rejects(()=>db.$transaction(tx=>new SpotBookTransaction(tx).book('BTC/USDT')),/Invalid active Spot order/);
      assert.deepEqual(await snapshot(),beforeIssue);
    });
    console.log(`CUTOVER: ${passed} scenarios PASS. Mixed-version corruption REPRODUCED; rolling release remains forbidden. Base=${process.env.OTC_CUTOVER_BASE_SHA}`);
  } finally {await db.$disconnect();await other.$disconnect();clearTimeout(watchdog);}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
