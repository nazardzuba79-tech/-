// Focused DOM unit test of the ACTUAL dialog, selection hook, QR encoder,
// minimum display and clipboard handlers. No browser/production write claim.
// Optional input is an already-read public catalogue, never credentials.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ts=require('typescript');
const frontend=path.resolve(__dirname,'../../frontend');
const rf=require('node:module').createRequire(path.join(frontend,'package.json'));
const React=rf('react'),{createRoot}=rf('react-dom/client'),{JSDOM}=rf('jsdom');
function load(source,imports={}){
  const out={};const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',code)(name=>{if(name==='react')return React;if(name==='react/jsx-runtime')return rf(name);if(!(name in imports))throw Error('Unexpected QA import '+name);return imports[name];},out);return out;
}
const read=p=>fs.readFileSync(path.join(frontend,'src',p),'utf8');
test('every configured destination preserves address, QR payload, clipboard, minimum and memo',async t=>{
  const real=process.env.VOLTEX_PUBLIC_CATALOGUE_QA_INPUT;
  const entries=real?JSON.parse(fs.readFileSync(real,'utf8')).entries:[{assetId:'tether',asset:'USDT',networkId:'tron',networkName:'TRON',standard:'TRC-20',address:'synthetic-address-not-payable',enabled:true}];
  assert.ok(entries.length>0);assert.ok(entries.every(e=>e.enabled&&typeof e.address==='string'&&e.address));
  const wallets=entries.map(e=>({chain:`${e.assetId}:${e.networkId}`,assets:[e.asset],address:e.address,networkName:e.networkName,standard:e.standard,memo:e.memo,memoLabel:e.memoLabel}));
  // The live catalogue has no memo. Exercise the existing memo branch with
  // a visibly synthetic additional entry; never change a real destination.
  wallets.push({chain:'synthetic:memo',assets:['QA'],address:'synthetic-memo-address-not-payable',networkName:'SYNTHETIC',memo:'synthetic-tag-123',memoLabel:'Memo / Tag'});
  const dom=new JSDOM('<div id="root"></div>',{url:'https://ru.example.invalid',pretendToBeVisual:true});
  const prior={window:global.window,document:global.document,fetch:global.fetch};
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(global,'navigator');
  global.window=dom.window;global.document=dom.window.document;
  Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
  global.IS_REACT_ACT_ENVIRONMENT=true;
  let copied=null,networkRequests=0;const notes=[];
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async value=>{copied=value;}}});
  global.fetch=async()=>{networkRequests++;throw Error('No external HTTP allowed');};
  const selectionSource=read('lib/useDepositOptions.ts').slice(read('lib/useDepositOptions.ts').indexOf('export function useDepositSelection'));
  const {useDepositSelection}=load("import {useMemo,useState} from 'react';\n"+selectionSource);
  const {depositMinimumView}=load(read('lib/depositMinimum.ts'));
  const {orderDepositDestinations}=load(read('lib/depositOrder.ts'));
  const {RU}=load(read('lib/i18n/locales/ru.ts'));
  const {depositAssetMetadata}=load(read('lib/depositAssetMetadata.ts'));
  let selection;
  const qr=rf('qrcode');
  const nil=()=>null;
  const imports={
    'react-dom':rf('react-dom'),'lucide-react':new Proxy({},{get:()=>nil}),qrcode:qr,
    '../lib/i18n':{localeOf:()=> 'ru-RU',useLanguage:()=>({lang:'ru',t:(key,values={})=>Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),RU[key]??key)})},
    '../lib/useDepositOptions':{useDepositWallets:()=>({loaded:true,wallets,error:null}),useDepositSelection:(...args)=>(selection=useDepositSelection(...args))},
    '../lib/api':{getToken:()=> 'synthetic-test-session'},'./CryptoIcon':{CryptoIcon:nil},
    '../lib/depositAssetMetadata':{depositAssetMetadata},'../lib/depositMinimum':{depositMinimumView},
    '../lib/marketDataStore':{marketDataStore:{getState:()=>({tickers:new Map(),tickersMeta:null})}},
    '../lib/depositOrder':{orderDepositDestinations},'../lib/depositCopyLog':{reportDepositAddressCopy:value=>notes.push(value)},
    './DepositCatalogueDialog.css':{},
  };
  const {DepositCatalogueDialog}=load(read('components/DepositCatalogueDialog.tsx'),imports);
  const root=createRoot(document.getElementById('root'));
  const click=async el=>React.act(async()=>el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  try{
    await React.act(async()=>root.render(React.createElement(DepositCatalogueDialog,{onClose:()=>{}})));
    for(const wallet of wallets){
      await React.act(async()=>{selection.setAsset(wallet.assets[0]);selection.setChain(wallet.chain);});
      assert.ok(document.querySelector('[data-testid=deposit-address]').textContent===wallet.address,'Rendered address differs from source');
      assert.match(document.querySelector('[data-testid=deposit-minimum]').textContent,/500/);
      const toggle=document.querySelector('.dc-qr-button');if(toggle.getAttribute('aria-expanded')!=='true')await click(toggle);
      const modules=qr.create(wallet.address,{errorCorrectionLevel:'M'}).modules;
      const expected=Array.from(modules.data).flatMap((bit,i)=>bit?[`M${i%modules.size+4},${Math.floor(i/modules.size)+4}h1v1h-1z`]:[]).join('');
      assert.ok(document.querySelector('.dc-qr path').getAttribute('d')===expected,'QR differs from displayed destination');
      await click(document.querySelector('.dc-copy-row .dc-primary'));
      assert.ok(copied===wallet.address,'Clipboard differs from destination');
      assert.ok(notes.at(-1).address===wallet.address,'Copy note differs from destination');
      if(wallet.memo){await click(document.querySelector('.dc-memo button'));assert.ok(copied===wallet.memo,'Memo clipboard differs');}
      else assert.equal(document.querySelector('.dc-memo'),null);
    }
    assert.equal(networkRequests,0);assert.equal(notes.length,wallets.length);
    t.diagnostic(JSON.stringify({source:real?'already-read public catalogue':'synthetic fixture',configuredDestinations:entries.length,syntheticMemoBranches:1,externalRequests:0}));
  }finally{
    await React.act(async()=>root.unmount());dom.window.close();Object.assign(global,prior);
    if(navigatorDescriptor)Object.defineProperty(global,'navigator',navigatorDescriptor);else delete global.navigator;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
