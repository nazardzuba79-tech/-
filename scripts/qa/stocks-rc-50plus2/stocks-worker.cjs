'use strict';
// Separated topology only: one Stocks process of the release layout, forked by api-worker.cjs under the same
// taskset (no CPU or memory added to the budget). Role 'authority' serves src/stocksAuthority.ts's app (the
// unchanged stocksTestCashRouter with its PostgreSQL authority) on loopback; role 'gateway' runs the Stocks
// gateway, its authority adapter and the synthetic market. Neither hosts any crypto route.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),Module=require('node:module'),{pathToFileURL}=require('node:url');
const {database,loopback}=require('./policy.cjs');
const {performance:perf,monitorEventLoopDelay}=require('node:perf_hooks'),loopDelay=monitorEventLoopDelay({resolution:10});loopDelay.enable();
const loop=()=>{const ms=x=>x/1e6,v={elu:perf.eventLoopUtilization(),delay:{count:loopDelay.count,minMs:ms(loopDelay.min),meanMs:ms(loopDelay.mean),p50Ms:ms(loopDelay.percentile(50)),p99Ms:ms(loopDelay.percentile(99)),maxMs:ms(loopDelay.max)}};loopDelay.reset();return v;};
const send=(id,value,error)=>process.send?.({id,value,error});
// Report only: server-side time of each driver request (its x-rc50-request id), from the HTTP 'request' event
// to the response's 'finish', in every HTTP server of this process. Same hook in every arm, pin and topology.
const serverTimings=new Map(),serverEmit=require('node:http').Server.prototype.emit;
// Report only (#613 R8 sustained load): every request the authority's private ingress receives from the gateway, with
// its arrival time (epoch ms), route and final status, so the runner can count private requests per sliding minute
// and the ingress's own 429s. Bounded; the ingress itself (quota, capability, deadlines) is unchanged.
const privateRequests=[];
require('node:http').Server.prototype.emit=function(event,req,res){
 if(event==='request'){const id=req.headers['x-rc50-request'];if(typeof id==='string'&&serverTimings.size<10000){const at=perf.now();res.once('finish',()=>serverTimings.set(id,perf.now()-at));}
  if(role==='authority'&&privateRequests.length<50000){const row={at:Date.now(),method:req.method,route:String(req.url).split('?')[0].split('/').slice(-1)[0],status:null};privateRequests.push(row);res.once('finish',()=>{row.status=res.statusCode;});}}
 return serverEmit.apply(this,arguments);
};
const timings=()=>{const value=Object.fromEntries(serverTimings);serverTimings.clear();return value;};
let role,state={};
function shared(s){
 if(!s||typeof s.issuer!=='string'||!Array.isArray(s.principals)||s.principals.length!==2||typeof s.gatewayKey!=='string'||s.gatewayKey.length<32)throw Error('STOCKS_PROCESS_SHARED_INVALID');
 return s;
}
const freePort=()=>new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});
async function authority(c){
 database(c.dbUrl,c.dbName);const s=shared(c.shared);
 if(typeof s.secret!=='string'||s.secret.length<32)throw Error('STOCKS_PROCESS_SHARED_INVALID');
 const root=fs.realpathSync(c.root),generated=fs.realpathSync(c.generatedClient);
 if(!generated.startsWith(fs.realpathSync(c.runRoot)+path.sep))throw Error('OWN_GENERATED_CLIENT_REQUIRED');
 // The API worker's synthetic secret: auth.ts reads JWT_SECRET once, at load.
 process.env.JWT_SECRET=s.secret;
 process.env.TS_NODE_PROJECT=path.join(root,'tsconfig.json');
 process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'commonjs',moduleResolution:'node'});
 const realLoad=Module._load;
 Module._load=function(request,parent,isMain){return realLoad.call(this,request==='@prisma/client'?generated:request,parent,isMain);};
 require(require.resolve('ts-node/register/transpile-only',{paths:[root]}));
 const {PrismaClient}=require('@prisma/client'),{createStocksAuthorityApp}=require(path.join(root,'src/stocksAuthority.ts'));
 const {createStocksAuthorityIngress}=require(path.join(root,'src/api/middleware/stocksAuthorityIngress.ts'));
 const prisma=new PrismaClient({datasources:{db:{url:c.dbUrl}}});state.prisma=prisma;
 // Same router configuration as the single-process fixture: both server gates on, no injected authority, so
 // the router opens the real PostgreSQL authority (and its readiness route) exactly as in the release. Since
 // 28.10 behind the release's private ingress too (loopback listener, capability header, the default 240/min
 // service quota): the normal 50+2 load must fit in it, and a run over it fails on the 429 instead of passing
 // unseen. The single-process arm has no transport between gateway and authority, so no ingress either.
 const port=await freePort(),ingress=createStocksAuthorityIngress({port,gatewayKey:s.gatewayKey});
 const app=createStocksAuthorityApp(prisma,{router:{enabled:true,catalogueEnabled:true,orderExecutionEnabled:true,issuer:s.issuer,principals:s.principals,gatewayKey:s.gatewayKey,secret:s.secret},ingress:ingress.middleware});
 const server=state.server=await ingress.listen(app);
 const endpoint='http://127.0.0.1:'+server.address().port+'/api/v1/stocks-test-cash';loopback(endpoint);
 return{role,pid:process.pid,endpoint,ingress:{port,requestsPerMinute:240}};
}
async function gateway(c){
 const s=shared(c.shared),endpoint=c.endpoint;loopback(endpoint);
 const root=fs.realpathSync(c.root),load=p=>import(pathToFileURL(path.join(root,p)).href);
 const {syntheticPublicMarket,loopbackFetch}=await load('services/stocks-global/testing/synthetic-public-market.mjs');
 const {BinanceStreamMarketHub}=await load('services/stocks-global/binance-stream-market.mjs');
 const {createServer}=await load('services/stocks-global/server.mjs'),{createAuthorityAdapter}=await load('services/stocks-global/authority-adapter.mjs');
 const {verifyReleaseAuthority,releasePrincipals}=await load('services/stocks-global/release-config.mjs');
 // --isolated-clients: the synthetic market runs in its own process on the client CPUs (market-worker.cjs); this
 // gateway keeps its market client (hub, stream feed, REST fetches) as in production.
 if(c.market){const o=loopback(c.market.origin);if(o.pathname!=='/'||o.search||c.market.wsUrl!=='ws://127.0.0.1:'+o.port+'/stream')throw Error('REMOTE_MARKET_INVALID');}
 const source=c.market??(state.market=await syntheticPublicMarket());
 const hub=new BinanceStreamMarketHub({enabled:true,fetchImpl:loopbackFetch(source.origin),feedOptions:{url:source.wsUrl,synthetic:true},now:Date.now});
 // As release-entrypoint.mjs: trading follows the authority's readiness assertion (both server gates).
 const ready=await verifyReleaseAuthority({endpoint,issuer:s.issuer,gatewayKey:s.gatewayKey,tradePrincipals:releasePrincipals(s.issuer,s.principals)});
 if(ready.tradingEnabled!==true)throw Error('STOCKS_PROCESS_AUTHORITY_NOT_TRADING');
 const accountAuthority=createAuthorityAdapter({endpoint,issuer:s.issuer,gatewayKey:s.gatewayKey});
 state.gateway=await createServer({financialEnabled:true,port:0,accountAuthority,tradePrincipals:s.principals,hub,now:Date.now,viewerStream:c.viewerStream===true});
 return{role,pid:process.pid,port:state.gateway.port};
}
function metrics(){
 const value={role,pid:process.pid,nice:require('node:os').getPriority(),cpu:process.cpuUsage(),memory:process.memoryUsage(),loop:loop(),sched:require('./sched.cjs').read(),policies:require('./sched.cjs').policies(),cpus:require('./sched.cjs').allowed(),network:global.__rc50Network};
 if(role==='gateway')Object.assign(value,{quote:state.gateway.quoteMetrics(),account:state.gateway.accountMetrics(),connections:state.gateway.connectionMetrics?.()??null,streams:state.gateway.streamMetrics?.()??null,market:state.market?{...state.market.snapshot(),starts:state.market.starts.map(x=>({host:x.host,kind:x.kind}))}:null});
 return value;
}
async function close(){
 if(state.gateway)await state.gateway.close();
 if(state.market)await state.market.close();
 if(state.server){state.server.closeAllConnections();await new Promise(resolve=>state.server.close(resolve));}
 if(state.prisma)await state.prisma.$disconnect();
 state={};return{closed:true,role,network:global.__rc50Network};
}
process.on('message',async m=>{try{
 let value;
 if(m.command==='init'){if(role)throw Error('STOCKS_PROCESS_SINGLE_INIT');role=m.value.role;value=role==='authority'?await authority(m.value):role==='gateway'?await gateway(m.value):(()=>{throw Error('STOCKS_PROCESS_ROLE_UNKNOWN');})();}
 else if(m.command==='metrics')value=metrics();
 else if(m.command==='timings')value=timings();
 else if(m.command==='private-requests')value=privateRequests.splice(0);
 else if(m.command==='close'){value=await close();send(m.id,value);process.disconnect();return;}
 else throw Error('UNKNOWN_STOCKS_WORKER_COMMAND');
 send(m.id,value);
}catch(e){send(m.id,null,String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[synthetic-database]'));}});
