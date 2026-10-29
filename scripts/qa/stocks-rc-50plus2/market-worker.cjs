'use strict';
// #613 R8 (--isolated-clients): the synthetic market (services/stocks-global/testing/synthetic-public-market.mjs, the
// loopback stand-in for the exchanges' REST and WebSocket endpoints) in its own process on the client CPUs. In
// production the exchanges' servers are not on VOLTEX's host; the gateway's own market client (hub, feed, REST
// fetches) stays in the gateway process on the server CPUs. Forked by diagnostic-run-613.cjs, whose CPUs it inherits.
const path=require('node:path'),{pathToFileURL}=require('node:url');
let market;
const send=(id,value,error)=>process.send?.({id,value,error});
process.on('message',async m=>{try{
 let value;
 if(m.command==='init'){
  if(market)throw Error('MARKET_SINGLE_INIT');
  const {syntheticPublicMarket}=await import(pathToFileURL(path.join(m.value.root,'services/stocks-global/testing/synthetic-public-market.mjs')).href);
  market=await syntheticPublicMarket();
  value={pid:process.pid,origin:market.origin,wsUrl:market.wsUrl};
 }
 else if(m.command==='snapshot')value={...market.snapshot(),pid:process.pid,cpu:process.cpuUsage(),memory:process.memoryUsage(),sched:require('./sched.cjs').read(),network:global.__rc50Network};
 else if(m.command==='close'){await market?.close();market=null;send(m.id,{closed:true,network:global.__rc50Network});process.disconnect();return;}
 else throw Error('UNKNOWN_MARKET_WORKER_COMMAND');
 send(m.id,value);
}catch(e){send(m.id,null,String(e.message));}});
