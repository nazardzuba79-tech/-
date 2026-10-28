'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {database,loopback,sha}=require('./policy.cjs');
let f,market,cleanup=[],configuration,diagnostics,cpuHttpProfile,gatewayPort;
// Topology: 'single-process' hosts the crypto API, the Stocks authority, the gateway and the synthetic market in
// this process; 'separated' keeps only the crypto API here and forks the Stocks authority and gateway processes
// (stocks-worker.cjs) of the separated release layout. Both arms of a run use the same topology.
const TOPOLOGIES=['single-process','separated'],stocks={};
// Event-loop utilization and delay of this API process, read by 'metrics' before and after each measured
// window (the delay histogram restarts at every read). Same in every arm and pin; a 10 ms sampling timer.
const {performance:perf,monitorEventLoopDelay}=require('node:perf_hooks'),loopDelay=monitorEventLoopDelay({resolution:10});loopDelay.enable();
const loop=()=>{const ms=x=>x/1e6,v={elu:perf.eventLoopUtilization(),delay:{count:loopDelay.count,minMs:ms(loopDelay.min),meanMs:ms(loopDelay.mean),p50Ms:ms(loopDelay.percentile(50)),p99Ms:ms(loopDelay.percentile(99)),maxMs:ms(loopDelay.max)}};loopDelay.reset();return v;};
const send=(id,value,error)=>process.send?.({id,value,error});
// Report only: server-side time of each driver request (its x-rc50-request id), from the HTTP 'request' event
// to the response's 'finish', in every HTTP server of this process. Same hook in every arm, pin and topology.
const serverTimings=new Map(),serverEmit=require('node:http').Server.prototype.emit;
require('node:http').Server.prototype.emit=function(event,req,res){
 if(event==='request'){const id=req.headers['x-rc50-request'];if(typeof id==='string'&&serverTimings.size<10000){const at=perf.now();res.once('finish',()=>serverTimings.set(id,perf.now()-at));}}
 return serverEmit.apply(this,arguments);
};
const timings=()=>{const value=Object.fromEntries(serverTimings);serverTimings.clear();return value;};
function fork(role,arm){
 const cp=require('node:child_process'),out=n=>fs.openSync(path.join(configuration.runRoot,arm+'-stocks-'+role+'.'+n+'.log'),'w'),stdout=out('stdout'),stderr=out('stderr');
 const env={};for(const k of ['PATH','SystemRoot','WINDIR','TEMP','TMP','HOME','LANG','PRISMA_HIDE_UPDATE_MESSAGE','CHECKPOINT_DISABLE','TS_NODE_CACHE','RC50_RUN_ROOT','NODE_PATH'])if(process.env[k])env[k]=process.env[k];
 const child=cp.fork(path.join(__dirname,'stocks-worker.cjs'),[],{cwd:configuration.root,env,execArgv:['--max-old-space-size=384','--require',path.join(__dirname,'network-guard.cjs')],windowsHide:true,stdio:['ignore',stdout,stderr,'ipc']});
 fs.closeSync(stdout);fs.closeSync(stderr);
 // The pin's deployable scheduling control: a lower CPU weight for the Stocks processes than for the crypto API
 // (the release sets the same relation with cpu_shares). It takes no CPU from or adds none to the shared taskset.
 if(configuration.stocksNice)require('node:os').setPriority(child.pid,configuration.stocksNice);
 let next=0;const waiting=new Map();
 child.on('message',m=>{const p=waiting.get(m.id);if(!p)return;waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.value);});
 child.on('exit',code=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(Error('STOCKS_'+role.toUpperCase()+'_EXIT_'+code));}waiting.clear();});
 const rpc=(command,value)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{waiting.delete(id);reject(Error('STOCKS_WORKER_RPC_TIMEOUT_'+command));},command==='init'?45000:10000);waiting.set(id,{resolve,reject,timer});child.send({id,command,value},error=>{if(error){clearTimeout(timer);waiting.delete(id);reject(error);}});});
 const close=async()=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise(resolve=>child.once('exit',resolve));
  try{await rpc('close');}catch{}
  const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await exited;clearTimeout(timer);
 };
 return{child,rpc,close,pid:child.pid};
}
async function initialize(c){
 configuration=c;database(c.dbUrl,c.dbName);
 if(!TOPOLOGIES.includes(c.topology)||!/^(qualification|baseline|mixed)$/.test(c.arm))throw Error('TOPOLOGY_OR_ARM_UNKNOWN');
 if(c.stocksNice!==0&&!(c.topology==='separated'&&Number.isInteger(c.stocksNice)&&c.stocksNice>=1&&c.stocksNice<=19))throw Error('STOCKS_NICE_INVALID');
 const cp=require('node:child_process'),exec=cp.execFileSync;cp.execFileSync=(file,argv,options={})=>exec(file,argv,{...options,windowsHide:true});
 const root=fs.realpathSync(c.root),generated=fs.realpathSync(c.generatedClient);
 if(!generated.startsWith(fs.realpathSync(c.runRoot)+path.sep))throw Error('OWN_GENERATED_CLIENT_REQUIRED');
 process.env.STOCKS_DISPOSABLE_PG_URL=c.dbUrl;process.env.STOCKS_PG_DISPOSABLE_CONFIRM=c.dbName;
 process.env.TS_NODE_PROJECT=path.join(root,'tsconfig.json');
 process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'commonjs',moduleResolution:'node'});
 const realLoad=Module._load;
 Module._load=function(request,parent,isMain){return realLoad.call(this,request==='@prisma/client'?generated:request,parent,isMain);};
 if(c.diagnostics)diagnostics=require('./spans.cjs').install({generated,root});
 const load=p=>import(pathToFileURL(path.join(root,p)).href);
 const {CATALOG}=await load('services/stocks-global/catalog.mjs');
 if(c.topology==='separated'){
  f=await require('./crypto-api.cjs').cryptoApi(root,fn=>cleanup.push(fn));
  const shared=f.stocksProcess;
  stocks.authority=fork('authority',c.arm);cleanup.push(()=>stocks.authority.close());
  // --pg-profile names each process's PostgreSQL connections (application_name) for the lock and statement log.
  const authority=await stocks.authority.rpc('init',{role:'authority',root,runRoot:c.runRoot,generatedClient:generated,dbUrl:c.dbUrl.replace('application_name=rc50_crypto_api','application_name=rc50_stocks_authority'),dbName:c.dbName,shared});
  stocks.endpoint=authority.endpoint;
  stocks.gateway=fork('gateway',c.arm);cleanup.push(()=>stocks.gateway.close());
  const gateway=await stocks.gateway.rpc('init',{role:'gateway',root,endpoint:authority.endpoint,shared:{issuer:shared.issuer,principals:shared.principals,gatewayKey:shared.gatewayKey}});
  f.attachGateway(gateway.port);gatewayPort=gateway.port;
 }else{
  const {syntheticPublicMarket,loopbackFetch}=await load('services/stocks-global/testing/synthetic-public-market.mjs');
  const {BinanceStreamMarketHub}=await load('services/stocks-global/binance-stream-market.mjs');
  market=await syntheticPublicMarket();
  const hub=new BinanceStreamMarketHub({enabled:true,fetchImpl:loopbackFetch(market.origin),feedOptions:{url:market.wsUrl,synthetic:true},now:Date.now});
  const fixture=require(path.join(root,'services/stocks-global/testing/disposable-postgres.cjs')).fixture;
  f=await fixture({after:fn=>cleanup.push(fn)},{hub,wallClock:true});gatewayPort=f.gateway.port;
 }
 const instruments=CATALOG.filter(i=>i.provider!=='moex').slice(0,20).map(i=>i.id),stockId=CATALOG.find(i=>i.provider==='binance').id;
 const viewers=[];for(let i=0;i<c.viewerCount;i++)viewers.push(await f.newViewer(i));
 f.viewers=viewers;f.stockId=stockId;
 for(let i=0;i<2;i++)await ready(i);
 for(let i=0;i<viewers.length;i++){
  const r=await stock('state?id='+encodeURIComponent(instruments[i%instruments.length]),{token:viewers[i].token,view:'diag-viewer-'+i});
  assert.equal(r.status,200);assert.equal(r.data.account.canTrade,false);
 }
 const initial=await snapshot();
 return{apiOrigin:f.apiOrigin,stocksOrigin:'http://127.0.0.1:'+gatewayPort,traderTokens:f.tokens,viewerTokens:viewers.map(v=>v.token),stockId,instruments,initial,apiPid:process.pid,topology:c.topology,processes:{api:process.pid,...(stocks.authority?{stocksAuthority:stocks.authority.pid,stocksGateway:stocks.gateway.pid}:{})},node:process.version,implementation:c.topology==='separated'?'Separated: crypto API (DemoTradingService + MatchingEngine) in this process; Stocks authority process (src/stocksAuthority.ts: stocksTestCashRouter + PostgreSQL authority); Stocks gateway process (HTTP gateway + synthetic market); synthetic quotes only':'RC stocksTestCashRouter + DemoTradingService + MatchingEngine + PostgreSQL authority + Stocks HTTP gateway; synthetic quotes only'};
}
async function stock(route,{index=0,token,body,view='diag-trader-'+index}={}){
 return f.request(route,{index,token,body,view});
}
async function ready(index){
 let last;const end=Date.now()+4500;
 while(Date.now()<end){
  last=await stock('state?id='+encodeURIComponent(f.stockId),{index});
  if(last.status===200&&last.data.account?.canTrade===true&&last.data.quotes?.[f.stockId]&&!last.data.errors?.[f.stockId])return last.data.token;
  await new Promise(r=>setTimeout(r,120));
 }
 throw Error('HARNESS_QUOTE_READINESS_NOT_ESTABLISHED:'+JSON.stringify({status:last?.status,errors:last?.data?.errors}));
}
async function snapshot(){
 const r=await f.rows(),cash=r.cash.filter(v=>v.asset==='USDT').map(v=>({available:v.available.toFixed(18),locked:v.locked.toFixed(18)}));
 const accounts=r.accounts.map(a=>({orders:a.ledger.orders.map(o=>({id:o.id,status:o.status,side:o.side,type:o.type,filled:o.filled})),fills:a.ledger.fills.map(x=>({id:x.id,orderId:x.orderId,notional:x.notional,fee:x.fee})),positions:Object.values(a.ledger.positions).map(p=>({quantity:p.quantity,reserved:p.reserved,cost:p.cost})),wallet:a.ledger.wallets.USDT}));
 const crypto=await f.db.demoOrder.findMany({where:{userId:f.users[0]},select:{id:true,status:true}});
 const viewerIds=f.viewers.map(v=>v.id),viewerBalances=await f.db.demoBalance.count({where:{userId:{in:viewerIds}}});
 const accountCount=await f.db.stocksTestAccount.count();
 return{cash,accounts,receipts:r.receipts.map(x=>({principalHash:x.principalHash,intentId:x.intentId})),audit:r.audit.map(x=>({principalHash:x.principalHash,intentId:x.intentId})),cryptoOrders:crypto,viewerBalances,accountCount,logicalStateSha:sha(JSON.stringify({cash,accounts:accounts.map(a=>({orders:a.orders.length,fills:a.fills.length,positions:a.positions,wallet:a.wallet})),viewerCount:f.viewers.length,viewerBalances,accountCount})),network:global.__rc50Network};
}
async function qualification(){
 const token=await ready(0),viewer=f.viewers[0],before=await snapshot();
 const denied=await stock('orders',{token:viewer.token,view:'diag-viewer-0',body:{gatewayToken:'not-a-valid-token',id:'qualification-viewer-deny',instrumentId:f.stockId,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.01'}});
 assert.equal(denied.status,401);assert.equal(denied.data.error,'AUTH_REQUIRED');
 const cryptoPayload={pair:'BTC/USDT',side:'BUY',type:'LIMIT',price:'100',quantity:'0.01'};
 const placed=await fetch(f.apiOrigin+'/api/v1/demo/orders',{method:'POST',headers:{authorization:'Bearer '+f.tokens[0],'content-type':'application/json'},body:JSON.stringify(cryptoPayload)});
 assert.equal(placed.status,201);const order=(await placed.json()).order;
 const open=await fetch(f.apiOrigin+'/api/v1/demo/orders/open',{headers:{authorization:'Bearer '+f.tokens[0]}});assert.equal(open.status,200);assert.ok((await open.json()).some(o=>o.id===order.id));
 const cancel=await fetch(f.apiOrigin+'/api/v1/demo/orders/'+encodeURIComponent(order.id),{method:'DELETE',headers:{authorization:'Bearer '+f.tokens[0]}});assert.equal(cancel.status,204);
 const id='qualification-limit-order',r=await stock('orders',{body:{gatewayToken:token,id,instrumentId:f.stockId,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.01',limitPrice:'98'}});assert.equal(r.status,200,JSON.stringify(r.data));
 const x=await stock('cancel',{body:{gatewayToken:token,id}});assert.equal(x.status,200,JSON.stringify(x.data));
 const balances=await fetch(f.apiOrigin+'/api/v1/demo/balances',{headers:{authorization:'Bearer '+f.tokens[0]}});assert.equal(balances.status,200);await balances.json();
 for(const side of ['BUY','SELL']){const body={gatewayToken:token,id:'qualification-market-'+side,instrumentId:f.stockId,currency:'USDT',side,type:'MARKET',quantity:'0.01'};const placed=await stock('orders',{body});assert.equal(placed.status,200,JSON.stringify(placed.data));const replay=await stock('orders',{body});assert.equal(replay.status,200,JSON.stringify(replay.data));}
 const after=await snapshot();assert.deepEqual(after.cash,before.cash);assert.equal(after.viewerBalances,0);assert.equal(after.accountCount,2);
 let separated=null;
 if(configuration.topology==='separated'){
  // The crypto API serves no Stocks authority route; the gateway and authority run in their own processes.
  const probe=await fetch(f.apiOrigin+'/api/v1/stocks-test-cash/identity',{headers:{authorization:'Bearer '+f.tokens[0]}});assert.equal(probe.status,404);await probe.text();
  const [a,g]=await Promise.all([stocks.authority.rpc('metrics'),stocks.gateway.rpc('metrics')]);
  assert.ok(new Set([process.pid,a.pid,g.pid]).size===3&&a.role==='authority'&&g.role==='gateway');
  assert.ok(a.nice===configuration.stocksNice&&g.nice===configuration.stocksNice&&require('node:os').getPriority()===0,'STOCKS_NICE_NOT_APPLIED');
  // The authority sits behind the release's private ingress: no capability, no service.
  const bare=await fetch(stocks.endpoint+'/readiness');assert.equal(bare.status,403);await bare.text();
  separated={apiServesStocksAuthority:false,processes:3,stocksNice:configuration.stocksNice,privateIngress:true};
 }
 return{status:'PASS_WIRING_QUALIFICATION_ONLY',topology:configuration.topology,separated,realCryptoHttp:true,realStocksHttp:true,viewerDeny:true,cashRoundTrip:true,full50Plus2Runs:0};
}
// cpu, memory and loop stay this (crypto API) process's own, so 'API CPU' means the same in both topologies;
// 'processes' adds every process of the topology, and network sums every process's egress fence.
async function metrics(){
 const own={pid:process.pid,nice:require('node:os').getPriority(),cpu:process.cpuUsage(),memory:process.memoryUsage(),loop:loop(),sched:require('./sched.cjs').read(),network:global.__rc50Network};
 if(configuration.topology!=='separated')return{...own,quote:f.gateway.quoteMetrics(),account:f.gateway.accountMetrics(),market:{...market.snapshot(),starts:market.starts.map(x=>({host:x.host,kind:x.kind}))},topology:configuration.topology,processes:{api:own}};
 const [a,g]=await Promise.all([stocks.authority.rpc('metrics'),stocks.gateway.rpc('metrics')]);
 return{...own,quote:g.quote,account:g.account,market:g.market,network:{blocked:own.network.blocked+a.network.blocked+g.network.blocked},topology:configuration.topology,processes:{api:own,stocksAuthority:a,stocksGateway:g}};
}
async function close(){
 await cpuHttpProfile?.stop();
 for(const fn of cleanup.reverse())await fn();cleanup=[];
 await market?.close();return{closed:true,network:global.__rc50Network};
}
process.on('message',async m=>{try{
 let value;if(m.command==='init')value=await initialize(m.value);
 else if(m.command==='profile-clock'){
  if(!configuration?.diagnostics)throw Error('PROFILE_DIAGNOSTIC_REQUIRED');
  value=require('./profile-clock.cjs').stamp();
 }
 else if(m.command==='profile-start'){
  if(!configuration?.diagnostics||cpuHttpProfile)throw Error('PROFILE_DIAGNOSTIC_SINGLE_USE_REQUIRED');
  cpuHttpProfile=require('./cpu-http-profile.cjs').createProfiler({enabled:true,role:'api',root:configuration.root});
  value=await cpuHttpProfile.start();
 }
 else if(m.command==='profile-stop')value=await cpuHttpProfile?.stop()??{enabled:false};
 else if(m.command==='spans-start')value=await diagnostics?.start(configuration.dbUrl);
 else if(m.command==='spans-stop')value=await diagnostics?.stop()??{enabled:false};
 else if(m.command==='snapshot')value=await snapshot();
 else if(m.command==='qualify')value=await qualification();
 else if(m.command==='ready')value=await ready(m.value.index);
 else if(m.command==='metrics')value=await metrics();
 else if(m.command==='timings')value=configuration.topology==='separated'?{...timings(),...await stocks.gateway.rpc('timings')}:timings();
 else if(m.command==='close'){value=await close();send(m.id,value);process.disconnect();return;}
 else throw Error('UNKNOWN_WORKER_COMMAND');
 send(m.id,value);
}catch(e){send(m.id,null,String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[synthetic-database]'));}});
