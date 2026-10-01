// Only run via the disposable-cluster parent. No external network or .env.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function run() {
  assert.equal(process.argv[2],'--local-child');
  const url=new URL(process.env.OTC_DIAGNOSTIC_URL || '');
  assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.pathname,'/voltex_otc_safety_test');
  global.fetch=async()=>{throw Error('External network forbidden');};
  process.env.JWT_SECRET='fixture-only-otc-jwt-not-a-production-secret';
  require('ts-node/register/transpile-only');
  const { PrismaClient }=require(process.env.OTC_DIAGNOSTIC_CLIENT);
  const { OtcCashService }=require('../src/otc/OtcCashService');
  const { auditSpotReserves }=require('../src/otc/auditReserves');
  const { OrderService }=require('../src/services/OrderService');
  const { WithdrawalService }=require('../src/services/WithdrawalService');
  const { transferWalletBalance }=require('../src/services/WalletTransferService');
  const { BankingService }=require('../src/banking/service');
  const { AdminUserDeletionService }=require('../src/services/AdminUserDeletionService');
  const { AccountDeletionGate }=require('../src/services/AccountDeletionGate');
  const { MatchingEngine }=require('../src/matching-engine/MatchingEngine');
  const { otcCashRouter }=require('../src/api/routes/otcCash');
  const { requireAuth }=require('../src/api/middleware/auth');
  const { createSchema,actionSchema,decimal }=require('../src/otc/policy');
  const express=require('express'),request=require('supertest'),jwt=require('jsonwebtoken'),BigNumber=require('bignumber.js');
  const counts={sql:0};
  const sqlTexts=[];
  const db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[{emit:'event',level:'query'}]});
  db.$on('query',event=>{counts.sql++;sqlTexts.push(event.query);});
  const other=new PrismaClient({datasources:{db:{url:url.toString()}}});
  const source={getTicker:async()=>({lastPrice:'100'})};
  let passed=0;
  const test=async(name,fn)=>{await fn();passed++;console.log('PASS:',name);};
  const routes=[{country:'RU',cityId:'geonames-524901',asset:'USDT',fiat:'USD',cashPrecision:2}];
  const approvedUserIds=[];
  const policy={enabled:true,version:'LOCAL_FIXTURE_ONLY',routes,approvedUserIds,maxActive:3};
  const service=new OtcCashService(db,source,policy), second=new OtcCashService(other,source,policy);
  async function actor(role='USER',available='30000') {
    const id=randomUUID();
    await db.user.create({data:{id,email:`${id}@fixture.invalid`,passwordHash:'NOT_A_PASSWORD',referralCode:id,role,kycStatus:'APPROVED',createdAt:new Date('2020-01-01')}});
    const session=await db.session.create({data:{userId:id}});
    await db.balance.create({data:{userId:id,asset:'USDT',available,locked:'0'}});
    approvedUserIds.push(id);return {userId:id,sessionId:session.id};
  }
  const input=(over={})=>createSchema.parse({country:'RU',cityId:'geonames-524901',asset:'USDT',quantity:'10000',fiat:'USD',tier:'otc-convert',idempotencyKey:randomUUID(),...over});
  const action=(row,values)=>actionSchema.parse({version:row.version,idempotencyKey:randomUUID(),...values});
  const balance=async a=>{const b=await db.balance.findUniqueOrThrow({where:{userId_asset:{userId:a.userId,asset:'USDT'}}});return {available:b.available.toString(),locked:b.locked.toString()};};
  const admin=await actor('ADMIN');
  async function offered(a) {
    const r=await service.create(a,input());
    await service.act(admin,r.id,action(r,{action:'offer',rate:'1.25',fee:'25',expiresAt:new Date(Date.now()+3600000).toISOString()}),true);
    return service.detail(a,r.id);
  }
  async function ready(a) {
    let r=await offered(a);
    await service.act(a,r.id,action(r,{action:'accept',offerVersion:1}));r=await service.detail(a,r.id);
    await service.act(admin,r.id,action(r,{action:'pickup',address:'FICTIONAL LOCAL TEST DESK — NO REAL CASH',appointment:new Date(Date.now()+7200000).toISOString(),timezone:'Europe/Moscow'}),true);
    return service.detail(a,r.id);
  }
  const watchdog=setTimeout(()=>{console.error('OTC TEST TIMEOUT');process.exit(1);},150000);
  try {
    await test('strict decimal boundaries, no exponents, no zero/ambiguous/excess precision',async()=>{
      for(const x of ['0','-0','-1','1e4','NaN','Infinity',' 1','01','1,2','0.0000001','1000000000000000000'])assert.throws(()=>decimal(x,6));
      assert.equal(decimal('10000.000001',6).toFixed(),'10000.000001');
    });
    await test('operator audit is SQL READ ONLY, clean on empty fixture and cannot fall back to DATABASE_URL',async()=>{
      const result=await auditSpotReserves(db);assert.equal(result.result,'CLEAN');assert.equal(result.readOnly,true);
      const child=require('node:child_process').spawnSync(process.execPath,['-r','ts-node/register/transpile-only','src/otc/auditReserves.ts'],{
        cwd:require('node:path').resolve(__dirname,'..'),windowsHide:true,encoding:'utf8',env:{...process.env,DATABASE_URL:'postgresql://must-not-connect@127.0.0.1:1/forbidden',OTC_AUDIT_DATABASE_URL:''}});
      assert.equal(child.status,1);assert.match(child.stderr,/OTC_AUDIT_DATABASE_URL_REQUIRED/);assert.ok(!child.stderr.includes('must-not-connect'));
      await assert.rejects(()=>db.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;await tx.balance.updateMany({data:{available:'123'}});}));
    });
    await test('default policy cannot reserve; geo mismatch, unsupported asset, KYC/AML gate',async()=>{
      const a=await actor();
      await assert.rejects(()=>new OtcCashService(db,source).create(a,input()),e=>e.code==='DIRECTION_NOT_APPROVED');
      await assert.rejects(()=>service.create(a,input({country:'UA'})),e=>e.code==='INVALID_CITY');
      assert.throws(()=>input({asset:'NRX'}));
      await db.user.update({where:{id:a.userId},data:{kycStatus:'NOT_STARTED'}});
      await assert.rejects(()=>service.create(a,input()),e=>e.code==='CUSTOMER_REVIEW_REQUIRED');
      assert.deepEqual(await balance(a),{available:'30000',locked:'0'});
    });
    await test('same-key concurrent create, restart and replay reserve only once',async()=>{
      const a=await actor(),payload=input();
      const [one,two]=await Promise.all([service.create(a,payload),second.create(a,payload)]);
      assert.equal(one.id,two.id);assert.deepEqual(await balance(a),{available:'20000',locked:'10000'});
      assert.equal((await new OtcCashService(other,source,policy).create(a,payload)).id,one.id);
      await assert.rejects(()=>service.create(a,{...payload,quantity:'11000'}),e=>e.code==='IDEMPOTENCY_MISMATCH');
      assert.equal(await db.otcCashLedger.count({where:{requestId:one.id,kind:'RESERVE'}}),1);
    });
    await test('two distinct OTC creates cannot spend the same available balance',async()=>{
      const a=await actor('USER','15000');
      const results=await Promise.allSettled([service.create(a,input()),second.create(a,input())]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(await balance(a),{available:'5000',locked:'10000'});
    });
    await test('real OTC and real withdrawal / Spot order compete on one Balance',async()=>{
      for(const kind of ['withdrawal','Spot']) {
        const a=await actor('USER','15000');
        const competing=kind==='withdrawal'?new WithdrawalService(other).requestWithdrawal({userId:a.userId,asset:'USDT',amount:'10000',network:'FIXTURE',toAddress:'NO_CHAIN_TRANSFER'})
          :new OrderService(other,new MatchingEngine(),source).placeOrder({userId:a.userId,pair:'BTC/USDT',side:'BUY',type:'LIMIT',price:new BigNumber(100),quantity:new BigNumber(100)});
        const results=await Promise.allSettled([service.create(a,input()),competing]);
        assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(await balance(a),{available:'5000',locked:'10000'});
      }
    });
    await test('cancel and reject race releases owned Q once; another withdrawal stays reserved',async()=>{
      const a=await actor(),r=await service.create(a,input());
      await new WithdrawalService(db).requestWithdrawal({userId:a.userId,asset:'USDT',amount:'123',network:'FIXTURE',toAddress:'NO_CHAIN_TRANSFER'});
      const cancel=action(r,{action:'cancel'}),reject=action(r,{action:'reject'});
      const results=await Promise.allSettled([service.act(a,r.id,cancel),second.act(admin,r.id,reject,true)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(await balance(a),{available:'29877',locked:'123'});
      assert.equal(await db.otcCashLedger.count({where:{requestId:r.id,kind:'RELEASE'}}),1);
    });
    await test('real OTC versus Spot-to-Futures transfer / Banking placement preserves total ownership',async()=>{
      for(const kind of ['transfer','banking']) {
        const a=await actor('USER','15000');
        const spend=kind==='transfer'?transferWalletBalance(other,a.userId,'USDT',new BigNumber(10000),'TO_FUTURES')
          :new BankingService(other,{prices:async()=>({USDT:'1'})}).createPlacement(a.userId,{programId:'MONTHLY_17_24M',asset:'USDT',amount:'10000',idempotencyKey:randomUUID()});
        const results=await Promise.allSettled([service.create(a,input()),spend]);
        assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
        const spot=await balance(a);assert.equal(spot.available,'5000');
        const held=await db.otcCashReservation.aggregate({where:{request:{userId:a.userId},status:'HELD'},_sum:{quantity:true}});
        const future=await db.futuresBalance.findUnique({where:{userId_asset:{userId:a.userId,asset:'USDT'}}});
        const [bank]=await db.$queryRaw`SELECT COALESCE(SUM(principal),0)::text AS total FROM banking_placements WHERE user_id=${a.userId}`;
        assert.equal(new BigNumber(spot.available).plus(held._sum.quantity?.toString()??0).plus(future?.available.toString()??0).plus(bank.total).toFixed(),'15000');
      }
    });
    await test('offers are versioned, explicit consent; stale and expired offers cannot be accepted',async()=>{
      const a=await actor();let r=await offered(a);
      assert.equal(r.offers[0].net,'12475');
      await service.message(a,r.id,'OK',randomUUID());assert.equal((await service.detail(a,r.id)).status,'OFFERED');
      await service.act(admin,r.id,action(r,{action:'offer',rate:'1.20',fee:'30',expiresAt:new Date(Date.now()+3600000).toISOString()}),true);
      r=await service.detail(a,r.id);
      await assert.rejects(()=>service.act(a,r.id,action(r,{action:'accept',offerVersion:1})),e=>e.code==='OFFER_CHANGED');
      await db.otcCashOffer.update({where:{requestId_version:{requestId:r.id,version:2}},data:{expiresAt:new Date(0)}});
      await assert.rejects(()=>service.act(a,r.id,action(r,{action:'accept',offerVersion:2})),e=>e.code==='OFFER_EXPIRED');
    });
    await test('pickup is private and not completion; cancel intent blocks begin-payout',async()=>{
      const a=await actor(),r=await ready(a);
      assert.equal(r.status,'PICKUP_READY');assert.deepEqual(await balance(a),{available:'20000',locked:'10000'});
      assert.ok(!JSON.stringify(await service.list(admin,true)).includes('FICTIONAL'));
      assert.ok(!JSON.stringify(r).includes('FICTIONAL'));
      const messages=await service.messages(a,r.id);assert.match(messages.rows[0].text,/Europe\/Moscow/);
      const outsider=await actor();await assert.rejects(()=>service.messages(outsider,r.id),e=>e.code==='NOT_FOUND');
      await service.act(a,r.id,action(r,{action:'cancel'}));
      const cancelled=await service.detail(a,r.id);
      await assert.rejects(()=>service.act(admin,r.id,action(cancelled,{action:'begin-payout'}),true),e=>e.code==='PAYOUT_BLOCKED');
      assert.deepEqual(await balance(a),{available:'20000',locked:'10000'});
      await service.act(admin,r.id,action(cancelled,{action:'confirm-cancel',cashDeskConfirmed:true}),true);
      assert.deepEqual(await balance(a),{available:'30000',locked:'0'});
    });
    await test('begin payout versus cancellation is serialized; unknown cash outcome keeps hold',async()=>{
      const a=await actor(),r=await ready(a);
      const results=await Promise.allSettled([service.act(a,r.id,action(r,{action:'cancel'})),second.act(admin,r.id,action(r,{action:'begin-payout'}),true)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.deepEqual(await balance(a),{available:'20000',locked:'10000'});
      const next=await service.detail(a,r.id);
      if(next.status==='PAYOUT_IN_PROGRESS') await assert.rejects(()=>service.act(admin,r.id,action(next,{action:'reject'}),true),e=>e.code==='INVALID_STATE');
      else assert.equal(next.cancelRequested,true);
    });
    await test('two admins complete only once, reference and receipt persist without second available debit',async()=>{
      const a=await actor(),another=await actor('ADMIN');let r=await ready(a);
      await service.act(admin,r.id,action(r,{action:'begin-payout'}),true);r=await service.detail(a,r.id);
      const finish=action(r,{action:'complete',reference:`LOCAL-RECEIPT-${randomUUID()}`});
      const results=await Promise.allSettled([service.act(admin,r.id,finish,true),second.act(another,r.id,action(r,{action:'complete',reference:'OTHER-LOCAL-RECEIPT'}),true)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.deepEqual(await balance(a),{available:'20000',locked:'0'});
      assert.equal(await db.otcCashLedger.count({where:{requestId:r.id,kind:'CONSUME'}}),1);
      assert.equal((await service.detail(a,r.id)).reservation.status,'CONSUMED');
    });
    await test('message exactly-once and separate USER/ADMIN authorisation',async()=>{
      const a=await actor(),r=await service.create(a,input()),key=randomUUID();
      const one=await service.message(a,r.id,'Вопрос клиента',key),two=await second.message(a,r.id,'Вопрос клиента',key);
      assert.equal(one.id,two.id);
      await assert.rejects(()=>service.message(a,r.id,'Другое сообщение',key),e=>e.code==='IDEMPOTENCY_MISMATCH');
      await service.message(admin,r.id,'Ответ оператора',randomUUID(),true);
      assert.equal((await service.messages(a,r.id)).rows.length,2);
      await assert.rejects(()=>service.list(a,true),e=>e.code==='ACCESS_DENIED');
      await assert.rejects(()=>service.act(a,r.id,action(r,{action:'reject'})),e=>e.code==='ADMIN_REQUIRED');
    });
    await test('audit failure rolls back OTC request, owned reserve, ledger and Balance',async()=>{
      const a=await actor();
      await db.$executeRawUnsafe(`CREATE FUNCTION fixture_otc_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OTC_RESERVE' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe('CREATE TRIGGER fixture_otc_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fixture_otc_audit_fail()');
      try {await assert.rejects(()=>service.create(a,input()));}finally{await db.$executeRawUnsafe('DROP TRIGGER fixture_otc_audit ON "AuditLog"');}
      assert.deepEqual(await balance(a),{available:'30000',locked:'0'});
      assert.equal(await db.otcCashRequest.count({where:{userId:a.userId}}),0);
    });
    await test('request and ledger SQL failures roll back every reservation effect',async()=>{
      await db.$executeRawUnsafe(`CREATE FUNCTION fixture_otc_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local fixture failure'; END $$`);
      for(const table of ['OtcCashRequest','OtcCashLedger']) {
        const a=await actor();
        await db.$executeRawUnsafe(`CREATE TRIGGER fixture_otc_fail BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION fixture_otc_fail()`);
        try{await assert.rejects(()=>service.create(a,input()));}finally{await db.$executeRawUnsafe(`DROP TRIGGER fixture_otc_fail ON "${table}"`);}
        assert.deepEqual(await balance(a),{available:'30000',locked:'0'});
        assert.equal(await db.otcCashRequest.count({where:{userId:a.userId}}),0);
      }
    });
    await test('lost COMMIT acknowledgement reconciles; unknown outcome resolves original key exactly once',async()=>{
      for(const unknown of [false,true]) {
        const a=await actor(),payload=input();
        const wrapped=new Proxy(db,{get(target,prop){
          if(prop==='$transaction')return async(fn,options)=>{await target.$transaction(fn,options);throw Error('LOCAL lost ACK');};
          if(unknown&&prop==='$queryRaw')return async()=>{throw Error('LOCAL outcome unavailable');};
          const value=target[prop];return typeof value==='function'?value.bind(target):value;
        }});
        const attempt=new OtcCashService(wrapped,source,policy).create(a,payload);
        if(unknown)await assert.rejects(()=>attempt,e=>e.code==='RESULT_UNKNOWN_CHECK_ORIGINAL_KEY');else await attempt;
        const original=await service.byKey(a,payload.idempotencyKey);assert.ok(original);
        assert.equal((await second.create(a,payload)).id,original.id);
        assert.deepEqual(await balance(a),{available:'20000',locked:'10000'});
      }
    });
    await test('deferred COMMIT rejection never reports success or leaves a hold',async()=>{
      await db.$executeRawUnsafe('CREATE TABLE fixture_otc_commit (id text REFERENCES "User"(id) DEFERRABLE INITIALLY DEFERRED)');
      const a=await actor(),payload=input();
      const wrapped=new Proxy(db,{get(target,prop){
        if(prop==='$transaction')return (fn,options)=>target.$transaction(async tx=>{const result=await fn(tx);await tx.$executeRawUnsafe("INSERT INTO fixture_otc_commit VALUES ('MISSING_LOCAL_USER')");return result;},options);
        const value=target[prop];return typeof value==='function'?value.bind(target):value;
      }});
      await assert.rejects(()=>new OtcCashService(wrapped,source,policy).create(a,payload));
      assert.equal(await service.byKey(a,payload.idempotencyKey),null);assert.deepEqual(await balance(a),{available:'30000',locked:'0'});
      await second.create(a,payload);assert.deepEqual(await balance(a),{available:'20000',locked:'10000'});
    });
    await test('legacy under-backed reserves block new OTC without repair',async()=>{
      const a=await actor();
      await db.withdrawal.create({data:{userId:a.userId,asset:'USDT',amount:'50',network:'FIXTURE',toAddress:'NONE',status:'PENDING',balanceHeld:true}});
      await assert.rejects(()=>service.create(a,input()),e=>e.code==='WALLET_RECONCILIATION_REQUIRED');
      assert.deepEqual(await balance(a),{available:'30000',locked:'0'});
    });
    await test('legacy orphan OCO and stale maker quantities fail admission without repair',async()=>{
      const a=await actor(),original={userId:a.userId,pair:'BTC/USDT',side:'BUY',type:'STOP_LIMIT',price:'100',triggerPrice:'90',originalQuantity:'1',remainingQuantity:'1',status:'PENDING_TRIGGER',lockedAmount:'100',lockedAsset:'USDT',ocoGroupId:randomUUID()};
      const order=await db.order.create({data:original});
      await db.balance.update({where:{userId_asset:{userId:a.userId,asset:'USDT'}},data:{locked:'100'}});
      await assert.rejects(()=>service.create(a,input()),e=>e.code==='LEGACY_OCO_RECONCILIATION_REQUIRED');
      await db.order.update({where:{id:order.id},data:{status:'PARTIALLY_FILLED',type:'LIMIT',remainingQuantity:'.5',ocoGroupId:null}});
      await assert.rejects(()=>service.create(a,input()),e=>e.code==='LEGACY_ORDER_RECONCILIATION_REQUIRED');
      assert.deepEqual(await balance(a),{available:'30000',locked:'100'});
      assert.equal(await db.otcCashRequest.count({where:{userId:a.userId}}),0);
    });
    await test('BTC minimum requires a fresh server quote; unavailable/stale quote never creates a reserve',async()=>{
      const a=await actor();await db.balance.create({data:{userId:a.userId,asset:'BTC',available:'1',locked:'0'}});
      const btcPolicy={...policy,routes:[{...routes[0],asset:'BTC'}]},payload=input({asset:'BTC',quantity:'0.1'});
      for(const quote of [null,{value:{lastPrice:'100000'},fetchedAt:Date.now()-86400000,stale:true}]){
        const prices={getTicker:source.getTicker,getTickerWithMeta:async()=>quote};
        await assert.rejects(()=>new OtcCashService(db,prices,btcPolicy).create(a,payload),e=>e.code==='PRICE_UNAVAILABLE');
      }
      assert.equal(await db.otcCashRequest.count({where:{userId:a.userId}}),0);
      const valid=new OtcCashService(db,{getTicker:source.getTicker,getTickerWithMeta:async()=>({value:{lastPrice:'100000'},fetchedAt:Date.now(),stale:false})},btcPolicy);
      await valid.create(a,payload);const b=await db.balance.findUniqueOrThrow({where:{userId_asset:{userId:a.userId,asset:'BTC'}}});
      assert.equal(b.available.toString(),'0.9');assert.equal(b.locked.toString(),'0.1');
    });
    await test('request history cannot disappear through user deletion',async()=>{
      const a=await actor();await service.create(a,input());
      const deletion=new AdminUserDeletionService(db,new AccountDeletionGate(),{spot:new MatchingEngine(),futures:new MatchingEngine(),demo:new MatchingEngine()});
      await assert.rejects(()=>deletion.delete(admin.userId,a.userId),e=>e.status===409);
      await assert.rejects(()=>db.user.delete({where:{id:a.userId}}));
      assert.equal(await db.otcCashRequest.count({where:{userId:a.userId}}),1);
    });
    await test('actual API auth, IDOR, revoked session, blocked account and SQL counts',async()=>{
      const a=await actor(),b=await actor();const app=express();app.use(express.json());app.use('/api/v1',otcCashRouter(db,source,service));
      app.get('/api/v1/fixture-auth-only',requireAuth(db),(_req,res)=>res.json({fixture:true}));
      const token=x=>jwt.sign({sub:x.userId,sid:x.sessionId},process.env.JWT_SECRET,{expiresIn:'1h'});
      const api=(method,path,who=a)=>request(app)[method](`/api/v1${path}`).set('Authorization',`Bearer ${token(who)}`);
      await request(app).get('/api/v1/otc/requests').expect(401);
      const measure=async(name,work)=>{const start=counts.sql;const result=await work();console.log(`COUNT ${name}: HTTP=1 SQL=${counts.sql-start} (includes common auth, transaction/control reads)`);return result;};
      await measure('common-auth-only',()=>api('get','/fixture-auth-only').expect(200));
      await measure('open',()=>api('get','/otc/requests').expect(200));
      const payload=input();const made=await measure('create',()=>api('post','/otc/requests').send(payload).expect(201));
      await api('post','/otc/requests').send({...input(),userId:b.userId}).expect(400);
      await measure('replay',()=>api('post','/otc/requests').send(payload).expect(201));
      await measure('message',()=>api('post',`/otc/requests/${made.body.id}/messages`).send({text:'LOCAL ONLY',idempotencyKey:randomUUID()}).expect(201));
      await api('get',`/otc/requests/${made.body.id}`,b).expect(404);
      await api('get','/admin/otc',b).expect(403);
      await measure('cancel',()=>api('post',`/otc/requests/${made.body.id}/actions`).send(action(made.body,{action:'cancel'})).expect(200));
      let finish=await ready(a);await service.act(admin,finish.id,action(finish,{action:'begin-payout'}),true);finish=await service.detail(a,finish.id);
      await measure('complete',()=>api('post',`/admin/otc/${finish.id}/actions`,admin).send(action(finish,{action:'complete',reference:`LOCAL-API-${randomUUID()}`})).expect(200));
      await measure('detail',()=>api('get',`/otc/requests/${finish.id}`).expect(200));
      await measure('chat',()=>api('get',`/otc/requests/${finish.id}/messages`).expect(200));
      await measure('balances',()=>api('get','/otc/balances').expect(200));
      await db.session.update({where:{id:a.sessionId},data:{revokedAt:new Date()}});await api('get','/otc/requests').expect(401);
      await db.user.update({where:{id:b.userId},data:{blockedAt:new Date()}});await api('get','/otc/requests',b).expect(403);
    });
    await test('read-only legacy check reports affected IDs without changing rows',async()=>{
      const before=await db.balance.findMany({orderBy:{id:'asc'}}),start=sqlTexts.length;
      const report=await auditSpotReserves(db),auditSql=sqlTexts.slice(start);
      assert.equal(report.result,'ISSUES_FOUND');assert.ok(report.issues.some(i=>i.category==='WALLET_RECONCILIATION_REQUIRED'));
      assert.deepEqual(await db.balance.findMany({orderBy:{id:'asc'}}),before);
      assert.ok(auditSql.some(s=>s.includes('SET TRANSACTION READ ONLY')));
      assert.ok(auditSql.every(s=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(s)));
    });
    console.log(`OTC CASH: ${passed} scenarios passed; no production access.`);
  } finally {clearTimeout(watchdog);await db.$disconnect();await other.$disconnect();}
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
