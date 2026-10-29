import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRuAuthRouting,EXPECTED,RU_ORIGIN} from './qa-ru-gateway-auth-contract.mjs';
const json=(val,status)=>Response.json(val,{status});
const good=(url)=>new URL(url).pathname==='/api/v1/copy-trading/identities'
  ? json({identities:[{traderId:'VX-001'},{traderId:'VX-KSENIA'}]},200)
  : json({error:'Missing bearer token'},401);
const run=fn=>auditRuAuthRouting({clock:()=> '2026-10-29T00:00:00.000Z',fetchImpl:async(url,opts)=>{
  assert.equal(url.origin,RU_ORIGIN);assert.equal(opts.method,'GET');assert.equal(opts.credentials,'omit');
  assert.equal(opts.redirect,'manual');assert.equal(opts.cache,'no-store');
  assert.deepEqual(Object.keys(opts.headers),['Accept']);
  assert.equal(opts.headers.Accept,'application/json');
  return fn(url,opts);
}});
test('all six actual route contracts return expected 401/200 with zero bearer headers',async()=>{
  const v=await run(good);assert.equal(v.overall,'PUBLIC_AUTH_BOUNDARY_PASS');assert.equal(v.checks.length,EXPECTED.length);
  assert(v.checks.every(x=>x.status==='PASS'));assert(v.bytesRead>0);
});
test('real Nginx HTML 403 on banking is fail closed and identified',async()=>{
  const v=await run(url=>new URL(url).pathname==='/api/v1/banking/state'?
    new Response('<html><title>403 Forbidden</title><h1>403 Forbidden</h1><center>nginx</center></html>',{status:403,headers:{'Content-Type':'text/html'}}):good(url));
  assert.equal(v.overall,'ROUTING_BLOCKER_OR_UNVERIFIED');
  assert.equal(v.checks.find(x=>x.name==='banking-state').reason,'LIKELY_NGINX_ROUTE_DENY');
  assert(v.checks.filter(x=>x.status==='PASS').length===EXPECTED.length-1);
});
test('HTTP 302 is never followed to a third-party origin',async()=>{
  const v=await run(url=>new URL(url).pathname==='/api/v1/kyc/me'?
    new Response('',{status:302,headers:{Location:'https://other.example/secret'}}):good(url));
  assert.equal(v.checks.find(x=>x.name==='kyc-me').reason,'REDIRECT_REFUSED');
});
test('public 200 HTML is not accepted as proper identities',async()=>{
  const v=await run(url=>new URL(url).pathname==='/api/v1/copy-trading/identities'?
    new Response('<html>Login</html>',{status:200,headers:{'Content-Type':'text/html'}}):good(url));
  assert.equal(v.checks.find(x=>x.name==='copy-identities').reason,'HTML_OR_INVALID_JSON_200');
});
test('extra identities must not bypass existing frontend two-strategy allowlist',async()=>{
  const v=await run(url=>new URL(url).pathname==='/api/v1/copy-trading/identities'?
    json({identities:[{traderId:'VX-001'},{traderId:'VX-KSENIA'},{traderId:'VX-EXTRA'}]},200):good(url));
  assert.equal(v.checks.find(x=>x.name==='copy-identities').status,'FAIL');
});
test('429 and 503 are not misreported as route-deny or a green result',async()=>{
  const v=await run(url=>new URL(url).pathname==='/api/v1/wallet/overview'?
    json({error:'rate limited'},429):good(url));
  assert.equal(v.checks.find(x=>x.name==='wallet-overview').reason,'RATE_LIMIT_OR_UNAVAILABLE');
});
test('response budget protects fixtures and never prints raw private response data',async()=>{
  const v=await run(url=>new URL(url).pathname==='/api/v1/banking/state'?
    new Response('x'.repeat(270000),{status:200,headers:{'Content-Type':'text/html'}}):good(url));
  assert.equal(v.checks.find(x=>x.name==='banking-state').reason,'BODY_BUDGET_EXCEEDED');
  assert(!JSON.stringify(v).includes('xxxx'));
});
test('network failure on a route never marks it PASS',async()=>{
  const v=await run(url=>{if(new URL(url).pathname==='/api/v1/banking/state')throw new TypeError('opaque connection');return good(url)});
  assert.equal(v.checks.find(x=>x.name==='banking-state').reason,'NETWORK_OR_TRANSPORT_ERROR');
});
