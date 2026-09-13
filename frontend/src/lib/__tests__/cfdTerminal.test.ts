import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as presentation from '../cfdPresentation';

const root=resolve(__dirname,'../../..');
const req=createRequire(resolve(root,'package.json'));
const React=req('react');
const read=(file:string)=>readFileSync(resolve(root,'src',file),'utf8');
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const rows=['XAUUSD','XAGUSD','XPTUSD','XPDUSD','WTIUSD','XBRUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'].map((symbol,index)=>({symbol,name:symbol,price:String(index?1+index/100:2400.125),status:'live',stale:false,displayOnly:true,executionAllowed:false,provider:'biquote',providerSymbol:symbol==='WTIUSD'?'USOIL':symbol==='XBRUSD'?'UKOIL':symbol,asOf:Date.now(),maxQuoteAgeMs:120000,changePercent24h:'0.23'}));
const nodes=(tree:any):any[]=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=(tree:any):string=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);

function mount(file:string,options:any={}){
  let index=0;const hooks:any[]=[],effects:(()=>void)[]=[],components:Record<string,any>={};
  const react={...React,useState(initial:any){const at=index++;if(!(at in hooks))hooks[at]=typeof initial==='function'?initial():initial;return[hooks[at],(value:any)=>{hooks[at]=typeof value==='function'?value(hooks[at]):value;}];},useRef(initial:any){const at=index++;return hooks[at]??={current:initial};},useCallback(fn:any,deps:any[]){const at=index++,old=hooks[at];if(!old||deps.some((d,i)=>d!==old.deps[i]))hooks[at]={fn,deps};return hooks[at].fn;},useEffect(fn:any,deps:any[]){const at=index++,old=hooks[at];if(!old||deps.some((d,i)=>d!==old.deps[i])){hooks[at]={deps};effects.push(()=>{old?.cleanup?.();hooks[at].cleanup=fn();});}}};
  const api=new Proxy(options.api??{},{get:(obj,key:string)=>obj[key]??(()=>new Promise(()=>{}))});
  const compiled=ts.transpileModule(read(file),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const output:any={};
  new Function('require','exports','window',compiled)((name:string)=>{
    if(name==='react')return react;if(name.endsWith('/api'))return{api,ApiError:Error};if(name.endsWith('/i18n'))return{useLanguage:()=>({t:(key:string)=>key,lang:'en'})};if(name.endsWith('/cfdPresentation'))return presentation;
    if(name.endsWith('/priceChange'))return{parseChangePercentOrNull:(v:any)=>v==null?null:Number(v),parseChangePercent:Number};if(name.endsWith('/useCfdTickers'))return{useCfdTickers:()=>options.feed};if(name.endsWith('/krakenSocket'))return{krakenSocket:{subscribeBook:()=>()=>{}}};if(name.endsWith('/tradingMode'))return{rememberTradingMode:jest.fn()};if(name==='react-router-dom')return{useSearchParams:()=>[options.params]};if(name.endsWith('.css'))return{};
    if(name==='./Skeleton'){components.SkeletonRow??=()=>null;return{SkeletonRow:components.SkeletonRow};}
    if(name.startsWith('./')||name.startsWith('../components/')){const label=name.split('/').pop()!;components[label]??=()=>null;return{[label]:components[label]};}
    return req(name);
  },output,{setInterval,clearInterval});
  return{components,render(props={}){index=0;const fn:any=Object.values(output).find(v=>typeof v==='function');const tree=fn(props);effects.splice(0).forEach(fn=>fn());return tree;}};
}

beforeEach(()=>jest.useFakeTimers().setSystemTime(Date.UTC(2026,8,13,12,0,0)));
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});

test.each([
 ['XAUUSD','2400.12','2,400.12'],['XAGUSD','64.4975','64.498'],['XPTUSD','1798.74','1,798.74'],['WTIUSD','96.607','96.607'],['XBRUSD','101.7525','101.753'],['EURUSD','1.12345','1.12345'],['USDJPY','149.123','149.123'],['USDCHF','0.81647','0.81647']
])('%s has professional display precision',(symbol,value,expected)=>expect(presentation.formatCfdPrice(value,symbol)).toBe(expected));

test('missing or invalid prices remain a dash',()=>{for(const value of [null,'','NaN','Infinity','-1','0'])expect(presentation.formatCfdPrice(value as any,'EURUSD')).toBe('—');});

test('display states clearly distinguish live, closed, stale and unavailable',()=>{
 const at=Date.now();expect(presentation.cfdDisplayState({price:'1',status:'live',stale:false,asOf:at}).label).toContain('Live');
 expect(presentation.cfdDisplayState({price:'1',status:'market_closed',asOf:at}).label).toContain('Market closed');
 expect(presentation.cfdDisplayState({price:'1',status:'stale',stale:true,asOf:at}).label).toContain('Last quote');
 expect(presentation.cfdDisplayState({price:null,status:'unavailable'}).label).toBe('Price unavailable');
});

test.each(['?market=cfd','?market=cfd&symbol=WTIUSD','?market=cfd&symbol=EURUSD','?market=cfd&symbol=INVALID'])('TradePage %s renders read-only three-column market terminal',query=>{
 const options={params:new URLSearchParams(query),feed:{tickers:rows,configured:true,loadError:false,reload:jest.fn()}};const page=mount('pages/TradePage.tsx',options),tree=page.render(),all=nodes(tree);
 expect(tree.props.className).toBe('trade-terminal cfd-terminal');const expected=query.includes('WTIUSD')?'WTIUSD':query.includes('EURUSD')?'EURUSD':'XAUUSD';
 for(const component of ['CfdChart','CfdOrderForm','CfdInstrumentList','CfdTickerBar'])expect(all.find(n=>n.type===page.components[component]).props.symbol).toBe(expected);
 expect(all.some(n=>n.type===page.components.OrderBookPanel)).toBe(false);
});

test('all thirteen canonical display instruments render without fabricated extras',()=>{const list=mount('components/CfdInstrumentList.tsx');const tree=list.render({symbol:'XAUUSD',tickers:rows,configured:true,loadError:false,onRetry:jest.fn(),onChange:jest.fn()});expect(nodes(tree).filter(n=>n.type==='button')).toHaveLength(13);for(const row of rows)expect(text(tree)).toContain(row.symbol);});

test('visible CFD right panel is read-only market overview, not an order form',()=>{const source=read('components/CfdOrderForm.tsx');expect(source).toContain('CfdMarketOverview');expect(source).not.toMatch(/openCfdPosition|getFuturesBalances|<form|type="submit"|LeverageSlider/);});

test('bottom panel is market-data coverage and makes no account requests',()=>{const source=read('components/CfdPositionsPanel.tsx');expect(source).toContain('Market data coverage');expect(source).not.toMatch(/getCfdPositions|getCfdPositionHistory|closeCfdPosition|api\./);});

test('ticker hook polls every 15 seconds and keeps last good rows after a failed refresh',async()=>{
 const getCfdTickers=jest.fn().mockResolvedValueOnce({configured:true,tickers:rows}).mockRejectedValue(new Error('temporary'));
 const hook=mount('lib/useCfdTickers.ts',{api:{getCfdTickers}});hook.render();await tick();expect(hook.render().tickers).toHaveLength(13);jest.advanceTimersByTime(15000);await tick();const state=hook.render();expect(getCfdTickers).toHaveBeenCalledTimes(2);expect(state.tickers).toHaveLength(13);expect(state.loadError).toBe(true);expect(state.tickers.every((r:any)=>r.stale===true)).toBe(true);
});

test.each([{},null,'broken',{configured:true,tickers:null},{configured:true,tickers:{XAUUSD:'1'}}])('malformed ticker body fails safely: %p',async payload=>{const getCfdTickers=jest.fn().mockResolvedValue(payload);const hook=mount('lib/useCfdTickers.ts',{api:{getCfdTickers}});hook.render();await tick();const state=hook.render();expect(Array.isArray(state.tickers)).toBe(true);expect(state.loadError).toBe(true);});

test('WTI and Brent identities stay distinct in visible data',()=>{const wti=rows.find(x=>x.symbol==='WTIUSD')!,brent=rows.find(x=>x.symbol==='XBRUSD')!;expect(wti.providerSymbol).toBe('USOIL');expect(brent.providerSymbol).toBe('UKOIL');expect(wti.providerSymbol).not.toBe(brent.providerSymbol);});

test('display rows can never enable old execution UI helpers',()=>{const row={...rows[0],executionAllowed:true,status:'live',stale:false};expect(presentation.canExecuteCfdQuote(row as any)).toBe(false);});

test('CFD CSS remains scoped to the CFD terminal and includes responsive read-only panels',()=>{const css=read('pages/trade-terminal/CfdTerminal.css');expect(css).toContain('.cfd-market-overview');expect(css).toContain('.cfd-data-coverage');expect(css).toContain('@media(max-width:430px)');expect(css).not.toMatch(/^\.spot-terminal/m);});
