/** Disposable real PostgreSQL + LOCAL TronGrid only. Never uses DATABASE_URL,
 * real wallets, Telegram or production. Build first; DEPOSIT_QA_DEPS selects
 * the same pinned embedded PostgreSQL/pg harness as qa-deposit-packages. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express');const {PrismaClient}=require('@prisma/client');
const {startDatabase}=require('./qa-deposit-packages.cjs');
const {DepositWatchService}=require('../dist/services/deposits/DepositWatchService');
const T='41'+'11'.repeat(20),OTHER='41'+'22'.repeat(20),TOKEN='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TOPIC='ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const H=n=>BigInt(n).toString(16).padStart(64,'0');
const encode=x=>JSON.stringify(x,(_k,v)=>typeof v==='bigint'?v.toString():v);
(async()=>{const database=await startDatabase();const {db}=database;let prisma,server;const checks=[];
 const test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
 try{
  for(const dir of fs.readdirSync('prisma/migrations').sort()){const p=path.join('prisma/migrations',dir,'migration.sql');if(fs.existsSync(p))await db.query(fs.readFileSync(p,'utf8'));}
  prisma=new PrismaClient({datasources:{db:{url:database.url}}});
  const user=await prisma.user.create({data:{email:'native693@example.invalid',passwordHash:'fixture-only',referralCode:'native693',role:'USER'}});
  await prisma.balance.create({data:{userId:user.id,asset:'USDT',available:'321.123'}});
  await prisma.demoBalance.create({data:{userId:user.id,asset:'USDT',available:'1000'}});
  const financial=async()=>encode({balance:await prisma.balance.findMany(),demo:await prisma.demoBalance.findMany(),batches:await prisma.depositBatch.count(),referrals:await prisma.referralReward.count()});
  const baseline=await financial();let clock=Date.now(),head=2000,outage=false,failAudit=true;
  const txs=[
   {n:1,asset:'TRX',sun:'12500000',to:T,finalized:true,success:true,block:1950},
   {n:2,asset:'USDT',sun:'25000000',to:T,finalized:true,success:true,block:1951},
   {n:3,asset:'TRX',sun:'3000000',to:T,finalized:false,success:true,block:1999},
   {n:4,asset:'TRX',sun:'4000000',to:T,finalized:true,success:false,block:1952},
   {n:5,asset:'TRX',sun:'5000000',to:OTHER,finalized:true,success:true,block:1953},
   {n:6,asset:'USDT',sun:'6000000',to:T,finalized:true,success:false,block:1954},
   {n:7,asset:'TRX',sun:'12500000',to:T,finalized:true,success:true,block:1955},
  ].map((t,i)=>({...t,id:H(t.n),ts:clock-10*60_000+i}));
  const native=t=>({txID:t.id,block_timestamp:t.ts,ret:[{contractRet:t.success?'SUCCESS':'REVERT'}],raw_data:{contract:[{type:'TransferContract',parameter:{type_url:'type.googleapis.com/protocol.TransferContract',value:{owner_address:'41'+'55'.repeat(20),to_address:t.to,amount:t.sun}}}]}});
  const app=express();app.use(express.json());const paths=[];
  app.use((req,res,next)=>{paths.push(req.path);if(outage)return res.status(503).json({error:'fixture outage'});next();});
  app.get(['/v1/accounts/:address/transactions','/v1/accounts/:address/transactions/trc20'],(req,res)=>{
   const token=req.path.endsWith('/trc20');let rows=txs.filter(t=>(token?t.asset==='USDT':t.asset==='TRX'));
   if(req.query.min_timestamp)rows=rows.filter(t=>t.ts>=Number(req.query.min_timestamp));
   if(req.query.max_timestamp)rows=rows.filter(t=>t.ts<=Number(req.query.max_timestamp));
   const offset=Number(req.query.fingerprint||0),limit=Number(req.query.limit||200),page=rows.slice(offset,offset+limit);
   res.json({success:true,data:page.map(t=>token?{transaction_id:t.id,to:t.to,value:t.sun,block_timestamp:t.ts,token_info:{address:TOKEN}}:native(t)),meta:offset+limit<rows.length?{fingerprint:String(offset+limit)}:{}});
  });
  app.all('/wallet/getnowblock',(_req,res)=>res.json({block_header:{raw_data:{number:head}}}));
  app.post(['/wallet/gettransactionbyid','/walletsolidity/gettransactionbyid'],(req,res)=>{const t=txs.find(t=>t.id===req.body.value);res.json(!t||req.path.includes('solidity')&&!t.finalized?{}:native(t));});
  app.post(['/wallet/gettransactioninfobyid','/walletsolidity/gettransactioninfobyid'],(req,res)=>{const t=txs.find(t=>t.id===req.body.value);if(!t||req.path.includes('solidity')&&!t.finalized)return res.json({});
   const token=t.asset==='USDT';res.json({id:t.id,blockNumber:t.block,blockTimeStamp:t.ts,...(!t.success?{result:'FAILED'}:{}),receipt:token?{result:t.success?'SUCCESS':'REVERT'}:{net_usage:268},
    ...(token?{log:[{address:'a614f803b6fd780986a42c78ec9c7f77e6ded13c',topics:[TOPIC,'0'.repeat(64),'0'.repeat(24)+t.to.slice(2)],data:BigInt(t.sun).toString(16).padStart(64,'0')}]}:{})});});
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const origin='http://127.0.0.1:'+server.address().port;
  const config={chain:'tron',type:'tron',treasuryAddress:T,nativeAsset:'TRX',minConfirmations:19,tokens:{USDT:{contractAddress:TOKEN,decimals:6}},apiUrl:origin};
  const sent=new Map(),attempts=[];const notify=async transfer=>{assert.ok(transfer.verifiedAt&&transfer.finalized&&transfer.confirmations>=19);assert.equal(transfer.requiredConfirmations,19);attempts.push(transfer.id);if(!sent.has(transfer.id))sent.set(transfer.id,{asset:transfer.asset,txHash:transfer.txHash,amount:transfer.amount.toString()});return 'SENT';};
  const auditProxy=new Proxy(prisma.auditLog,{get(target,key){if(key==='upsert')return async args=>{if(failAudit&&args.create?.action==='DEPOSIT_NOTIFICATION_DELIVERY'){failAudit=false;throw Error('fixture crash after durable Worker delivery');}return target.upsert(args);};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
  const client=new Proxy(prisma,{get(target,key){if(key==='auditLog')return auditProxy;const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
  const fetchLocal=(url,init)=>{assert.equal(new URL(String(url)).origin,origin,'external network forbidden');return fetch(url,init);};
  const limits={pageSize:2,initialBackfillMs:60*60_000,maxPagesPerRun:10};
  const makeWatch=()=>new DepositWatchService(client,async()=>config,fetchLocal,()=>clock,limits,notify);
  let watch=makeWatch();
  await test('native page commit: injected cursor failure rolls back both proved rows and progress',async()=>{
   await db.query(`CREATE FUNCTION qa_native_cursor_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated cursor failure'; END $$;
    CREATE TRIGGER qa_native_cursor_failure BEFORE UPDATE ON "DepositWatchCursor" FOR EACH ROW WHEN (NEW."pageCursor" IS NOT NULL) EXECUTE FUNCTION qa_native_cursor_failure();`);
   const r=await watch.runOnce('admin');assert.equal(r.ok,false);assert.equal(await prisma.deposit.count(),0);assert.equal(sent.size,0);
   await db.query('DROP TRIGGER qa_native_cursor_failure ON "DepositWatchCursor"; DROP FUNCTION qa_native_cursor_failure();');
  });
  await test('native TRX and USDT on the same recipient retain the real asset; pending/failed/wrong recipient never notify',async()=>{
   const r=await watch.runOnce('admin');assert.equal(r.ok,true,r.error);const rows=await prisma.deposit.findMany();
   assert.equal(rows.find(d=>d.txHash===H(1)).asset,'TRX');assert.equal(rows.find(d=>d.txHash===H(1)).amount.toString(),'12.5');
   assert.equal(rows.find(d=>d.txHash===H(2)).asset,'USDT');assert.equal(rows.find(d=>d.txHash===H(3)).finalized,false);
   assert.equal(rows.some(d=>[H(4),H(5)].includes(d.txHash)),false);assert.ok(rows.find(d=>d.txHash===H(6)).verifyError);
   assert.deepEqual([...sent.values()].map(s=>s.asset).sort(),['TRX','TRX','USDT']);assert.ok(rows.every(d=>d.userId===null&&d.status==='PENDING'));
  });
  await test('crash after delivery, repeated scan and restart: no duplicate transfer or Telegram send; durable ack recovers',async()=>{
   const count=await prisma.deposit.count();clock+=5*60_000;watch=makeWatch();assert.equal((await watch.runOnce('admin')).ok,true);
   assert.equal(await prisma.deposit.count(),count);assert.equal(sent.size,3);assert.equal(await prisma.auditLog.count({where:{action:'DEPOSIT_NOTIFICATION_DELIVERY'}}),3);
   assert.ok(attempts.length>sent.size,'same durable event retried for missing acknowledgement');
  });
  await test('pending native transfer becomes notify-eligible only after finality and required measured confirmations',async()=>{
   txs.find(t=>t.n===3).finalized=true;head=2020;clock+=5*60_000;assert.equal((await watch.runOnce('admin')).ok,true);
   const row=await prisma.deposit.findUniqueOrThrow({where:{chain_txHash:{chain:'tron',txHash:H(3)}}});assert.equal(row.finalized,true);assert.equal(row.confirmations,22);assert.equal(sent.size,4);
  });
  await test('provider outage preserves durable cursors; detection never scans an unapproved recipient',async()=>{
   const before=encode(await prisma.depositWatchCursor.findMany({orderBy:{id:'asc'}}));outage=true;clock+=5*60_000;assert.equal((await watch.runOnce('admin')).ok,false);outage=false;
   const after=await prisma.depositWatchCursor.findMany({orderBy:{id:'asc'}});const old=JSON.parse(before);for(const c of after){const p=old.find(p=>p.id===c.id);assert.equal(c.scannedThroughMs.toString(),p.scannedThroughMs);assert.equal(c.pageCursor,p.pageCursor);}
   assert.ok(paths.filter(p=>p.includes('/v1/accounts/')).every(p=>p.includes(T)));assert.equal(sent.size,4);
  });
  if(process.argv.includes('--browser'))await test('authenticated admin renders verified TRX and USDT separately at 1440 / 390 without financial requests',async()=>{
   process.env.JWT_SECRET='isolated-native693-browser-not-production';
   const jwt=require('jsonwebtoken');const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'playwright');
   const admin=await prisma.user.create({data:{email:'admin693@example.invalid',passwordHash:'fixture-only',referralCode:'admin693',role:'ADMIN'}});
   const web=express();web.use(express.json());
   const {adminDepositsRouter}=require('../dist/api/routes/adminDeposits');
   web.use('/api/v1',adminDepositsRouter(prisma,{getTicker:async()=>null},{watch}));
   web.get('/api/v1/me',(_req,res)=>res.json({id:admin.id,email:admin.email,role:'ADMIN',isAdmin:true,displayName:'ISOLATED QA'}));
   web.get('/api/v1/*',(_req,res)=>res.status(503).json({error:'unrelated isolated endpoint'}));
   web.use(express.static(path.resolve('frontend/dist'),{index:false}));
   const token=jwt.sign({sub:admin.id},process.env.JWT_SECRET,{expiresIn:'1h'});
   web.get('*',(_req,res)=>res.type('html').send(fs.readFileSync('frontend/dist/index.html','utf8').replace('<head>',`<head><script>localStorage.setItem('exchange_token',${JSON.stringify(token)});localStorage.setItem('exchange_lang','ru');</script>`)));
   const s=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s));});const url='http://127.0.0.1:'+s.address().port;
   const browser=await chromium.launch({channel:'msedge',headless:true});fs.mkdirSync('output/trx693',{recursive:true});
   try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900}});let writes=0;const errors=[];
    await context.route('**/*',route=>{const req=route.request();if(new URL(req.url()).origin!==url)return route.abort();
     // Suppress the existing nonfinancial automatic scan trigger. This test
     // opens a persisted queue only; it must not initiate another scan.
     if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/v1/admin/deposit-watch/open')return route.fulfill({json:{ran:false,result:'PAUSED'}});
     if(!['GET','HEAD'].includes(req.method())){writes++;return route.abort();}return route.continue();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url+'/admin/deposits#unattributed');
    for(const [n,asset,amount]of [[1,'TRX','12.5'],[2,'USDT','25']]){
     const row=page.locator('[data-deposit-row]').filter({has:page.locator(`[title="${H(n)}"]`)});
     await row.waitFor();assert.match(await row.innerText(),new RegExp(asset));assert.ok((await row.innerText()).includes(amount));
    }
    assert.equal(writes,0);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
    await page.screenshot({path:`output/trx693/admin-assets-${width}.png`,fullPage:true});await context.close();
   }}finally{await browser.close();await new Promise(r=>s.close(r));}
  });
  await test('Balance / DemoBalance / packages / referral accounting unchanged and no attribution or CREDITED rows',async()=>{
   assert.equal(await financial(),baseline);assert.equal(await prisma.deposit.count({where:{OR:[{status:'CREDITED'},{userId:{not:null}}]}}),0);
  });
  const report={status:'PASS',scope:'isolated native PostgreSQL and local TronGrid; not production evidence',checks,version:(await db.query('SELECT version()')).rows[0].version,balancesUnchanged:true,uniqueNotices:sent.size,notificationAttempts:attempts.length};
  fs.mkdirSync('output/trx693',{recursive:true});fs.writeFileSync('output/trx693/postgres.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();await database.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
