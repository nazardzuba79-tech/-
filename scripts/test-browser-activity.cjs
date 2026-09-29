'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../frontend/src/lib/browserActivity.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sessionCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../frontend/src/lib/browserSession.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const visibleReadCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../frontend/src/lib/visibleRead.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = async () => { for (let i=0; i<20; i++) await Promise.resolve(); await new Promise(setImmediate); };
function setup({ validate = async () => {}, fetcher = async () => new Response('{}') } = {}) {
  let now = 1_000_000, serial = 0, token = 'a'; const jobs = new Map(), calls = [];
  const target = () => ({ listeners: new Map(), addEventListener(type, cb) { if (!this.listeners.has(type)) this.listeners.set(type,new Set()); this.listeners.get(type).add(cb); }, removeEventListener(type,cb) { this.listeners.get(type)?.delete(cb); }, dispatchEvent(event) { for (const cb of this.listeners.get(event.type) || []) cb(event); } });
  const window = target(), document = Object.assign(target(), { hidden: false });
  const schedule = (fn, ms, repeat) => { const id=++serial; jobs.set(id,{fn,ms,repeat,at:now+ms}); return id; };
  class Clock extends Date { static now() { return now; } }
  const sandbox = { exports:{}, window, document, Date:Clock, Event, DOMException, Request, Response, Headers, AbortController,
    setTimeout:(fn,ms)=>schedule(fn,ms,false), setInterval:(fn,ms)=>schedule(fn,ms,true), clearTimeout:id=>jobs.delete(id), clearInterval:id=>jobs.delete(id),
    fetch:async(...args)=>{calls.push(args);return fetcher(...args);} };
  vm.runInNewContext(code,sandbox); const api=sandbox.exports;
  const readerSandbox = { ...sandbox, exports: {}, require: name => { assert.equal(name, './browserActivity'); return api; } };
  vm.runInNewContext(visibleReadCode, readerSandbox);
  const createVisibleRead = readerSandbox.exports.createVisibleRead;
  let validations=0;
  const stop=api.startBrowserActivity({identity:()=>token,validate:async()=>{validations++;await validate();}});
  const advance=async ms=>{const end=now+ms;for(;;){const next=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const[id,j]=next;now=j.at;if(j.repeat)j.at+=j.ms;else jobs.delete(id);j.fn();await flush();}now=end;await flush();};
  return { api,createVisibleRead,calls,jobs,stop,advance,window,document,get validations(){return validations;},setToken:t=>{token=t;},
    hidden:value=>{document.hidden=value;document.dispatchEvent(new Event('visibilitychange'));},
    input:(type='click',isTrusted=true,properties={})=>{const event={type,isTrusted,...properties,blocked:false,preventDefault(){this.blocked=true;},stopImmediatePropagation(){this.blocked=true;}};window.dispatchEvent(event);return event;},
    wake:async()=>{const pending=api.resumeBrowser();await flush();await advance(151);await pending;},
  };
}

for (const changeDuringBody of [false, true]) test(`session validation owns its response body: account changed=${changeDuringBody}`, async () => {
  let token = 'first', release;
  const body = new Promise(resolve => { release = resolve; });
  const sandbox = { exports: {}, AbortController, setTimeout, clearTimeout,
    require: () => ({ API_BASE: '/api/v1', getToken: () => token, clearToken: () => { token = null; } }),
    fetch: async () => ({ ok: true, status: 200, json: () => body }),
  };
  vm.runInNewContext(sessionCode, sandbox);
  const pending = sandbox.exports.validateBrowserSession();
  await flush();
  if (changeDuringBody) token = 'second';
  release({ id: 'first' });
  if (changeDuringBody) await assert.rejects(pending, /Session changed/); else await pending;
});

test('revoked session is cleared and redirected once without retry', async () => {
  let token = 'revoked', calls = 0; const redirects = [];
  const sandbox = { exports: {}, AbortController, setTimeout, clearTimeout,
    require: () => ({ API_BASE: '/api/v1', getToken: () => token, clearToken: () => { token = null; } }),
    fetch: async () => { calls++; return { ok: false, status: 401 }; },
    window: { location: { pathname: '/futures', search: '?pair=BTC', assign: url => redirects.push(url) } },
  };
  vm.runInNewContext(sessionCode, sandbox);
  await assert.rejects(sandbox.exports.validateBrowserSession(), /Session expired/);
  assert.equal(token, null); assert.equal(calls, 1);
  assert.deepEqual(redirects, ['/login?next=%2Ffutures%3Fpair%3DBTC']);
});
test('five minute visible deadline; background prices and untrusted events do not reset it',async()=>{
  const s=setup();let polls=0;s.api.browserSetInterval(()=>{polls++;s.input('pointermove',false);},1000);
  await s.advance(299999);assert.equal(s.api.getBrowserPhase(),'active');await s.advance(1);assert.equal(s.api.getBrowserPhase(),'sleeping');
  const before=polls;await s.advance(1800000);assert.equal(polls,before);assert.equal(s.jobs.size,0);s.stop();
});
test('trusted input extends the deadline, and the first waking click is consumed',async()=>{
  const s=setup();await s.advance(299000);s.input('keydown');await s.advance(299000);assert.equal(s.api.getBrowserPhase(),'active');await s.advance(1000);
  assert.equal(s.input().blocked,true);await flush();await s.advance(151);assert.equal(s.api.getBrowserPhase(),'active');assert.equal(s.validations,1);s.stop();
});

test('a new deliberate gesture works immediately after the waking gesture is consumed', async () => {
  const s=setup(); await s.advance(300000);
  assert.equal(s.input('pointerdown').blocked,true);
  await flush(); await s.advance(151);
  assert.equal(s.api.getBrowserPhase(),'active');
  assert.equal(s.input('click').blocked,true);
  assert.equal(s.input('pointerdown').blocked,false);
  assert.equal(s.input('click').blocked,false);
  s.stop();
});
test('a long-held waking pointer cannot activate an order on its trailing click', async () => {
  const s = setup(); await s.advance(300000);
  assert.equal(s.input('pointerdown').blocked, true);
  await flush(); await s.advance(2000);
  assert.equal(s.api.getBrowserPhase(), 'active');
  assert.equal(s.input('click').blocked, true);
  assert.equal(s.input('pointerdown').blocked, false);
  assert.equal(s.input('click').blocked, false);
  s.stop();
});
test('auto-repeat of a held waking key is not another deliberate order gesture', async () => {
  const s = setup(); await s.advance(300000);
  assert.equal(s.input('keydown', true, { key: 'Enter', repeat: false }).blocked, true);
  await flush(); await s.advance(2000);
  assert.equal(s.input('keydown', true, { key: 'Enter', repeat: true }).blocked, true);
  assert.equal(s.input('click').blocked, true);
  assert.equal(s.input('keydown', true, { key: 'Enter', repeat: false }).blocked, false);
  s.stop();
});
test('wake waits for a pre-sleep account read, its processing and the queued current refresh', async () => {
  const responses = [], accepted = [];
  let acceptOld;
  const processing = new Promise(resolve => { acceptOld = resolve; });
  const s = setup({ fetcher: () => new Promise(resolve => responses.push(resolve)) });
  const reader = s.createVisibleRead(async () => {
    const value = await (await s.api.browserFetch('/account')).json();
    if (value.revision === 1) await processing;
    accepted.push(value.revision);
  }, 60000);
  await flush(); assert.equal(responses.length, 1);
  s.api.sleepBrowser(); const waking = s.api.resumeBrowser();
  await flush(); await s.advance(151);
  assert.equal(s.api.getBrowserPhase(), 'syncing');
  assert.equal(s.input('click').blocked, true);
  responses[0](new Response('{"revision":1}'));
  await flush(); await s.advance(300);
  assert.equal(s.api.getBrowserPhase(), 'syncing');
  assert.deepEqual(accepted, []);
  acceptOld(); await flush(); assert.equal(responses.length, 2);
  await s.advance(300);
  assert.equal(s.api.getBrowserPhase(), 'syncing');
  responses[1](new Response('{"revision":2}'));
  await flush(); await s.advance(151); await waking;
  assert.equal(s.api.getBrowserPhase(), 'active');
  assert.deepEqual(accepted, [1, 2]); assert.equal(s.validations, 1);
  reader.stop(); s.stop();
});
test('a pending read from a previous session cannot block the new session wake', async () => {
  let response;
  const s = setup({ fetcher: () => new Promise(resolve => { response = resolve; }) });
  const old = s.api.browserFetch('/old-account');
  await flush(); s.api.sleepBrowser(); s.setToken('new');
  await s.wake(); assert.equal(s.api.getBrowserPhase(), 'active');
  response(new Response('{}')); await assert.rejects(old, /Session changed/);
  s.stop();
});
test('an orphaned prior-session logical read cannot mark the new session stale', async () => {
  const s = setup(); s.api.sleepBrowser(); const waking = s.api.resumeBrowser();
  await flush(); let failOld;
  const old = s.api.trackBrowserRead(new Promise((_resolve, reject) => { failOld = reject; }));
  s.setToken('new'); failOld(new Error('Old account refused'));
  await assert.rejects(old, /Old account refused/);
  await s.advance(151); await waking;
  assert.equal(s.api.getBrowserPhase(), 'active'); s.stop();
});
for (const recovered of [true, false]) test(`provider fallback reports its logical outcome: recovered=${recovered}`, async () => {
  const s = setup({ fetcher: async url => new Response('{}', { status: url === '/fallback' && recovered ? 200 : 503 }) });
  s.api.browserSetInterval(() => s.api.trackBrowserRead((async () => {
    const first = await s.api.browserFallbackFetch('/provider');
    if (first.ok) return;
    const fallback = await s.api.browserFallbackFetch('/fallback');
    if (!fallback.ok) throw new Error('No current market snapshot');
  })()), 1000);
  s.api.sleepBrowser(); await s.wake();
  assert.equal(s.api.getBrowserPhase(), recovered ? 'active' : 'error');
  assert.equal(s.calls.length, 2); s.stop();
});
test('visible focused owned chart is preserved; leaving it starts an ordinary five-minute deadline', async () => {
  const s = setup();
  s.document.activeElement = { tagName: 'IFRAME', isConnected: true, closest: selector => selector === '.voltex-tradingview-chart__owned' ? {} : null };
  s.document.hasFocus = () => true;
  s.window.dispatchEvent(new Event('blur')); await s.advance(900000);
  assert.equal(s.api.getBrowserPhase(), 'active');
  s.document.activeElement = null; s.window.dispatchEvent(new Event('focus'));
  await s.advance(299999); assert.equal(s.api.getBrowserPhase(), 'active');
  await s.advance(1); assert.equal(s.api.getBrowserPhase(), 'sleeping'); s.stop();
});
test('hidden, unrelated and unfocused iframes cannot prevent sleep', async () => {
  for (const scenario of ['hidden', 'unrelated', 'unfocused']) {
    const s = setup();
    s.document.activeElement = { tagName: 'IFRAME', isConnected: true, closest: () => scenario === 'unrelated' ? null : {} };
    s.document.hasFocus = () => scenario !== 'unfocused';
    if (scenario === 'hidden') s.hidden(true); else await s.advance(300000);
    assert.equal(s.api.getBrowserPhase(), 'sleeping', scenario); s.stop();
  }
});
test('hidden stops immediately, focus + visibility + input join one validation',async()=>{
  const s=setup();let polls=0;s.api.browserSetInterval(()=>polls++,1000);s.hidden(true);await s.advance(1800000);assert.equal(polls,0);
  s.hidden(false);s.window.dispatchEvent(new Event('focus'));s.input();await flush();await s.advance(151);assert.equal(s.validations,1);assert.equal(polls,1);s.stop();
});
test('late mounted reads stay dormant; mounted duplicates share one wake GET',async()=>{
  const s=setup();s.hidden(true);const a=s.api.browserFetch('/balance'),b=s.api.browserFetch('/balance');await flush();assert.equal(s.calls.length,0);
  s.hidden(false);await flush();await s.advance(151);await Promise.all([a,b]);assert.equal(s.calls.length,1);s.stop();
});
test('sent mutation finishes while asleep and is never replayed',async()=>{
  let complete;const s=setup({fetcher:()=>new Promise(r=>{complete=r;})});const sent=s.api.browserFetch('/order',{method:'POST'});s.hidden(true);complete(new Response('{"ok":true}'));assert.equal((await sent).status,200);
  await s.advance(1800000);s.hidden(false);await flush();await s.advance(151);assert.equal(s.calls.length,1);s.stop();
});
test('session changes reject a late old-account read',async()=>{
  let complete;const s=setup({fetcher:()=>new Promise(r=>{complete=r;})});const read=s.api.browserFetch('/wallet');await flush();s.setToken('b');complete(new Response('{}'));await assert.rejects(read,/Session changed/);s.stop();
});
test('aborted dormant read does not fire on wake',async()=>{
  const s=setup();s.hidden(true);const c=new AbortController();const read=s.api.browserFetch('/old-route',{signal:c.signal});c.abort();await assert.rejects(read,/Aborted/);await s.advance(1800000);s.hidden(false);await flush();await s.advance(151);assert.equal(s.calls.length,0);s.stop();
});
test('validation failure keeps transports stopped with no automatic retry',async()=>{
  const s=setup({validate:async()=>{throw new Error('offline');}});s.api.sleepBrowser();await s.wake();assert.equal(s.api.getBrowserPhase(),'error');await s.advance(1800000);s.input('pointermove');assert.equal(s.validations,1);assert.equal(s.calls.length,0);s.stop();
});
test('resume GET failure stays visibly stale, without retry storm',async()=>{
  const s=setup({fetcher:async()=>new Response('{}',{status:503})});s.api.browserSetInterval(()=>s.api.browserFetch('/positions'),1000);s.api.sleepBrowser();await s.wake();assert.equal(s.api.getBrowserPhase(),'error');const n=s.calls.length;await s.advance(1800000);assert.equal(s.calls.length,n);s.stop();
});
test('two independent tabs have independent idle deadlines',async()=>{
  const a=setup(),b=setup();await a.advance(300000);await b.advance(200000);b.input('wheel');await b.advance(100000);assert.equal(a.api.getBrowserPhase(),'sleeping');assert.equal(b.api.getBrowserPhase(),'active');a.stop();b.stop();
});
test('hide-return race while validation is pending starts a new current cycle',async()=>{
  let release;let first=true;const s=setup({validate:()=>first?(first=false,new Promise(r=>release=r)):Promise.resolve()});s.api.sleepBrowser();const pending=s.api.resumeBrowser();s.hidden(true);s.hidden(false);release();await pending;await flush();await s.advance(151);assert.equal(s.api.getBrowserPhase(),'active');assert.equal(s.validations,2);s.stop();
});
test('stopped screen interval does not refresh on wake',async()=>{
  const s=setup();let calls=0;const id=s.api.browserSetInterval(()=>calls++,1000);s.api.sleepBrowser();s.api.browserClearInterval(id);await s.wake();assert.equal(calls,0);s.stop();
});

test('one component aborting on wake cannot cancel another component read',async()=>{
  const pending=[];
  const s=setup({fetcher:(_url,init)=>new Promise((resolve,reject)=>{
    pending.push(resolve);init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  })});
  const a=new AbortController(),b=new AbortController();
  s.api.sleepBrowser();s.hidden(false);await flush();
  const one=s.api.browserFetch('/positions',{signal:a.signal}),two=s.api.browserFetch('/positions',{signal:b.signal});
  await flush();assert.equal(s.calls.length,1);a.abort();await assert.rejects(one,/Aborted/);
  pending[0](new Response('{"positions":[]}'));assert.equal((await two).status,200);
  await s.advance(151);assert.equal(s.api.getBrowserPhase(),'active');s.stop();
});

test('old generation read failure cannot poison a new wake',async()=>{
  let reject;const s=setup({fetcher:()=>new Promise((_r,no)=>reject=no)});
  const old=s.api.browserFetch('/old');await flush();s.api.sleepBrowser();
  const waking=s.api.resumeBrowser();await flush();reject(new Error('old request failed'));
  await assert.rejects(old,/old request failed/);await s.advance(151);await waking;
  assert.equal(s.api.getBrowserPhase(),'active');s.stop();
});

test('different headers or methods are not coalesced into the same wake read',async()=>{
  const s=setup();s.api.sleepBrowser();s.hidden(false);await flush();
  await Promise.all([
    s.api.browserFetch('/value',{headers:{Accept:'application/json'}}),
    s.api.browserFetch('/value',{headers:{Accept:'text/plain'}}),
    s.api.browserFetch('/value',{method:'HEAD'}),
  ]);
  assert.equal(s.calls.length,3);await s.advance(151);s.stop();
});

test('F5 and browser reload shortcuts remain available while asleep',()=>{
  const s=setup();s.api.sleepBrowser();
  for(const values of [{key:'F5'},{key:'r',ctrlKey:true},{key:'R',metaKey:true}]){
    let blocked=false;s.window.dispatchEvent({type:'keydown',isTrusted:true,...values,preventDefault(){blocked=true;},stopImmediatePropagation(){blocked=true;}});
    assert.equal(blocked,false);
  }
  s.stop();
});
