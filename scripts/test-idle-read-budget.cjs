'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.env.QA_SOURCE_ROOT || path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
function clock() {
  let now = 0, id = 0;
  const jobs = new Map();
  return {
    setInterval(fn, ms) { const key = ++id; jobs.set(key, { fn, ms, due: now + ms }); return key; },
    clearInterval(key) { jobs.delete(key); },
    count: () => jobs.size,
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...jobs].sort((a,b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        now = next[1].due;
        next[1].due += next[1].ms;
        next[1].fn();
      }
      now = end;
    },
  };
}
function visibility(initial = 'visible') {
  const listeners = new Set();
  return {
    visibilityState: initial,
    addEventListener(_name, fn) { listeners.add(fn); },
    removeEventListener(_name, fn) { listeners.delete(fn); },
    count: () => listeners.size,
    change(next) { this.visibilityState = next; for (const fn of [...listeners]) fn(); },
  };
}
function compile(name, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(source(name), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports, ...extra }, { filename: name });
  return exports;
}
function setup(initial) {
  const time = clock(), doc = visibility(initial);
  const mod = compile('frontend/src/components/spotOrderPresentation.ts', {
    setInterval: time.setInterval, clearInterval: time.clearInterval, document: doc,
  });
  return { time, doc, ...mod };
}
const flush = async () => { for (let i=0; i<12; i++) await Promise.resolve(); };

test('visible cadence is still 4s; one hidden hour owns zero timers and makes zero scheduled reads', () => {
  const s = setup(); const calls = [];
  const stop = s.startVisibleReadPolling(fresh => calls.push(fresh), 4000);
  assert.deepEqual(calls, [true]);
  s.time.tick(12000); assert.deepEqual(calls, [true, false, false, false]);
  s.doc.change('hidden'); assert.equal(s.time.count(), 0);
  s.time.tick(3600000); assert.equal(calls.length, 4);
  s.doc.change('visible'); assert.deepEqual(calls, [true, false, false, false, true]);
  assert.equal(s.time.count(), 1);
  stop(); assert.equal(s.time.count(), 0); assert.equal(s.doc.count(), 0);
});
test('hidden mount defers first network read until visible', () => {
  const s = setup('hidden'); let calls = 0;
  const stop = s.startVisibleReadPolling(() => calls++, 4000);
  s.time.tick(3600000); assert.equal(calls, 0); assert.equal(s.time.count(), 0);
  s.doc.change('visible'); assert.equal(calls, 1); stop();
});
test('duplicate visibility notifications cannot create duplicate clocks or bursts', () => {
  const s = setup(); let calls = 0;
  const stop = s.startVisibleReadPolling(() => calls++, 4000);
  for (let i=0;i<20;i++) s.doc.change('visible');
  assert.equal(calls,1); assert.equal(s.time.count(),1);
  s.doc.change('hidden'); s.doc.change('visible'); s.doc.change('visible');
  assert.equal(calls,2); assert.equal(s.time.count(),1); stop();
});
test('unmount and remount clean up listeners and polling without resurrection', () => {
  const s = setup(); let calls = 0;
  const first = s.startVisibleReadPolling(() => calls++, 4000);
  first(); first(); s.doc.change('hidden'); s.doc.change('visible'); s.time.tick(12000);
  assert.equal(calls,1); assert.equal(s.doc.count(),0);
  const second = s.startVisibleReadPolling(() => calls++,4000);
  assert.equal(calls,2); assert.equal(s.doc.count(),1); second();
});
test('slow read is single-flight; visibility return invalidates old result and queues one fresh read', async () => {
  const s = setup(), requests = [], accepted = [];
  const reader = s.createSpotReadController(() => new Promise(resolve => requests.push(resolve)), {
    accept: value => accepted.push(value), reject() {}, settled() {},
  });
  const stop = s.startVisibleReadPolling(reader.read,4000);
  await flush(); s.time.tick(16000); await flush(); assert.equal(requests.length,1);
  s.doc.change('hidden'); s.time.tick(3600000); s.doc.change('visible');
  requests[0]('stale'); await flush(); assert.equal(requests.length,2); assert.deepEqual(accepted,[]);
  requests[1]('fresh'); await flush(); assert.deepEqual(accepted,['fresh']);
  stop(); reader.pause();
});
test('mutation refresh remains immediate even hidden and completion after disposal cannot poll', async () => {
  const s = setup(); let calls=0; const accepted=[];
  const reader=s.createSpotReadController(async()=>++calls,{accept:x=>accepted.push(x),reject(){},settled(){}});
  const stop=s.startVisibleReadPolling(reader.read,4000); await flush();
  s.doc.change('hidden'); await reader.read(true); assert.equal(calls,2);
  s.time.tick(3600000); assert.equal(calls,2); stop(); reader.pause();
  await reader.read(true); assert.equal(calls,2);
});
test('failed read recovers on return without replacing last-known data or adding timers', async () => {
  const s=setup(), accepted=[]; let calls=0, failures=0;
  const reader=s.createSpotReadController(async()=>{if(++calls===2)throw Error('fixture');return calls;},{accept:x=>accepted.push(x),reject(){failures++},settled(){}});
  const stop=s.startVisibleReadPolling(reader.read,4000); await flush();
  s.time.tick(4000); await flush(); assert.equal(failures,1); assert.deepEqual(accepted,[1]);
  s.doc.change('hidden'); s.doc.change('visible'); await flush();
  assert.deepEqual(accepted,[1,3]); assert.equal(s.time.count(),1); stop();reader.pause();
});
for (const name of ['OpenOrdersPanel','OrderHistoryPanel','AssetsPanel']) {
  test(`${name} uses the shared visible clock and retains manual fresh reads`, () => {
    const code=source(`frontend/src/components/${name}.tsx`);
    assert.match(code,/startVisibleReadPolling\(load, 4000\)/);
    assert.doesNotMatch(code,/setInterval\(load, 4000\)/);
    assert.match(code,/stopPolling\(\)/);
    assert.match(code,/load\(true\)/);
  });
}
test('Futures assets keep their existing shared store and no additional mount timer', () => {
  const code=source('frontend/src/components/AssetsPanel.tsx');
  assert.match(code,/useFuturesAccount\(isFutures \? \{ balances: 4000 \} : \{\}\)/);
  assert.ok(code.indexOf('if (isFutures)')<code.indexOf('startVisibleReadPolling(load'));
  assert.match(code,/if \(refreshKey > 0\) void load\(true\)/);
});
function authFixture() {
  let session={id:'session-fixture',userId:'user-fixture',revokedAt:null,lastSeenAt:new Date()};
  const reads=[],writes=[];
  const db={session:{async findUnique(args){reads.push(args);return session},async update(args){writes.push(args);return {id:'session-fixture'}}}};
  const {requireAuth}=compile('src/api/middleware/auth.ts',{
    require(name){if(name==='jsonwebtoken')return {verify(){return {sub:'user-fixture',sid:'session-fixture'}}};throw Error(name)},
    process:{env:{JWT_SECRET:'local-test-placeholder-not-a-production-secret'}},
  });
  return { reads,writes,db, setSession(next){session=next}, async call(){
    const req={headers:{authorization:'Bearer fixture'}},res={statusCode:200,status(code){this.statusCode=code;return this},json(){return this}};
    let accepted=false;await requireAuth(db)(req,res,()=>{accepted=true});return {req,res,accepted};
  }};
}
test('session authorization transfers only four used fields, and rechecks on every request', async()=>{
  const a=authFixture();await a.call();await a.call();assert.equal(a.reads.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(a.reads[0])),{where:{id:'session-fixture'},select:{id:true,userId:true,revokedAt:true,lastSeenAt:true}});
  assert.equal(a.writes.length,0);
});
test('revocation, deletion and mismatched session owner remain immediately rejected',async()=>{
  const a=authFixture();assert.equal((await a.call()).accepted,true);
  for(const value of [null,{id:'session-fixture',userId:'user-fixture',revokedAt:new Date(),lastSeenAt:new Date()},{id:'session-fixture',userId:'other',revokedAt:null,lastSeenAt:new Date()}]){
    a.setSession(value);const r=await a.call();assert.equal(r.accepted,false);assert.equal(r.res.statusCode,401);
  }
  assert.equal(a.reads.length,4);assert.equal(a.writes.length,0);
});
test('lastSeenAt retains its five-minute threshold and returns only id after a touch',async()=>{
  const a=authFixture();a.setSession({id:'session-fixture',userId:'user-fixture',revokedAt:null,lastSeenAt:new Date(Date.now()-360000)});
  assert.equal((await a.call()).accepted,true);assert.equal(a.writes.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(a.writes[0].select)),{id:true});
  assert.deepEqual(Object.keys(a.writes[0].data),['lastSeenAt']);
});
