import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { depositMinimumEquivalent, validDepositConfig, type DepositConfig } from '../depositMinimum';

const root=resolve(__dirname,'../../../..');
const frontendRequire=createRequire(resolve(root,'frontend/package.json'));
const React=frontendRequire('react');
const {renderToStaticMarkup}=frontendRequire('react-dom/server');
const config:DepositConfig={minDepositUsd:300,usdPeggedAssets:['USDT','USDC','USD','DAI'],chains:[
  {chain:'tron',nativeAsset:'TRX',tokens:['USDT'],supportedAssets:['USDT']},
  {chain:'bitcoin',nativeAsset:'BTC',tokens:[],supportedAssets:['BTC']},
  {chain:'ethereum',nativeAsset:'ETH',tokens:[],supportedAssets:['ETH']},
]};
function compiled(file:string,requireFn:(id:string)=>any) {
  const code=ts.transpileModule(readFileSync(resolve(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{} as any};new Function('require','module','exports',code)(requireFn,module,module.exports);return module.exports;
}

test.each(['USDT','USDC','USD','DAI'])('%s uses backend-supplied minimum without a market quote',asset=>{
  expect(depositMinimumEquivalent(config,asset)).toBe(300);
  expect(depositMinimumEquivalent({...config,minDepositUsd:425},asset)).toBe(425);
});
test.each([['BTC','50000',0.006],['ETH','2500',0.12]])('%s equivalent uses live supplied price', (asset,price,expected)=>{
  expect(depositMinimumEquivalent(config,asset as string,price)).toBe(expected);
});
test.each([undefined,null,'','0','-1','bad','123garbage',Infinity])('unavailable/malformed price %p has no equivalent',price=>{
  expect(depositMinimumEquivalent(config,'BTC',price)).toBeNull();
});
test('malformed/missing backend policy is unavailable, never a default threshold',()=>{
  expect(validDepositConfig(config)).toBe(true);
  for(const value of [null,[],{}, {...config,minDepositUsd:'300'}, {...config,minDepositUsd:0},{...config,usdPeggedAssets:null}])expect(validDepositConfig(value)).toBe(false);
});

/** Effect harness runs the actual hook with controllable I/O and cleanup. */
function mountOptions(api:any) {
  const state:any[]=[];const effects:{deps:any[];cleanup?:()=>void}[]=[];
  let cursor=0,effectCursor=0,active=true;let scheduled:(()=>void)[]=[];
  const hooks={useState:(initial:any)=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;
    return[state[i],(next:any)=>{state[i]=typeof next==='function'?next(state[i]):next;}];},
    useEffect:(effect:()=>any,deps:any[])=>{const i=effectCursor++;const previous=effects[i];
      if(!previous||deps.some((v,j)=>v!==previous.deps[j]))scheduled.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:effect()};});}};
  const {useDepositOptions}=compiled('frontend/src/lib/useDepositOptions.ts',id=>id==='react'?hooks:id==='./api'?{api}:{depositMinimumEquivalent,validDepositConfig});
  const render=()=>{cursor=0;effectCursor=0;scheduled=[];const options=useDepositOptions(active);for(const run of scheduled)run();return options;};
  const settle=async()=>{let value;for(let i=0;i<12;i++){value=render();await Promise.resolve();}return value;};
  return {render,settle,active:(value:boolean)=>{active=value;},dispose:()=>effects.forEach(e=>e.cleanup?.())};
}
const mounted:ReturnType<typeof mountOptions>[]=[];
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>{mounted.splice(0).forEach(m=>m.dispose());jest.useRealTimers();});
function hook() {
  const api={getDepositConfig:jest.fn(async()=>config),getDepositAddress:jest.fn(async(chain:string)=>({chain,address:'fixture-'+chain,supportedAssets:config.chains.find(c=>c.chain===chain)!.supportedAssets})),
    getExternalTicker:jest.fn(async()=>({ticker:{lastPrice:'50000'}}))};
  const mount=mountOptions(api);mounted.push(mount);return{...mount,api};
}
test('both initial policy and stablecoin amount come from the backend; reopen refreshes changed minimum',async()=>{
  const m=hook();expect(m.render().minDepositUsd).toBeNull();let state=await m.settle();
  expect(state).toMatchObject({minDepositUsd:300,minEquivalent:300,asset:'USDT',stable:true});
  expect(m.api.getExternalTicker).not.toHaveBeenCalled();
  m.active(false);await m.settle();m.api.getDepositConfig.mockResolvedValue({...config,minDepositUsd:425});m.active(true);state=await m.settle();
  expect(state.minDepositUsd).toBe(425);expect(state.minEquivalent).toBe(425);
});
test('volatile asset gets real feed quote; outage retains USD minimum only',async()=>{
  const m=hook();let state=await m.settle();state.setChain('bitcoin');state=await m.settle();
  expect(m.api.getExternalTicker).toHaveBeenCalledWith('BTC/USDT');expect(state.minEquivalent).toBe(0.006);
  m.api.getExternalTicker.mockRejectedValue(new Error('down'));jest.advanceTimersByTime(30000);state=await m.settle();
  expect(state.minDepositUsd).toBe(300);expect(state.minEquivalent).toBeNull();
});
test('failed configuration never exposes an invented minimum or deposit destination',async()=>{
  const m=hook();m.api.getDepositConfig.mockRejectedValue(new Error('offline'));const state=await m.settle();
  expect(state).toMatchObject({minDepositUsd:null,address:null,chains:[],error:'chains'});expect(m.api.getDepositAddress).not.toHaveBeenCalled();
});
test('late address response from previous network cannot overwrite the selected network',async()=>{
  const m=hook();let state=await m.settle();let release!:(v:any)=>void;
  m.api.getDepositAddress.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  state.setChain('bitcoin');await m.settle();state=m.render();state.setChain('ethereum');await m.settle();
  release({chain:'bitcoin',address:'late-fixture',supportedAssets:['BTC']});state=await m.settle();
  expect(state.chain).toBe('ethereum');expect(state.asset).toBe('ETH');expect(state.address).toBe('fixture-ethereum');
});
test('unimplemented native Tron asset from malformed address response is not offered',async()=>{
  const m=hook();m.api.getDepositAddress.mockResolvedValue({chain:'tron',address:'fixture',supportedAssets:['TRX','USDT']});
  const state=await m.settle();expect(state).toMatchObject({address:null,assets:[],error:'address'});
});
test('closed form performs no requests and removes volatile quote polling',async()=>{
  const m=hook();m.active(false);await m.settle();expect(m.api.getDepositConfig).not.toHaveBeenCalled();
  m.active(true);let state=await m.settle();state.setChain('bitcoin');await m.settle();expect(jest.getTimerCount()).toBe(1);
  m.active(false);await m.settle();expect(jest.getTimerCount()).toBe(0);
});

const t=(key:string,p:any={})=>key==='deposit.minAmountEquivalent'?`Minimum deposit: $${p.amount} ≈ ${p.equivalent} ${p.asset}`
  :key==='deposit.minAmountHint'?`Minimum deposit: $${p.amount}`:key==='trade.loading'?'Loading':key;
function renderModal(wallet:boolean,minimum:number|null,asset='USDT',equivalent:number|null=minimum) {
  const options={chains:config.chains,chainsLoaded:true,chain:asset==='USDT'?'tron':'bitcoin',setChain:()=>{},address:'fixture',
    assets:[asset],asset,setAsset:()=>{},error:null,minDepositUsd:minimum,minEquivalent:equivalent,stable:asset==='USDT'};
  const requireFn=(id:string):any=>id.includes('useDepositOptions')?{useDepositOptions:()=>options}
    :id.includes('i18n')?{useLanguage:()=>({t,lang:'en'}),localeOf:()=> 'en-US'}
    :id==='./format'?compiled('frontend/src/pages/wallet-v3/format.ts',requireFn)
    :id==='./ui'?{Modal:({children}:any)=>React.createElement('section',null,children),FieldLabel:({children}:any)=>React.createElement('label',null,children),
      SecondaryButton:({children}:any)=>React.createElement('button',null,children),Select:({options,value}:any)=>React.createElement('select',{value,onChange:()=>{}},options.map((o:any)=>React.createElement('option',{value:o.value,key:o.value},o.label)))}
    :frontendRequire(id);
  const file=wallet?'frontend/src/pages/wallet-v3/DepositModal.tsx':'frontend/src/components/DepositModal.tsx';
  const {DepositModal}=compiled(file,requireFn);return renderToStaticMarkup(React.createElement(DepositModal,{open:true,onClose:()=>{}}));
}
describe.each([false,true])('actual deposit JSX wallet=%s',wallet=>{
  test('backend minimum displays with USDT; no native TRX choice',()=>{
    const html=renderModal(wallet,300);expect(html).toContain('$300');expect(html).toContain('USDT');expect(html).not.toContain('>TRX<');
    expect(renderModal(wallet,425)).toContain('$425');
  });
  test('BTC displays the supplied equivalent, price unavailable omits it',()=>{
    expect(renderModal(wallet,300,'BTC',0.006)).toContain('$300 ≈ 0.006 BTC');
    const html=renderModal(wallet,300,'BTC',null);expect(html).toContain('$300');expect(html).not.toContain('≈');
  });
  test('unloaded config does not fabricate either old or new threshold',()=>{
    const html=renderModal(wallet,null);expect(html).not.toMatch(/\$(300|1,?000)/);
    const source=readFileSync(resolve(root,wallet?'frontend/src/pages/wallet-v3/DepositModal.tsx':'frontend/src/components/DepositModal.tsx'),'utf8');
    expect(source).toContain('useDepositOptions(');expect(source).not.toMatch(/\b(1000|300)\b/);
  });
});
