'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const preload=path.join(__dirname,'quota-trace.cjs');
test('quota diagnostic preserves full-scenario snapshot without logging credentials or bodies',()=>{
  const code=`require(${JSON.stringify(preload)});const http=require('node:http'),E=require('node:events');const server=new http.Server();
    for(const route of ['identity','readiness','readiness']){const req={url:'/api/v1/stocks-test-cash/'+route,socket:{localPort:3001},headers:{authorization:'Bearer never-log-this', 'x-stocks-authority-key':'secret-capability','x-smoke-phase':route==='readiness'?'after-functional-scenario':undefined}};
      const res=new E();res.statusCode=200;res.getHeader=n=>({'ratelimit-limit':240,'ratelimit-remaining':237,'ratelimit-reset':25}[n]);server.emit('request',req,res);res.emit('finish');}`;
  const r=cp.spawnSync(process.execPath,['-e',code],{encoding:'utf8',env:{...process.env,STOCKS_QUOTA_TRACE_APP:'133cb85a95003c229829b1ecef3d8d0e6308db95',STOCKS_QUOTA_TRACE_SCOPE:'disposable-private-topology'}});
  assert.equal(r.status,0,r.stderr);const rows=r.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,3);assert.equal(rows[2].counts['readiness:200'],2);
  assert.equal(rows[2].functionalSnapshot.counts['readiness:200'],1);
  assert.equal(rows[2].functionalSnapshot.counts['identity:200'],1);
  assert.ok(!/never-log-this|secret-capability|Bearer/.test(r.stdout+r.stderr));
});
test('quota preload refuses wrong application SHA',()=>{
  const r=cp.spawnSync(process.execPath,['-e',`require(${JSON.stringify(preload)})`],{encoding:'utf8',env:{...process.env,STOCKS_QUOTA_TRACE_APP:'98c577d4241ce527f7bfca3b78dd7bb78255e300',STOCKS_QUOTA_TRACE_SCOPE:'disposable-private-topology'}});
  assert.notEqual(r.status,0);assert.equal(r.stdout,'');
});
