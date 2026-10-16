import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schedule, LIMITS, descriptor, validateLimits } from './plan.mjs';
import { hash, transform, prepare, ROOTS } from './source.mjs';
import { summarize, quantiles,SQL_KEYS,QUEUE_KEYS,accountDeltas,drained,journalIssues,traceIssues,quoteIssues,kernelCounters,ioCounters,preflightGate } from './metrics.mjs';
import { classify,capacityProof } from './client.mjs';
import { profileBody, startAuthority } from './authority.mjs';
import { identityResolver, IDENTITY_RESPONSE_MAX_BYTES } from '../../stocks-global/identity.mjs';

test('exact30 runs are three counterbalanced pairs per independent profile', () => {
  const rows = schedule(); assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map(r => [r.profile, r.repeat, r.variant].join('|'))).size, 30);
  for (const profile of new Set(rows.map(r => r.profile))) assert.deepEqual(rows.filter(r => r.profile === profile).map(r => r.variant), ['control','target','target','control','control','target']);
  assert.deepEqual(descriptor('identity').cohorts, [5,20,50]); assert.equal(descriptor('projection50').catalogue,40);
  assert.equal(descriptor('wallet').users,5); assert.equal(LIMITS.deadlineMs,3000);
});
test('resource validation fails on wrong disk device, missing swap, CPU and I/O instead of assuming limits', () => {
  const proof = { cpuMax: '5000 100000', memoryMax: '268435456', swapMax: '0', ioMax: '8:1 rbps=1048576 wbps=131072' };
  validateLimits(proof,'8:1'); for (const patch of [{ cpuMax:'10000 100000' },{ swapMax:null },{ ioMax:'8:2 rbps=1048576 wbps=131072' },{ memoryMax:'max' }]) assert.throws(() => validateLimits({...proof,...patch},'8:1'));
  assert.throws(() => validateLimits(proof));
});
test('incomplete, duplicate or missing timings cannot become zero-errors PASS', () => {
  const row={id:'1',ms:5,outcome:'SUCCESS'},before={cpuMs:10},after={cpuMs:20};
  assert.equal(summarize([row],2,before,after).errors,null);
  assert.equal(summarize([row,row],2,before,after).completeness,'INCOMPLETE');
  assert.equal(summarize([{...row,ms:NaN}],1,before,after).allAttemptLatencyMs,null);
  assert.equal(summarize([row],1,{},after).cpuMs,null);
  assert.equal(summarize([{...row,outcome:'ERROR',code:'RATE_LIMIT'}],1,before,after).errors,1);
  assert.equal(summarize([{...row,outcome:'EXPECTED_ABORT'}],1,before,after).expectedAborts,1);
  assert.deepEqual(quantiles([1,2,100]),{n:3,p50:2,p95:100,p99:100,max:100});
});
test('control hunks target only their mechanism and reject missing or duplicated callsites', () => {
  const server = readFileSync(new URL('../../stocks-global/server.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const wallet=transform('wallet',server),history=transform('history',server);
  assert.equal(wallet,server.replace('quote(id,{includeUsdc:false,signal})','quote(id,{includeUsdc:true,signal})'));
  assert.equal(history,server.replace("u.searchParams.get('before'),{signal:abort.signal})","u.searchParams.get('before'))"));
  assert.throws(()=>transform('wallet',server+server)); assert.throws(()=>transform('history','old noncancellable source'));
  const projection=transform('projection20',readFileSync(new URL('../../stocks-global/viewer-projection.mjs',import.meta.url),'utf8'));
  assert.ok(projection.includes('return snapshot({ ...view, quotes: { ...view.quotes, [instrumentId]: quote } }, now);'));
});
test('wallet controls preserve both exact historical and cancellable callsites without modifying any other bytes', () => {
  for (const [from,to] of [
    ['quote(id,{includeUsdc:false})','quote(id,{includeUsdc:true})'],
    ['quote(id,{includeUsdc:false,signal})','quote(id,{includeUsdc:true,signal})'],
  ]) {
    const prefix='const before = "unchanged";\nawait ', suffix=';\nconst after = "unchanged";\n';
    assert.equal(transform('wallet',prefix+from+suffix),prefix+to+suffix);
  }
});
test('wallet controls reject mixed, duplicate and unknown callsites rather than broadening the reviewed transform', () => {
  const legacy='quote(id,{includeUsdc:false})', cancellable='quote(id,{includeUsdc:false,signal})';
  for (const source of [legacy+';'+legacy,cancellable+';'+cancellable,legacy+';'+cancellable,cancellable+';'+legacy,
    'quote(id,{includeUsdc:false,signal:other})','quote(id,{includeUsdc:false,signal:abort.signal})',
    'quote(id,{includeUsdc:false, signal})','quote(id,{signal,includeUsdc:false})',
    'quote(id,{includeUsdc:false,...options})','quote(id,{includeUsdc:true,signal})','missing']) {
    assert.throws(()=>transform('wallet',source),/UNREVIEWED_TARGET_HUNK/,source);
  }
  assert.throws(()=>transform('unknown',legacy),/UNREVIEWED_TARGET_HUNK/);
});
test('all runtime hashes are verified even for target-first and identity pairs', t => {
  const base=mkdtempSync(join(tmpdir(),'targeted-source-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const source=join(base,'source');
  for(const root of ROOTS)mkdirSync(join(source,root),{recursive:true});
  const server='unchanged server',projection='unchanged projection';writeFileSync(join(source,'services/stocks-global/server.mjs'),server);writeFileSync(join(source,'services/stocks-global/viewer-projection.mjs'),projection);
  const reviewed={'services/stocks-global/server.mjs':hash(server),'services/stocks-global/viewer-projection.mjs':hash(projection)};
  const manifest=prepare(source,join(base,'good'),'identity','target','a'.repeat(40),reviewed);assert.equal(manifest.changes.length,0);
  assert.throws(()=>prepare(source,join(base,'bad'),'projection20','target','a'.repeat(40),{...reviewed,'services/stocks-global/server.mjs':'0'.repeat(64)}),/HASH_NOT_REVIEWED/);
  assert.throws(()=>prepare(source,join(source,'nested'),'identity','target','a'.repeat(40),reviewed),/OUTSIDE/);
});
test('near1MiB identity is a valid retained whitespace-padded avatar below actual UTF8 byte cap', () => {
  const body=profileBody('viewer-49',true),small=profileBody('viewer-49',false),user=JSON.parse(body);
  assert.ok(body.length>1048000 && body.length<IDENTITY_RESPONSE_MAX_BYTES);assert.ok(small.length<1024);
  const png=Buffer.from(user.avatarUrl.split(',')[1],'base64');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.length<512*1024);
  assert.ok(Buffer.byteLength(JSON.stringify({image:user.avatarUrl}))<=1024*1024);
});
test('large /me uses actual HTTP and current resolver; authority does not authorize forged subjects', async t => {
  // Two sequential correctness requests only; this is not the concurrency/load preflight.
  const {createServer}=await import('node:net');const reserve=createServer();await new Promise(ok=>reserve.listen(0,'127.0.0.1',ok));const port=reserve.address().port;await new Promise(ok=>reserve.close(ok));
  const f=await startAuthority({port,large:true,nonce:'a'.repeat(32)});t.after(()=>f.close());
  const authenticate=identityResolver({endpoint:`http://127.0.0.1:${port}/api/v1/me`,issuer:'targeted-http-fixture'});
  assert.deepEqual(await authenticate({headers:{authorization:'Bearer targeted-fixture-viewer-0'}}),{issuer:'targeted-http-fixture',subject:'viewer-0'});
  await assert.rejects(authenticate({headers:{authorization:'Bearer targeted-fixture-intruder'}}),e=>e.code==='AUTH_REQUIRED');
  assert.equal(f.metrics().attempts,1);assert.equal(f.metrics().completed,1);
});

test('late HTTP success is a deadline error even if its timer callback has not run',()=>{
  assert.equal(classify({elapsedMs:2999,status:200}).outcome,'SUCCESS');
  assert.deepEqual(classify({elapsedMs:3001,status:200}),{outcome:'ERROR',code:'DEADLINE_3000MS'});
  assert.equal(classify({elapsedMs:2999,status:null,expectedAbort:true}).outcome,'EXPECTED_ABORT');
  assert.deepEqual(classify({elapsedMs:3000,status:null,expectedAbort:true}),{outcome:'ERROR',code:'DEADLINE_3000MS'});
});
const sample=()=>({wallMs:1000,cpuMs:10,memory:{rss:100},maxRss:100,accounts:{...Object.fromEntries(SQL_KEYS.map(k=>[k,1])),sqlThreadCpuAvailable:1,updatedAt:900,metricsAgeMs:100,workerAlive:1,queue:{...Object.fromEntries(QUEUE_KEYS.map(k=>[k,1])),pending:0,active:0,bytes:0}},live:{nativeInflight:0,flights:0,active:0,queued:0,quoteFlights:0}});
test('SQL/queue snapshots require complete finite monotonic counters and actual worker provenance',()=>{
  const before=sample(),after=sample();assert.deepEqual(accountDeltas(before,after).issues,[]);assert.equal(drained(after),true);
  for(const key of SQL_KEYS){const broken=sample();delete broken.accounts[key];assert.ok(accountDeltas(before,broken).issues.length);assert.equal(drained(broken),false);}
  const old=sample();old.accounts.workerAlive=0;assert.equal(drained(old),false);
  const queued=sample();queued.accounts.queue.active=1;assert.equal(drained(queued),false);
  const reversed=sample();reversed.accounts.sqlCalls=0;assert.ok(accountDeltas(before,reversed).issues.includes('ACCOUNT_COUNTER_DECREASED_OR_ABSENT'));
  const misdated=sample();misdated.accounts.metricsAgeMs=5000;assert.ok(accountDeltas(before,misdated).issues.length);
});
test('dispatch settlement and response-contract gaps are never silently complete',()=>{
  const client={records:[{id:'a',outcome:'SUCCESS'}],dispatches:[{id:'a',atMs:1,path:'state',method:'GET',deliberateAbort:false}],contracts:[{name:'catalogue40',ok:true},{name:'empty-readonly',ok:true},{name:'projection-source',ok:true}]};
  assert.deepEqual(journalIssues(client,'projection20'),[]);assert.ok(journalIssues({...client,dispatches:[]},'projection20').length);
  assert.ok(journalIssues({...client,contracts:[]},'projection20').length);
  assert.ok(journalIssues({...client,records:[{id:'a',outcome:'EXPECTED_ABORT'}]},'identity').includes('UNPLANNED_ABORT'));
});
test('native trace must reconcile all logical and transport outcomes, including errors',()=>{
  const kinds=['requested','admission-observed-at-fetch','native-start','native-completed','completed'];
  const trace=kinds.map((kind,i)=>({sequence:i+1,kind,atMs:i,wallMs:1000+i,host:'api.bybit.com',flight:'a'.repeat(64)}));
  const s={logical:{requested:1,completed:1,failed:0},transport:{starts:1,completed:1,failed:0,cancelled:0,inflight:0}};
  assert.deepEqual(traceIssues(trace,s),[]);assert.ok(traceIssues(trace.slice(1),s).length);
  assert.ok(traceIssues(trace,{...s,transport:{...s.transport,failed:1}}).length);
  assert.ok(traceIssues(trace,{...s,logical:{requested:1,completed:1}}).length);
  const q={instrumentId:'BYBIT:AAPLXUSDT',provider:'bybit',timestamp:1000,receivedAt:1001,eventId:'event'};
  assert.deepEqual(quoteIssues([{outcome:'SUCCESS',quoteEvidence:[q]}],[{kind:'native-start',symbol:'AAPLXUSDT',providerEventId:'event',providerTimestamp:1000}]),[]);
  assert.ok(quoteIssues([{outcome:'SUCCESS',quoteEvidence:[q]}],[]).length);
});
test('kernel evidence rejects absent counters and accepts real dotted CPU extension names',()=>{
  assert.deepEqual(kernelCounters('usage_usec 12\ncore_sched.force_idle_usec 0\n'),{usage_usec:12,'core_sched.force_idle_usec':0});
  assert.equal(kernelCounters('oom 0\noom 0'),null);assert.equal(kernelCounters(null),null);
  assert.equal(ioCounters('8:1 rbytes=1 wbytes=2 rios=3 wios=4').totals.wbytes,2);
  for(const raw of ['',null,'8:1 other=0','8:1 rbytes=1 rbytes=2 wbytes=2 rios=3 wios=4'])assert.equal(ioCounters(raw),null);
});
test('failed preflight cleanup prevents any measured run even if the HTTP preflight passed',()=>{
  const row={preflight:true,status:'PASS'};preflightGate(row);row.cleanup=['owned container failed to stop'];row.status='INCOMPLETE';assert.throws(()=>preflightGate(row),/NO_MEASURED_RUNS_STARTED/);
  preflightGate({preflight:false,status:'INCOMPLETE'});
});
test('Wallet capacity proof requires both actual used counters and their source event identities',()=>{
  const q={used:'0.25000000',capacity:'1.00000000',eventId:'native-1',timestamp:1000},body={quotes:{'BYBIT:AAPLXUSDT':q,'BINANCE:AAPLBUSDT':q}};
  assert.equal(Object.keys(capacityProof(body)).length,2);assert.throws(()=>capacityProof({quotes:{'BYBIT:AAPLXUSDT':q}}),/MISSING/);
  assert.throws(()=>capacityProof({quotes:{...body.quotes,'BINANCE:AAPLBUSDT':{...q,used:undefined}}}),/MISSING/);
});
