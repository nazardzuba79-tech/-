// Actual VerificationSection loading/retry hooks, synthetic API only. Child
// presentation components are inert; this is a DOM unit test, not browser QA.
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
test('network failure renders an alert and retry recovers without sending KYC',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://ru.example.invalid'});
  const before={window:global.window,document:global.document};
  global.window=dom.window;global.document=dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT=true;
  let calls=0;
  const api={getMyKyc:async()=>{calls++;if(calls===1)throw Error('synthetic outage');return {kycStatus:'NOT_STARTED',latestSubmission:null};}};
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
    assert.equal(document.querySelector('[role=alert]').textContent,'serverError.unavailable');
    assert.equal(document.querySelector('[aria-busy=true]'),null);
    const retry=document.querySelector('button');assert.equal(retry.textContent,'trade.retry');
    await React.act(async()=>{retry.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});
    assert.equal(calls,2);assert.equal(document.querySelector('[role=alert]'),null);
    assert.equal(document.querySelector('[data-kyc-state]').getAttribute('data-kyc-state'),'NOT_STARTED');
    assert.ok(document.querySelector('form'));assert.equal(calls,2);
  }finally{await React.act(async()=>root.unmount());dom.window.close();Object.assign(global,before);delete global.IS_REACT_ACT_ENVIRONMENT;}
});
