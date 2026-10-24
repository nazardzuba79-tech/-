const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
test('Stage A real request deadline aborts a nonresponding transport instead of extending benchmark budget',{timeout:3000},async t=>{
  const {originProxy,API}=await import('../../services/stocks-global/edge-transport/test-support.mjs');
  assert.notEqual(process.env.STOCKS_EDGE_NGINX_TEST,'true','this narrow test uses an explicit HTTP stand-in only');
  const upstream=http.createServer(()=>{});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{upstream.closeAllConnections();upstream.close(r);}));
  const proxy=await originProxy(t,upstream.address().port);
  const signal=AbortSignal.timeout(30);let timer;
  try{await assert.rejects(Promise.race([proxy.tlsFetch(new Request(API+'/__stocks_global/catalogue',{signal})),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('DEADLINE_WAS_IGNORED')),500))]),e=>e.name==='AbortError'||e.name==='TimeoutError');}finally{clearTimeout(timer);}
});
