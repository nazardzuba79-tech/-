'use strict';
// Runs inside an isolated container; only fixture PostgreSQL and local workerd exist.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),cp=require('child_process'),{createRequire}=require('module');
const appRequire=createRequire('/app/package.json'),edge=createRequire('/qa/repo/workers/market-edge/package.json');
const {PrismaClient}=appRequire('@prisma/client'),jwt=appRequire('jsonwebtoken');
const {Miniflare,convertV4MiniflareOptions}=edge('miniflare');
const phase=process.argv[2],manifest=require('/qa/candidate/manifest.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let db,mf,server;const checks=[];
const ok=(name)=>{checks.push(name);console.log('PASS '+phase+': '+name)};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert(['baseline','install','rollback'].includes(phase));
 for(const f of ['/app/.env','/app/.env.production','/app/.env.local'])assert(!fs.existsSync(f),'Refuse baked environment file before API startup');
 const u=new URL(process.env.DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.pathname,'/voltex_container_smoke');
 const expected=phase==='install'?manifest.after:phase==='rollback'?manifest.rollbackAfter:manifest.before;
 for(const [p,h]of Object.entries(expected))if(p.startsWith('api/')){const f='/app/dist/'+p.slice(4);assert.equal(fs.existsSync(f)?hash(fs.readFileSync(f)):null,h,p);}
 ok('every installed API module matches the sealed phase identity');
 const worker=phase==='install'?'/qa/candidate/worker.js':'/qa/candidate/worker.rollback';
 assert.equal(hash(fs.readFileSync(worker)),phase==='install'?manifest.after['worker.js']:manifest.installedWorkerSha256);
 let outbound=0;const token='isolated-history20-store-only-000001';
 mf=new Miniflare({...convertV4MiniflareOptions({port:8787,host:'127.0.0.1',durableObjectsPersist:'/worker-state',workers:[{name:'market-edge',modules:true,script:fs.readFileSync(worker,'utf8'),compatibilityDate:'2026-09-01',bindings:{LISTINGS_STORE_TOKEN:token,LISTINGS_PUBLIC_CACHE_MS:'0'},durableObjects:{LISTINGS:{className:'ManagedListingsDO',useSQLite:true}},outboundService:()=>{outbound++;throw Error('External request forbidden');}}]}),isolatedResourcePersistencePath:'/worker-state',resourcePersistencePath:'/worker-state',telemetry:{enabled:false}});
 await mf.ready;
 const admin=async(p,method='GET',body)=>{const r=await mf.dispatchFetch('http://market.local/internal/listings'+p,{method,headers:{Authorization:'Bearer '+token,'X-Voltex-Admin-Id':'qa-h20-admin','Content-Type':'application/json','If-Match':'0'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 if(phase==='baseline'){
  const config={schemaVersion:1,symbol:'QACYCLE',name:'Isolated rollback fixture',logo:null,initialPrice:'0.25',listingAt:'2030-01-01T00:00:00Z',displayTimeZone:'UTC',ownerAllocation:'0',seedMode:'manual',seed:'isolated-cycle-fixture',tradable:false};
  assert.equal((await admin('/qa-cycle-legacy/draft','PUT',{config})).status,200);
 }
 const previousPath='/qa/report/worker-state.json';
 const before=await admin('');assert.equal(before.status,200);
 const storedState=body=>{assert.equal(typeof body.serverTime,'number');const {serverTime,...persisted}=body;return persisted;};
 if(phase!=='baseline')assert.deepEqual(storedState(before.body),JSON.parse(fs.readFileSync(previousPath)),'persistent DO records changed across code switch');
 ok('legacy draft, revisions and timer state preserved across Worker code switch');
 if(phase==='install'){
  const {defaultScenarioControls}=require('/app/dist/shared/listingScenarioControls');
  const {buildHistoricalGrowthProgram,historicalGrowthMaxPrice}=require('/app/dist/shared/listingHistoricalGrowth');
  const rows=Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2020,0,1)+i*86400000).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,close:101+i}));
  const growth=buildHistoricalGrowthProgram({scenarioId:'VHX-07-SOL',targetPeakGrowthPercent:'9348',rows,source:{provider:'Binance Vision',asset:'SOL',quote:'USDT',metric:'spot daily OHLCV',dataKind:'exchange_ohlcv',timeframe:'1d',sliceSha256:'b'.repeat(64),license:'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms'}});
  const config={schemaVersion:1,symbol:'VHX07',name:'Isolated private fixture',logo:null,initialPrice:'2',listingAt:new Date(Math.ceil(Date.now()/10000)*10000+86400000).toISOString(),displayTimeZone:'UTC',ownerAllocation:'0',seedMode:'manual',seed:'isolated-private-cycle',tradable:false,simulationProgram:{...defaultScenarioControls('2','CALM'),stages:[],first24hGainPercent:'0',afterGrowth:'range',growth:'historical-window',historicalGrowth:growth,maxPrice:historicalGrowthMaxPrice('2',growth.targetPeakGrowthPercent)},privateTest:{settlement:'SIMUSDT',funding:{base:'100',quote:'1000'}}};
  const draft=await admin('/qa-cycle-private/draft','PUT',{config});assert.equal(draft.status,200,JSON.stringify(draft.body));
  const publish=await admin('/qa-cycle-private/publish','POST',{draftRevision:draft.body.draftRevision,publishKey:'qa-cycle-refused-publish-0001',countdown:'staged'});assert.equal(publish.status,422,JSON.stringify(publish.body));assert.equal(publish.body.error,'PRIVATE_TEST_DISABLED');
  ok('private fixture draft saves but default-OFF publication refuses');
 }
 const current=await admin('');assert.equal(current.status,200);fs.writeFileSync(previousPath,JSON.stringify(storedState(current.body)));
 for(const l of current.body.listings){assert.equal(l.activeVersion,null);assert.equal(l.countdown,null);}
 assert(!(await (await mf.dispatchFetch('http://market.local/market/listings')).text()).includes('VHX07'));
 ok('no publication, timer start or public private-pair exposure');
 db=new PrismaClient();await db.user.upsert({where:{id:'qa-h20-admin'},create:{id:'qa-h20-admin',email:'qa-h20-admin@invalid.test',referralCode:'QAH20',passwordHash:'fixture-not-login',role:'ADMIN'},update:{}});
 const financial=async()=>({balance:await db.balance.count(),demoBalance:await db.demoBalance.count(),orders:await db.order.count(),trades:await db.trade.count(),withdrawals:await db.withdrawal.count(),deposits:await db.deposit.count()});
 const moneyBefore=await financial();
 const log=fs.openSync('/qa/report/api-'+phase+'.log','w');
 server=cp.spawn(process.execPath,['/app/dist/index.js'],{stdio:['ignore',log,log],env:{...process.env,PORT:'4100',JWT_SECRET:'isolated-h20-container-secret',API_KEY_ENCRYPTION_SECRET:'0'.repeat(64),LISTINGS_STORE_URL:'http://127.0.0.1:8787',LISTINGS_STORE_TOKEN:token,HISTORY20_PRIVATE_TEST:'',PRIVATE_TRADING_ENABLED:'false',WALLET_CONVERSION_ENABLED:'false',DEMO_SPOT_ENABLED:'false',DEMO_LIQUIDITY_ENABLED:'false',STOCKS_ENABLED:'false',NODE_ENV:'test'}});
 let healthy=false;for(let i=0;i<60;i++){if(server.exitCode!==null)throw Error('API exited '+server.exitCode);try{if((await fetch('http://127.0.0.1:4100/health')).ok){healthy=true;break;}}catch{}await wait(500);}assert(healthy,'API health timeout');
 const api=async(p,auth)=>{const r=await fetch('http://127.0.0.1:4100/api/v1'+p,{headers:auth?{Authorization:'Bearer '+auth}:{}});return {status:r.status,text:await r.text()};};
 assert.equal((await api('/admin/listings')).status,401);
 const auth=jwt.sign({sub:'qa-h20-admin'},'isolated-h20-container-secret');
 const listed=await api('/admin/listings',auth);assert.equal(listed.status,200,listed.text);
 assert.equal(JSON.parse(listed.text).listings.length,current.body.listings.length);
 if(phase==='rollback'){
  const {CloudflareListingStore}=require('/app/dist/services/listings/store.js');
  const privateDraft=current.body.listings.find(l=>l.symbol==='VHX07');assert(privateDraft);
  const read=async(record)=>new CloudflareListingStore('http://127.0.0.1:8787',token,async()=>new Response(JSON.stringify({revision:'qa',serverTime:0,listings:[record]})),false).list();
  assert.deepEqual((await read(privateDraft)).listings[0],privateDraft);
  for(const change of [l=>{l.activeVersion=1;l.active=l.draft;},l=>{l.versions=[{version:1,publishedAt:'2030-01-01',publishedBy:'qa'}];},l=>{l.countdown={state:'running'};},l=>{l.draft.tradable=true;},l=>{l.draft.ownerAllocation='1';},l=>{l.draft.privateTest.settlement='USDT';},l=>{l.symbol=l.draft.symbol='QVTR';}]){
   const invalid=structuredClone(privateDraft);change(invalid);await assert.rejects(read(invalid),e=>e.code==='STORE_INVALID_RESPONSE');
  }
  ok('rollback reads unchanged private draft and rejects published, running, tradable or real-settlement variants');
 }
 assert.equal((await api('/private-test/markets')).status,phase==='install'?401:404);
 assert.equal((await api('/private-test/markets',auth)).status,404);
 ok('real API starts, authorizes admin reads and keeps private feature OFF');
 assert.deepEqual(await financial(),moneyBefore);assert.equal(outbound,0);
 ok('financial row counts unchanged and Worker external calls zero');
 fs.writeFileSync('/qa/report/'+phase+'.json',JSON.stringify({phase,checks,financialBefore:moneyBefore,financialAfter:await financial(),outbound,productionTouched:false},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),wait(5000)]);if(server.exitCode===null)server.kill('SIGKILL');}await db?.$disconnect();await mf?.dispose();});
