/** Local-only deletion regression. Never uses production DATABASE_URL. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const qaRequire = createRequire(path.resolve(process.env.ADMIN_DELETE_QA_DEPS || '../admin-deletion-qa-deps/package.json'));
const output = path.resolve('output/admin-user-deletion'); fs.mkdirSync(output, { recursive: true });
const express = require('express'), request = require('supertest'), jwt = require('jsonwebtoken');
const { PrismaClient, Prisma } = require('@prisma/client');
const BigNumber = require('bignumber.js');
process.env.JWT_SECRET = 'local-admin-delete-qa-only-not-production';
process.env.API_KEY_ENCRYPTION_SECRET = '12'.repeat(32);
const { encryptApiSecret } = require('../dist/services/ApiKeyService');
const { requireAuthOrApiKey } = require('../dist/api/middleware/apiKeyAuth');
async function startDatabase() {
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const bin = qaRequire(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const scratch = process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Temp') : os.tmpdir();
  const dataDir = path.join(fs.mkdtempSync(path.join(scratch, 'voltex-admin-delete-qa-')), 'data');
  const init = spawnSync(bin.initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const logFile = path.join(output, 'postgres.log');
  const controlLog = path.join(output, 'pg-ctl.log');
  const fd = fs.openSync(controlLog, 'w');
  let start;
  try { start = spawnSync(bin.pg_ctl, ['-D', dataDir, '-l', logFile, '-o', `-h 127.0.0.1 -p ${port}`, 'start', '-w'], { windowsHide: true, stdio: ['ignore', fd, fd] }); }
  finally { fs.closeSync(fd); }
  assert.equal(start.status, 0, fs.readFileSync(controlLog, 'utf8'));
  const db = new (qaRequire('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await db.connect();
  return { url: `postgresql://postgres@127.0.0.1:${port}/postgres`, db, stop: async () => {
    await db.end();
    const stop = spawnSync(bin.pg_ctl, ['-D', dataDir, 'stop', '-m', 'fast', '-w'], { windowsHide: true, encoding: 'utf8' });
    assert.equal(stop.status, 0, stop.stderr);
  } };
}

const { AdminUserDeletionService } = require('../dist/services/AdminUserDeletionService');
const { AccountDeletionGate } = require('../dist/services/AccountDeletionGate');
const { MatchingEngine } = require('../dist/matching-engine/MatchingEngine');
const { adminUsersRouter } = require('../dist/api/routes/adminUsers');
const { requireAuth } = require('../dist/api/middleware/auth');
const { DepositAttributionService } = require('../dist/services/deposits/DepositAttributionService');
const report = { checks: [], failures: [] };
async function main() {
 const database = await startDatabase(); let prisma;
 try {
  for(const dir of fs.readdirSync('prisma/migrations').sort()) {
   const file=path.join('prisma/migrations',dir,'migration.sql');
   if(dir.endsWith('_admin_account_deletion')) {
    await database.db.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode","updatedAt") VALUES ('migration-survivor','migration@example.invalid','fixture','migration-survivor',NOW())`);
    await database.db.query(`INSERT INTO "Deposit" (id,"userId",chain,"txHash",asset,amount,status) VALUES ('migration-deposit','migration-survivor','tron','migration-hash','USDT',300,'CREDITED')`);
    await database.db.query(`INSERT INTO "Withdrawal" (id,"userId",network,"txHash",asset,amount,status,"toAddress","updatedAt") VALUES ('migration-withdrawal','migration-survivor','TRC20','migration-outbound','USDT',25,'SENT','fixture',NOW())`);
   }
   if(fs.existsSync(file)) await database.db.query(fs.readFileSync(file,'utf8'));
  }
  prisma = new PrismaClient({datasources:{db:{url:database.url+'?connection_limit=12'}}});
  const gate = new AccountDeletionGate(); const books={spot:new MatchingEngine(),futures:new MatchingEngine(),demo:new MatchingEngine()};
  const service = new AdminUserDeletionService(prisma,gate,books);
  const app=express(); app.use(express.json()); app.use('/api/v1',adminUsersRouter(prisma,{},service));
  app.get('/protected',requireAuth(prisma),(_req,res)=>res.json({ok:true}));
  app.get('/key-protected',requireAuthOrApiKey(prisma),(_req,res)=>res.json({ok:true}));
  const user = (id,extra={})=>prisma.user.create({data:{id,email:id+'@example.invalid',passwordHash:'test-only',referralCode:id,...extra}});
  await user('admin',{role:'ADMIN'}); await user('other');
  const header = id => 'Bearer '+jwt.sign({sub:id},process.env.JWT_SECRET);
  const remove = (id,caller='admin') => request(app).delete('/api/v1/admin/users/'+id).set('Authorization',header(caller));
  async function test(name,fn){try{await fn();report.checks.push(name);console.log('PASS '+name)}catch(error){report.failures.push({name,error:String(error.stack||error)});console.error('FAIL '+name+'\n'+(error.stack||error));}}
  await test('additive migration preserves existing user, credited deposit and sent withdrawal',async()=>{
   assert.ok(await prisma.user.findUnique({where:{id:'migration-survivor'}}));
   const d=await prisma.deposit.findUnique({where:{id:'migration-deposit'}}),w=await prisma.withdrawal.findUnique({where:{id:'migration-withdrawal'}});
   assert.equal(d.amount.toString(),'300');assert.equal(d.txHash,'migration-hash');assert.equal(d.status,'CREDITED');assert.equal(d.userId,'migration-survivor');
   assert.equal(w.amount.toString(),'25');assert.equal(w.txHash,'migration-outbound');assert.equal(w.status,'SENT');assert.equal(w.userId,'migration-survivor');
  });
  await test('ordinary empty USER deletion + one USER_DELETED without IP/UA',async()=>{
   await user('empty');assert.equal((await remove('empty')).status,200);
   assert.equal(await prisma.user.findUnique({where:{id:'empty'}}),null);
   const audit=await prisma.auditLog.findFirst({where:{action:'USER_DELETED'}});
   assert.deepEqual(Object.keys(audit.metadata).sort(),['deletedUserEmail','deletedUserId','performedByAdminId','timestamp']);
  });
  await test('non-admin caller, ADMIN/self and protected email refused with 403',async()=>{
   await user('protected',{email:'voltex.crypto@gmail.com'});await user('admin2',{role:'ADMIN'});
   for(const [target,caller] of [['other','other'],['admin','admin'],['admin2','admin'],['protected','admin']]) assert.equal((await remove(target,caller)).status,403);
  });
  const id='populated'; await user(id,{twoFactorSecret:'test-only',twoFactorEnabled:true,twoFactorBackupCodes:['test-backup']});
  const seeded=[];
  async function seed(model,overrides={}) {
   const metadata=Prisma.dmmf.datamodel.models.find(m=>m.name===model),data={...(metadata.fields.some(f=>f.name==='userId')?{userId:id}:{}),...overrides};
   for(const field of metadata.fields){
    if(field.kind==='object'||field.name in data||!field.isRequired||field.hasDefaultValue||field.isUpdatedAt)continue;
    if(field.isList){data[field.name]=[];continue;}
    if(field.name==='userId')data[field.name]=id;
    else if(field.name==='positionId')data[field.name]='fixture-position';
    else if(field.name==='productId')data[field.name]='fixture-product';
    else if(field.kind==='enum')data[field.name]=Prisma.dmmf.datamodel.enums.find(e=>e.name===field.type).values[0].name;
    else data[field.name]=({String:model+'-'+field.name,Int:1,BigInt:1n,Float:1,Decimal:'1',Boolean:false,DateTime:new Date(),Json:{fixture:true}})[field.type];
   }
   const row=await prisma[model[0].toLowerCase()+model.slice(1)].create({data});seeded.push(model);return row;
  }
  await seed('Product',{id:'fixture-product'});
  await seed('FuturesPosition',{id:'fixture-position'});
  const list=['Session','ApiKey','EmailVerificationChallenge','DepositClaim','CardApplication','KycSubmission','Purchase','PortfolioSnapshot','FuturesPositionProtection','FundingPayment','FuturesOrder','FuturesBalance','CfdPosition','Order','Balance','Wallet','DemoOrder','DemoBalance','PrivateTradingPreview','PrivateTradingCommand','PrivateTradingLedger','PrivateTradingCard','PrivateTradingAccount','NativeDemoLiveProjection','NativeDemoRevision','NativeDemoAccount'];
  for(const m of list) await seed(m);
  await user('referred',{referredById:id});
  const now=new Date();
  const deposit=await prisma.deposit.create({data:{id:'uncredited',userId:id,asset:'USDT',chain:'tron',txHash:'a'.repeat(64),amount:'15',status:'DETECTED'}});
  await prisma.deposit.create({data:{id:'credited',userId:id,asset:'USDT',chain:'tron',txHash:'b'.repeat(64),amount:'350',status:'CREDITED',creditedAt:now}});
  await seed('Withdrawal',{id:'real-withdrawal',status:'SENT',txHash:'c'.repeat(64)});
  await seed('Withdrawal',{id:'internal-withdrawal',txHash:null});
  await prisma.referralReward.create({data:{referrerId:'other',referredUserId:id,depositId:deposit.id,asset:'USDT',amount:'1.5'}});
  await prisma.bankingReferralReward.create({data:{referrerId:id,referredUserId:'other',placementId:'history-other',bankingRewardLedgerEntryId:'history-entry',asset:'USDT',sourceProfitAmount:'10',commissionRate:'0.2',amount:'2'}});
  await database.db.query(`INSERT INTO banking_placements (id,user_id,program_id,asset,principal,monthly_rate,term_months,compound,payout_frequency,lock_rule,opened_at,matures_at) VALUES ('placement',$1,'fixture','USDT',10,0.1,1,false,'MONTHLY','NONE',NOW(),NOW())`,[id]);
  await database.db.query(`INSERT INTO banking_ledger_entries(id,user_id,placement_id,entry_type,asset,amount,effective_at) VALUES ('ledger',$1,'placement','OPEN','USDT',10,NOW())`,[id]);
  await database.db.query(`INSERT INTO banking_commands(id,user_id,idempotency_key,action,request_hash,result_json) VALUES ('command',$1,'fixture','OPEN','fixture','{}')`,[id]);
  const engineOrder=(oid,pair)=>({id:oid,userId:id,pair,side:'BUY',type:'LIMIT',price:new BigNumber(1),originalQuantity:new BigNumber(1),remainingQuantity:new BigNumber(1),status:'OPEN',createdAt:1,updatedAt:1});
  const spot=await prisma.order.findFirst({where:{userId:id}}), fut=await prisma.futuresOrder.findFirst({where:{userId:id}}),demo=await prisma.demoOrder.findFirst({where:{userId:id}});
  books.spot.loadRestingOrder(engineOrder(spot.id,spot.pair));books.futures.loadRestingOrder(engineOrder(fut.id,fut.symbol));books.demo.loadRestingOrder(engineOrder(demo.id,demo.pair));
  const key=await prisma.apiKey.findFirst({where:{userId:id}});
  await prisma.apiKey.update({where:{id:key.id},data:{encryptedSecret:encryptApiSecret('fixture-secret'),revokedAt:null}});
  const signedKeyRequest=()=>{const timestamp=String(Date.now());const signature=require('crypto').createHmac('sha256','fixture-secret').update(timestamp+'GET/key-protected{}').digest('hex');return request(app).get('/key-protected').set('X-API-KEY',key.apiKey).set('X-API-TIMESTAMP',timestamp).set('X-API-SIGNATURE',signature);};
  assert.equal((await signedKeyRequest()).status,200);
  const session=await prisma.session.findFirst({where:{userId:id}});
  const sidHeader='Bearer '+jwt.sign({sub:id,sid:session.id},process.env.JWT_SECRET);
  await test('native and banking immutable triggers still reject direct deletes',async()=>{
   await assert.rejects(database.db.query('DELETE FROM "NativeDemoRevision" WHERE "userId"=$1',[id]),/immutable/);
   await assert.rejects(database.db.query('DELETE FROM banking_ledger_entries WHERE user_id=$1',[id]),/immutable/);
  });
  await test('rollback preserves every table, audit and order books',async()=>{
   await database.db.query(`CREATE FUNCTION qa_reject_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END; $$; CREATE TRIGGER qa_reject_user_delete BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION qa_reject_user_delete()`);
   try {assert.equal((await remove(id)).status,500);assert.ok(await prisma.user.findUnique({where:{id}}));assert.equal(await prisma.session.count({where:{userId:id}}),1);assert.equal((await prisma.deposit.findUnique({where:{id:'uncredited'}})).userId,id);assert.ok(books.spot.getBook(spot.pair).bestBid());assert.equal(await prisma.auditLog.count({where:{action:'USER_DELETED',metadata:{path:['deletedUserId'],equals:id}}}),0);}
   finally{await database.db.query('DROP TRIGGER qa_reject_user_delete ON "User"');}
  });
  await test('deferred COMMIT failure preserves the account and all three books',async()=>{
   await database.db.query(`CREATE CONSTRAINT TRIGGER qa_deferred_delete AFTER DELETE ON "User" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_reject_user_delete()`);
   try {
    assert.equal((await remove(id)).status,409);
    assert.ok(await prisma.user.findUnique({where:{id}}));
    assert.ok(books.spot.getBook(spot.pair).bestBid());assert.ok(books.futures.getBook(fut.symbol).bestBid());assert.ok(books.demo.getBook(demo.pair).bestBid());
    assert.equal(await prisma.auditLog.count({where:{action:'USER_DELETED',metadata:{path:['deletedUserId'],equals:id}}}),0);
   } finally {await database.db.query('DROP TRIGGER qa_deferred_delete ON "User"; DROP FUNCTION qa_reject_user_delete()');}
  });
  await test('all owned records removed including balances/orders/positions/security/KYC/private/native/banking/card',async()=>{
   const res=await remove(id);assert.equal(res.status,200,JSON.stringify(res.body));
   for(const m of [...list,'FuturesPosition']) assert.equal(await prisma[m[0].toLowerCase()+m.slice(1)].count({where:{userId:id}}),0,m);
   for(const table of ['banking_placements','banking_ledger_entries','banking_commands']) assert.equal((await database.db.query('SELECT count(*)::int AS n FROM '+table+' WHERE user_id=$1',[id])).rows[0].n,0,table);
   assert.equal(books.spot.getBook(spot.pair).bestBid(),undefined);assert.equal(books.futures.getBook(fut.symbol).bestBid(),undefined);assert.equal(books.demo.getBook(demo.pair).bestBid(),undefined);
  });
  await test('uncredited real deposit retained and permanently ignored; credited hash/history retained',async()=>{
   const d=await prisma.deposit.findUnique({where:{id:'uncredited'}});assert.equal(d.userId,null);assert.equal(d.deletedUserId,id);assert.equal(d.status,'IGNORED');assert.equal(d.ignoredReason,'DELETED_TEST_ACCOUNT');assert.equal(d.ignoredByAdminId,'admin');assert.ok(d.ignoredAt);assert.equal(d.amount.toString(),'15');
   const credited=await prisma.deposit.findUnique({where:{id:'credited'}});assert.equal(credited.status,'CREDITED');assert.equal(credited.userId,null);assert.equal(credited.creditedAt.getTime(),now.getTime());
   assert.equal(await prisma.ignoredIncomingTransfer.count({where:{chain:'tron',txHash:d.txHash}}),1);
   for(const depositId of ['uncredited','credited']) {
    await assert.rejects(new DepositAttributionService(prisma).attribute({adminId:'admin',depositId,userId:'other',reassign:true}));
    await assert.rejects(prisma.deposit.update({where:{id:depositId},data:{status:'CREDITED',userId:'other'}}));
    await assert.rejects(prisma.deposit.delete({where:{id:depositId}}));
   }
   const duplicate=await prisma.deposit.createMany({data:[{asset:'USDT',chain:'tron',txHash:d.txHash,amount:'15',status:'DETECTED'}],skipDuplicates:true});assert.equal(duplicate.count,0);
   const { DepositIgnoreService }=require('../dist/services/deposits/DepositIgnoreService');
   await assert.rejects(new DepositIgnoreService(prisma).restore({adminId:'admin',depositId:'uncredited'}),e=>e.code==='DELETED_ACCOUNT');
  });
  await test('deleted deposits never enter queue or package accumulation',async()=>{
   const { DepositQueueService, buildPackage }=require('../dist/services/deposits/DepositQueueService');
   const { DepositBatchService }=require('../dist/services/deposits/DepositBatchService');
   const prices={getTicker:async()=>null};
   const queue=await new DepositQueueService(prisma,prices).load();
   assert.equal(queue.counts.UNATTRIBUTED,0);assert.equal(queue.packages.length,0);
   const preview=await new DepositBatchService(prisma,prices,async()=>{throw Error('must not query chain')}).preview({userId:id,chain:'tron',asset:'USDT'});
   assert.equal(preview.total,'0');assert.equal(preview.transfers.length,0);
  });
  await test('real withdrawal retained; internal withdrawal removed',async()=>{
   const w=await prisma.withdrawal.findUnique({where:{id:'real-withdrawal'}});assert.equal(w.userId,null);assert.equal(w.deletedUserId,id);assert.equal(w.txHash,'c'.repeat(64));assert.equal(await prisma.withdrawal.findUnique({where:{id:'internal-withdrawal'}}),null);
  });
  await test('other users and historical referral rewards preserved',async()=>{
   assert.ok(await prisma.user.findUnique({where:{id:'other'}}));assert.equal((await prisma.user.findUnique({where:{id:'referred'}})).referredById,null);
   const r=await prisma.referralReward.findFirst();assert.equal(r.referrerId,'other');assert.equal(r.referredUserId,null);assert.equal(r.deletedReferredUserId,id);assert.equal(r.amount.toString(),'1.5');
   const b=await prisma.bankingReferralReward.findFirst();assert.equal(b.referrerId,null);assert.equal(b.deletedReferrerId,id);assert.equal(b.referredUserId,'other');
  });
  await test('old session JWT and legacy JWT denied after deletion',async()=>{
   for(const h of [header(id),sidHeader])assert.equal((await request(app).get('/protected').set('Authorization',h)).status,401);
  });
  await test('previously working API key denied after delete',async()=>{assert.equal((await signedKeyRequest()).status,401);});
  await test('concurrent double delete: one 200, one 404/409; one audit',async()=>{
   await user('race');const responses=await Promise.all([remove('race'),remove('race')]);const codes=responses.map(r=>r.status).sort();assert.equal(codes[0],200);assert.ok([404,409].includes(codes[1]));assert.equal(await prisma.auditLog.count({where:{action:'USER_DELETED',metadata:{path:['deletedUserId'],equals:'race'}}}),1);
  });
  await test('all database foreign keys validate after cleanup',async()=>{
   const fks=await database.db.query(`SELECT conrelid::regclass::text AS tbl,conname FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`);
   for(const fk of fks.rows)await database.db.query('ALTER TABLE '+fk.tbl+' VALIDATE CONSTRAINT "'+fk.conname.replaceAll('"','""')+'"');
  });
  await test('deletion gate drains in-flight operations, blocks newcomers, resumes on rollback',async()=>{
   let release;const trace=[];const first=gate.run(false,async()=>{trace.push('active');await new Promise(r=>release=r);trace.push('settled');});
   await new Promise(r=>setImmediate(r));const deletion=gate.run(true,async()=>{trace.push('delete');throw Error('rollback');}).catch(()=>{});
   const next=gate.run(false,async()=>trace.push('next'));release();await Promise.all([first,deletion,next]);assert.deepEqual(trace,['active','settled','delete','next']);
  });
  await test('unverifiable COMMIT outcome fails closed instead of resuming stale matching',async()=>{
   await user('uncertain');
   const isolatedGate=new AccountDeletionGate();
   const faultDb=new Proxy(prisma,{get(target,key){if(key==='$queryRaw')return async()=>{throw Error('verification connection lost')};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
   await assert.rejects(new AdminUserDeletionService(faultDb,isolatedGate,books).delete('admin','uncertain'),e=>e.status===503);
   assert.equal(await prisma.user.findUnique({where:{id:'uncertain'}}),null);
   await assert.rejects(isolatedGate.run(false,async()=>{}),/reconciliation/);
  });
  if(process.argv.includes('--browser')) await test('desktop/mobile browser acceptance',()=>browserChecks(app,prisma,user,header));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  if(report.failures.length) process.exitCode=1;
 } finally {await prisma?.$disconnect();await database.stop();}
 console.log(JSON.stringify({passed:report.checks.length,failed:report.failures.length}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
async function browserChecks(app, prisma, user, header) {
 const { chromium } = require(process.env.PLAYWRIGHT_MODULE || qaRequire.resolve('playwright'));
 app.get('/api/v1/me',(_req,res)=>res.json({id:'admin',email:'admin@example.invalid',isAdmin:true,role:'ADMIN',kycStatus:'NOT_STARTED'}));
 app.get('/api/v1/admin/user-activity',async(_req,res)=>res.json({totalUsers:await prisma.user.count(),newUsers24h:0,pendingKyc:0,packages:[],counts:{},awaitingConfirmationsByUser:{}}));
 app.get('/api/v1/admin/deposits/recent-by-user',(_req,res)=>res.json([]));
 app.use(express.static(path.resolve('frontend/dist')));
 app.get('*',(_req,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  for(const width of [1440,390]) {
   const id='browser-'+width;await user(id);
   const context=await browser.newContext({viewport:{width,height:1000}});
   await context.addInitScript(token=>localStorage.setItem('exchange_token',token),header('admin').slice(7));
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/v1/')){
     if(url.pathname==='/api/v1/admin/deposits/recent-by-user')return route.fulfill({json:[]});
     const response=await route.fetch({url:origin+url.pathname+url.search});return route.fulfill({response});
    }
    if(url.origin===origin)return route.continue();
    return route.abort();
   });
   await page.goto(origin+'/admin/users');
   const search=page.getByRole('textbox',{name:'Поиск пользователей'});await search.fill(id+'@');
   const table=page.locator('.admin-table-desktop');
   await table.getByRole('button',{name:'Действия',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:/^(Заблокировать|Разблокировать)$/}).count(),0);
   await table.getByRole('button',{name:'Удалить аккаунт',exact:true}).click();
   const dialog=page.getByRole('dialog');await dialog.waitFor({state:'visible'});
   assert.ok((await dialog.innerText()).includes(id+'@example.invalid'));
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
   await page.screenshot({path:path.join(output,'delete-confirm-'+width+'.png'),fullPage:true});
   await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
   assert.ok(await prisma.user.findUnique({where:{id}}));
   await table.getByRole('button',{name:'Действия',exact:true}).click();
   await table.getByRole('button',{name:'Удалить аккаунт',exact:true}).click();
   let deleteRequests=0;
   await page.route('**/api/v1/admin/users/'+id,async route=>{
    if(route.request().method()!=='DELETE')return route.fallback();
    deleteRequests++;
    if(deleteRequests===1)return route.fulfill({status:409,json:{error:'Тестовый конфликт. Повторите попытку.'}});
    return route.fallback();
   });
   const confirm=page.getByRole('button',{name:'Удалить аккаунт безвозвратно',exact:true});
   await confirm.click();
   await dialog.getByRole('alert').waitFor({state:'visible'});
   assert.ok(await prisma.user.findUnique({where:{id}}));
   await confirm.evaluate(button=>{button.click();button.click();});
   await dialog.waitFor({state:'hidden'});
   assert.equal(deleteRequests,2,'double click submits only one retry');
   await page.waitForFunction(()=>document.body.textContent.includes('Никого не найдено.'));
   assert.equal(await prisma.user.findUnique({where:{id}}),null);
   assert.equal(await page.locator('a[href="/admin/audit-log"]').count(),0);
   await page.goto(origin+'/admin/users/'+id);await page.waitForURL(origin+'/admin/users');
   const detailId='detail-'+width;await user(detailId);
   await page.goto(origin+'/admin/users/'+detailId);
   await page.getByRole('button',{name:'Удалить аккаунт',exact:true}).click();
   await page.getByRole('button',{name:'Удалить аккаунт безвозвратно',exact:true}).click();
   await page.waitForURL(origin+'/admin/users');
   assert.equal(await prisma.user.findUnique({where:{id:detailId}}),null);
   await page.goto(origin+'/admin/users/protected');
   await page.getByText('voltex.crypto@gmail.com',{exact:true}).first().waitFor({state:'visible'});
   assert.equal(await page.getByRole('button',{name:'Удалить аккаунт',exact:true}).count(),0);
   assert.deepEqual(errors,[]);
   report.checks.push('browser '+width+'px: confirmation/cancel/conflict/retry/double-click/list/detail/redirect/protected/journal hidden');
   console.log('PASS browser '+width+'px');await context.close();
  }
 } finally {await browser.close();await new Promise(r=>server.close(r));}
}

