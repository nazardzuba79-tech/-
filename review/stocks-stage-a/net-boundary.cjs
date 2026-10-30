'use strict';
// Fixture-only fence, not shipped in a release image. Real bootstrap bytes stay unchanged.
// Docker --internal is a second independent boundary. No fake provider responses.
const net=require('node:net'),dns=require('node:dns'),cp=require('node:child_process');
const allowed=host=>['127.0.0.1','localhost','::1','db',process.env.STAGE_A_PG_IP].filter(Boolean).includes(String(host));
const denied=()=>Object.assign(Error('STAGE_A_EXTERNAL_NETWORK_DENIED'),{code:'ENETUNREACH'});
const lookup=dns.lookup;
dns.lookup=function(host,options,callback){if(allowed(host))return lookup.apply(this,arguments);const cb=typeof options==='function'?options:callback;if(cb)return queueMicrotask(()=>cb(denied()));throw denied();};
dns.promises.lookup=async function(host,options){if(!allowed(host))throw denied();return new Promise((resolve,reject)=>lookup(host,options,(e,address,family)=>e?reject(e):resolve({address,family})));};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const arg=Array.isArray(args[0])?args[0][0]:args[0];
  const host=arg&&typeof arg==='object'?arg.host:typeof args[1]==='string'?args[1]:'localhost';
  if(arg&&typeof arg==='object'&&arg.path)throw denied();
  if(!allowed(host??'localhost')){queueMicrotask(()=>this.destroy(denied()));return this;}
  return connect.apply(this,args);
};
// Bootstrap replaces NODE_OPTIONS. Propagate the fence into its launcher children.
const spawn=cp.spawn;
cp.spawn=function(binary,args=[],options={}){
  if(binary!==process.execPath||!['scripts/start-render-single-service.cjs','dist/index.js','dist/marketDataCollector.js'].includes(args[0]))throw Error('STAGE_A_UNEXPECTED_CHILD');
  const env={...(options.env||process.env)};
  if(!(env.NODE_OPTIONS||'').includes(__filename))env.NODE_OPTIONS=(env.NODE_OPTIONS||'')+' --require '+__filename;
  return spawn.call(this,binary,args,{...options,env});
};
// Observe only route/status/time, never credentials or user/balance data.
const http=require('node:http'),emit=http.Server.prototype.emit;
http.Server.prototype.emit=function(event,...args){if(event==='request'&&args[0]?.url?.startsWith('/api/v1/stocks-test-cash/')){const at=Date.now();args[1].once('finish',()=>console.log('STAGE_A_AUTHORITY_REQUEST '+JSON.stringify({at,status:args[1].statusCode})));}return emit.call(this,event,...args);};
module.exports={allowed};
