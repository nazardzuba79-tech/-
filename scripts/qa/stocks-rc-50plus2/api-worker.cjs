'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {database,loopback,sha}=require('./policy.cjs');
let f,market,cleanup=[],configuration,diagnostics;
const send=(id,value,error)=>process.send?.({id,value,error});
async function initialize(c){
 configuration=c;database(c.dbUrl,c.dbName);
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
 const {syntheticPublicMarket,loopbackFetch}=await load('services/stocks-global/testing/synthetic-public-market.mjs');
 const {BinanceStreamMarketHub}=await load('services/stocks-global/binance-stream-market.mjs');
 const {CATALOG}=await load('services/stocks-global/catalog.mjs');
 market=await syntheticPublicMarket();
 const hub=new BinanceStreamMarketHub({enabled:true,fetchImpl:loopbackFetch(market.origin),feedOptions:{url:market.wsUrl,synthetic:true},now:Date.now});
 const fixture=require(path.join(root,'services/stocks-global/testing/disposable-postgres.cjs')).fixture;
 f=await fixture({after:fn=>cleanup.push(fn)},{hub,wallClock:true});
 const instruments=CATALOG.filter(i=>i.provider!=='moex').slice(0,20).map(i=>i.id),stockId=CATALOG.find(i=>i.provider==='binance').id;
 const viewers=[];for(let i=0;i<c.viewerCount;i++)viewers.push(await f.newViewer(i));
 f.viewers=viewers;f.stockId=stockId;
 for(let i=0;i<2;i++)await ready(i);
 for(let i=0;i<viewers.length;i++){
  const r=await stock('state?id='+encodeURIComponent(instruments[i%instruments.length]),{token:viewers[i].token,view:'diag-viewer-'+i});
  assert.equal(r.status,200);assert.equal(r.data.account.canTrade,false);
 }
 const initial=await snapshot();
 return{apiOrigin:f.apiOrigin,stocksOrigin:'http://127.0.0.1:'+f.gateway.port,traderTokens:f.tokens,viewerTokens:viewers.map(v=>v.token),stockId,instruments,initial,apiPid:process.pid,node:process.version,implementation:'RC stocksTestCashRouter + DemoTradingService + MatchingEngine + PostgreSQL authority + Stocks HTTP gateway; synthetic quotes only'};
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
 return{status:'PASS_WIRING_QUALIFICATION_ONLY',realCryptoHttp:true,realStocksHttp:true,viewerDeny:true,cashRoundTrip:true,full50Plus2Runs:0};
}
async function close(){
 for(const fn of cleanup.reverse())await fn();cleanup=[];
 await market?.close();return{closed:true,network:global.__rc50Network};
}
process.on('message',async m=>{try{
 let value;if(m.command==='init')value=await initialize(m.value);
 else if(m.command==='spans-start')value=await diagnostics?.start(configuration.dbUrl);
 else if(m.command==='spans-stop')value=await diagnostics?.stop()??{enabled:false};
 else if(m.command==='snapshot')value=await snapshot();
 else if(m.command==='qualify')value=await qualification();
 else if(m.command==='ready')value=await ready(m.value.index);
 else if(m.command==='metrics')value={cpu:process.cpuUsage(),memory:process.memoryUsage(),quote:f.gateway.quoteMetrics(),account:f.gateway.accountMetrics(),market:{...market.snapshot(),starts:market.starts.map(x=>({host:x.host,kind:x.kind}))},network:global.__rc50Network};
 else if(m.command==='close'){value=await close();send(m.id,value);process.disconnect();return;}
 else throw Error('UNKNOWN_WORKER_COMMAND');
 send(m.id,value);
}catch(e){send(m.id,null,String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[synthetic-database]'));}});
