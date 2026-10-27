// Actual VerificationSection loading/retry hooks, synthetic API only.
// No real session, upload, notification or external request.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const frontend=path.resolve(__dirname,'../../frontend');
const {createRequire}=require('node:module');
const requireFrontend=createRequire(path.join(frontend,'package.json'));
const React=requireFrontend('react');
const {createRoot}=requireFrontend('react-dom/client');
const {JSDOM}=requireFrontend('jsdom');
async function withVerification(api, check) {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://ru.example.invalid'});
  const before={window:global.window,document:global.document};
  global.window=dom.window;global.document=dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const Panel=({children})=>React.createElement('section',null,children);
  const nil=()=>null;
  const imports={
    react:React,'react/jsx-runtime':requireFrontend('react/jsx-runtime'),
    'lucide-react':new Proxy({},{get:()=>nil}),sonner:{toast:{}},
    '../../lib/api':{api},'../../lib/i18n':{useLanguage:()=>({lang:'ru',t:key=>key})},
    '../../components/CountrySelect':{CountrySelect:nil},'../../lib/countries':{},
    './KycUpload':{KycUpload:nil},'./KycMaterialsPanel':{KycMaterialsPanel:nil},
    './Panel':{Panel,PanelHeader:nil},'./StatusBadge':{StatusBadge:nil},
    '../../lib/customerError':{},'../../lib/kycEdge':{readKycReceipt:()=>null},
    '../../lib/kycSteps':{kycStepStates:()=>({personal:'todo',document:'todo',review:'todo'})},
  };
  const source=fs.readFileSync(path.join(frontend,'src/pages/settings-arctic/VerificationSection.tsx'),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',code)(name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name];},exports);
  const root=createRoot(document.getElementById('root'));
  try{
    await React.act(async()=>{root.render(React.createElement(exports.VerificationSection));});
    await check();
  }finally{await React.act(async()=>root.unmount());dom.window.close();Object.assign(global,before);delete global.IS_REACT_ACT_ENVIRONMENT;}
}
const ready=()=>({kycStatus:'NOT_STARTED',latestSubmission:null});
const clickRetry=()=>React.act(async()=>document.querySelector('button').dispatchEvent(new window.MouseEvent('click',{bubbles:true})));
test('network rejection renders an alert and retry recovers without sending KYC',async()=>{
  let calls=0;
  await withVerification({getMyKyc:async()=>{calls++;if(calls===1)throw Error('synthetic outage');return ready();}},async()=>{
    assert.equal(document.querySelector('[role=alert]').textContent,'serverError.unavailable');
    assert.equal(document.querySelector('[aria-busy=true]'),null);
    assert.equal(document.querySelector('button').textContent,'trade.retry');
    await clickRetry();
    assert.equal(calls,2);assert.equal(document.querySelector('[role=alert]'),null);
    assert.equal(document.querySelector('[data-kyc-state]').getAttribute('data-kyc-state'),'NOT_STARTED');
    assert.ok(document.querySelector('form'));assert.equal(calls,2);
  });
});
// Only replace the KYC read's15s timer. Do not wait15s or intercept React timers.
async function withReadTimer(run) {
  const nativeSet=global.setTimeout,nativeClear=global.clearTimeout,pending=new Map();
  global.setTimeout=(fn,delay,...args)=>{if(delay!==15_000)return nativeSet(fn,delay,...args);const id={};pending.set(id,()=>fn(...args));return id;};
  global.clearTimeout=id=>{if(!pending.delete(id))nativeClear(id);};
  try{await run(pending);}finally{global.setTimeout=nativeSet;global.clearTimeout=nativeClear;}
}
test('stalled KYC read times out, shows retry and then recovers',async()=>{
  await withReadTimer(async pending=>{
    const signals=[];
    await withVerification({getMyKyc:signal=>{
      signals.push(signal);
      if(signals.length>1)return Promise.resolve(ready());
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')),{once:true}));
    }},async()=>{
      assert.ok(document.querySelector('[aria-busy=true]'));assert.equal(pending.size,1);
      await React.act(async()=>{[...pending.values()][0]();});
      assert.equal(signals[0].aborted,true);assert.equal(pending.size,0);
      assert.ok(document.querySelector('[role=alert]'));assert.equal(document.querySelector('[aria-busy=true]'),null);
      await clickRetry();
      assert.equal(signals.length,2);assert.equal(signals[1].aborted,false);
      assert.equal(document.querySelector('[role=alert]'),null);assert.ok(document.querySelector('form'));
      assert.equal(pending.size,0);
    });
  });
});
test('leaving verification aborts its pending read and clears its timeout',async()=>{
  await withReadTimer(async pending=>{
    let signal;
    await withVerification({getMyKyc:next=>{
      signal=next;
      return new Promise((_resolve,reject)=>next.addEventListener('abort',()=>reject(new DOMException('Unmounted','AbortError')),{once:true}));
    }},async()=>{
      assert.equal(signal.aborted,false);assert.equal(pending.size,1);
    });
    assert.equal(signal.aborted,true);assert.equal(pending.size,0);
  });
});
