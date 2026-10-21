'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { compose } = require('./topology.cjs');
const { APP, verifySource } = require('./source-guard.cjs');
const manifest = require('./application.json');
const root = path.resolve(__dirname,'../..');
const topo = () => compose({work:'/tmp/disposable',project:'stocks-private-123',apiImage:'sha256:'+'a'.repeat(64),gatewayImage:'sha256:'+'b'.repeat(64),pgImage:'sha256:'+'c'.repeat(64)});
test('API owns namespace; PG/frontend separate; no published TCP or host/docker access',()=>{
  const t=topo(); assert.equal(t.networks.isolated.internal,true);
  assert.deepEqual(t.services['api-production'].networks,['isolated']);
  assert.equal(t.services.gateway.network_mode,'service:api-production');
  assert.equal(t.services['unix-ingress'].network_mode,'service:api-production');
  for(const s of Object.values(t.services)) {
    assert.equal(s.ports,undefined); assert.equal(s.privileged,undefined); assert.equal(s.pid,undefined);
    assert.notEqual(s.network_mode,'host');
    assert.ok(!s.volumes.some(v=>/docker.sock|production.json|runtime-bootstrap/.test(v.source)));
  }
  assert.equal(t.services.postgres.network_mode,undefined);assert.equal(t.services.frontend.network_mode,undefined);
});
test('Unix proxy and frontend have different non-root UIDs and restricted socket sharing',()=>{
  const t=topo();assert.equal(t.services['unix-ingress'].user,'10001:10002');assert.equal(t.services.frontend.user,'10002:10002');
  assert.equal(t.services.outsider.user,'10003:10003');
  assert.equal(t.services['unix-ingress'].volumes.filter(v=>!v.read_only).length,1);
  assert.ok(t.services.frontend.volumes.every(v=>v.read_only));
  for(const role of ['gateway','unix-ingress','frontend'])assert.ok(t.services[role].volumes.every(v=>!v.source.includes('config.json')));
  assert.equal(t.services.gateway.command,undefined,'PG-only image CMD preserved');
});
test('strict image IDs and disposable project only',()=>{
  assert.throws(()=>compose({work:'/tmp',project:'production',apiImage:'latest'}));
});
test('review Compose template exactly matches the executable generator',()=>{
  let t=JSON.parse(fs.readFileSync(path.join(__dirname,'compose.staging.template.json'),'utf8'));
  const replacements={'${PG_IMAGE_ID:?required}':'sha256:'+'c'.repeat(64),'${API_IMAGE_ID:?required}':'sha256:'+'a'.repeat(64),'${GATEWAY_IMAGE_ID:?required}':'sha256:'+'b'.repeat(64),'${GITHUB_RUN_ID:?required}':'123','${STAGING_ROOT:?required}':'/tmp/disposable'};
  const normalize=v=>typeof v==='string'?Object.entries(replacements).reduce((s,[a,b])=>s.split(a).join(b),v.split('\\').join('/')):Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
  assert.deepEqual(normalize(t),normalize(topo()));
});
const blobs=Object.fromEntries(Object.keys(manifest.files).map(file=>[file,cp.execFileSync('git',['show',manifest.app+':'+file],{cwd:root,maxBuffer:16000000}).toString()]));
function guard(options={}) {
  return verifySource({source:'source',harness:'harness',expectedHead:'e'.repeat(40),command:(_bin,args,{cwd})=>{
    if(args[0]==='rev-parse')return args[1]==='HEAD^{tree}'?manifest.tree:(cwd==='source'?(options.oldSource?manifest.base:APP):'e'.repeat(40));
    if(args[0]==='status')return options.dirty?' M src/index.ts':'';
    if(args[0]==='merge-base'){if(options.unrelated)throw Error('ANCESTRY');return '';}
    if(args[0]==='diff')return cwd==='source'?Object.keys(manifest.files).join('\0')+'\0':(options.protectedPath?'src/index.ts':'review/stocks-private-pg-tls/run.cjs')+'\0';
    if(args[0]==='show'){const file=args[1].slice(41);return blobs[file]+(options.blob&&file==='src/index.ts'?'\n//mutant':'');}
    throw Error('unexpected git call');
  }});
}
test('exact source guard accepts approved133 app and a harness-only delta',()=>assert.equal(guard().sourceHead,APP));
for(const option of ['oldSource','dirty','unrelated','protectedPath','blob'])test('source guard rejects '+option,()=>assert.throws(()=>guard({[option]:true})));
test('workflow selects new exact app, distinct label, stacked base and one free run only',()=>{
  const yaml=require(path.join(root,'node_modules/js-yaml'));
  const w=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/stocks-private-pg-tls.yml'),'utf8'));
  assert.deepEqual(w.on,{pull_request:{types:['labeled']}});assert.deepEqual(w.permissions,{contents:'read'});
  const job=w.jobs['private-pg-tls'];assert.equal(job['runs-on'],'ubuntu-24.04');assert.equal(job['timeout-minutes'],30);
  assert.ok(job.if.includes('stocks-private-pg-tls-133cb85a-approved')&&job.if.includes('github.run_attempt == 1'));
  assert.equal(job.steps[1].with.ref,APP); assert.equal(job.steps[0].with.ref,'${{ github.event.pull_request.head.sha }}');
  const text=JSON.stringify(w);assert.ok(!/secrets\.|id-token|workflow_dispatch|self-hosted|docker push/.test(text));
});
test('context filter excludes authored tests and review but preserves runtime helper files',()=>{
  const {excluded}=require('./image-context.cjs');
  for(const f of ['src/api/__tests__/a.ts','services/stocks-global/engine.test.mjs','review/run.cjs','docs/secret.md'])assert.equal(excluded(f),true);
  for(const f of manifest.runtime)assert.equal(excluded(f),false);
  assert.equal(excluded('scripts/qa/stocks-runtime-closure.cjs'),false);
});
test('financial assertions retained and intentional exhaustion follows full lifecycle',()=>{
  const s=fs.readFileSync(path.join(__dirname,'fixture.cjs'),'utf8');
  for(const assertion of ["assert.equal(final.fills.length, 3)","assert.equal(Number(cash.locked), 9)","assert.deepEqual(await rows(), protectedBefore)","assert.equal(await db.demoBalance.count(), 2)","'revoked write'","'viewer write'","'financial-off authority'"])assert.ok(s.includes(assertion),assertion);
  assert.ok(s.indexOf('await quotaChecks(')>s.indexOf("pass('single-existing-USDT-demo-cash-isolated-and-no-denial-writes')"));
  assert.ok(s.includes("port: 3011, token:")&&s.includes("port: 3001, headers:"));
});
