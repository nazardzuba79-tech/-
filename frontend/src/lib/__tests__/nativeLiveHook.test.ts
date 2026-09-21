import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { NativeCommandLane,acceptsRevision } from '../nativeCommandLane';
import { compactNativeUiState,shouldPollNativeLive,NATIVE_LIVE_POLL_MS } from '../nativeLivePolicy';
import { chartExits } from '../nativeChartExits';

const frontend=resolve(__dirname,'../../..'),req=createRequire(resolve(frontend,'package.json'));
const React=req('react'),{createRoot}=req('react-dom/client'),{JSDOM}=req('jsdom');
function load(file:string,imports:Record<string,unknown>){
  const out:any={},source=readFileSync(resolve(frontend,'src',file),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',code)((name:string)=>name in imports?imports[name]:req(name),out);return out;
}
class TestError extends Error {constructor(message:string,public status:number,public code?:string){super(message);}}
const initial=()=>({initialized:true,revision:7,source:'DEMO_BALANCE',asOf:1,model:{version:'test'},account:null,ledger:null,
  positions:[{id:'p',symbol:'BTCUSDT',status:'OPEN',protection:{takeProfit:null,stopLoss:null}}],orders:[],history:[],events:[],entries:[]});
describe('actual React native hook live lifecycle',()=>{
  let dom:any,root:any,current:any,state:any,api:any,offSession:()=>void;
  beforeEach(async()=>{
    jest.useFakeTimers();dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
    state=initial();api={access:jest.fn(async()=>({allowed:true,nativeAvailable:true,simulationOnly:true})),activate:jest.fn(async()=>({ok:true})),
      live:jest.fn(async()=>structuredClone(state)),command:jest.fn(async()=>structuredClone(state)),history:jest.fn(async()=>({items:[],nextCursor:null})),getCard:jest.fn()};
    const history=load('pages/private-trading/useNativeHistory.ts',{react:React,'../../lib/nativeDemoApi':{nativeDemoApi:api}});
    const module=load('pages/private-trading/useNativeDemo.tsx',{
      react:React,'react-router-dom':{useSearchParams:()=>[new URLSearchParams()]},
      '../../lib/api':{getToken:()=>`x.${Buffer.from(JSON.stringify({sub:'qa',sid:'session'})).toString('base64url')}.x`,onSessionChange:(fn:()=>void)=>{offSession=fn;return()=>{};}},
      '../../lib/nativeDemoApi':{nativeDemoApi:api},'../../lib/privateTradingApi':{PrivateTradingError:TestError,privateErrorText:(e:Error)=>e.message,privateTradingApi:{}},
      '../../lib/nativeCommandLane':{NativeCommandLane,acceptsRevision},'../../lib/nativeChartExits':{chartExits},
      '../../lib/nativeLivePolicy':{compactNativeUiState,shouldPollNativeLive,NATIVE_LIVE_POLL_MS},'./useNativeHistory':history,
    });
    function Harness(){current=module.useNativeDemo('BTC/USDT');return null;}
    root=createRoot(document.getElementById('root'));
    await React.act(async()=>{root.render(React.createElement(Harness));});
  });
  afterEach(async()=>{await React.act(async()=>root.unmount());dom.window.close();jest.useRealTimers();delete (globalThis as any).window;delete (globalThis as any).document;delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;});
  const tick=(ms:number)=>React.act(async()=>{jest.advanceTimersByTime(ms);});
  test('active 30s GET; hidden no GET; visibility return refresh; ACCESS remains 15s',async()=>{
    expect(api.live).toHaveBeenCalledTimes(1);expect(api.access).toHaveBeenCalledTimes(1);expect(api.history).not.toHaveBeenCalled();
    await tick(30_000);expect(api.live).toHaveBeenCalledTimes(2);expect(api.access).toHaveBeenCalledTimes(3);expect(api.command).not.toHaveBeenCalled();
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    await tick(60_000);expect(api.live).toHaveBeenCalledTimes(2);expect(api.access).toHaveBeenCalledTimes(7);
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    await React.act(async()=>document.dispatchEvent(new dom.window.Event('visibilitychange')));
    expect(api.live).toHaveBeenCalledTimes(3);expect(api.activate).toHaveBeenCalledTimes(2);
  });
  test('after final close, idle account makes no periodic reads; explicit refresh still works',async()=>{
    state={...state,revision:8,positions:[]};
    await React.act(async()=>{await current.execute({kind:'CLOSE',positionId:'p'});});
    const reads=api.live.mock.calls.length;await tick(120_000);expect(api.live).toHaveBeenCalledTimes(reads);
    await React.act(async()=>{await current.run({kind:'REFRESH'});});expect(api.live).toHaveBeenCalledTimes(reads+1);
    expect(api.command).toHaveBeenCalledTimes(1);expect(current.state.positions).toEqual([]);
  });
  test('history lazy until tab demand, stable across same-revision mark refresh',async()=>{
    await React.act(async()=>{current.setHistoryDemand({positions:true,orders:false,chart:false});});
    expect(api.history).toHaveBeenCalledTimes(1);expect(api.history.mock.calls[0].slice(0,2)).toEqual(['positions',7]);
    await tick(30_000);expect(api.history).toHaveBeenCalledTimes(1);
  });
  test('unrelated local UI renders preserve chart interaction; live and selection changes still update it',async()=>{
    const before=current.interaction,trade=before.trades[0];
    await React.act(async()=>current.setDialog({kind:'leverage',position:state.positions[0]}));
    expect(current.interaction).toBe(before);
    await React.act(async()=>current.setDialog(null));
    expect(current.interaction).toBe(before);
    state={...state,positions:[{...state.positions[0],unrealizedPnl:'123',markPrice:'50500'}]};
    await tick(30_000);
    expect(current.interaction).not.toBe(before);
    expect(current.interaction.trades[0]).toMatchObject({id:trade.id,pnl:123});
    // The memoized close callback must see the NEW authoritative position.
    await React.act(async()=>current.interaction.onTradeClose('p'));
    expect(current.dialog.position.markPrice).toBe('50500');
    await React.act(async()=>current.interaction.onSelectionModeChange('entry'));
    expect(current.interaction.selecting).toBe('entry');
    await React.act(async()=>current.interaction.onCancelSelection());
    expect(current.interaction.selecting).toBe(null);
    expect(api.history).not.toHaveBeenCalled();expect(api.command).not.toHaveBeenCalled();
  });
  test('chart history is selected-symbol only, exhausts pages, and keeps entry metadata',async()=>{
    api.history.mockImplementation(async(kind:string,_revision:number,options:any)=>({items:kind==='entries'?[{positionId:'p',candle:{openTime:123,interval:'15',pricePoint:'OPEN'}}]:[],nextCursor:kind==='events'&&!options.cursor?'page2':null}));
    await React.act(async()=>{current.setHistoryDemand({positions:false,orders:false,chart:true});});
    expect(api.history.mock.calls.map((c:any[])=>c[0])).toEqual(['positions','events','events','entries']);
    expect(api.history.mock.calls.every((c:any[])=>c[1]===7&&c[2].symbol==='BTCUSDT')).toBe(true);
    expect(current.interaction.trades[0]).toMatchObject({id:'p',entryCandleOpenTime:123,entryInterval:'15',entryModel:'OPEN'});
    await tick(30_000);expect(api.history).toHaveBeenCalledTimes(4);
  });
});
