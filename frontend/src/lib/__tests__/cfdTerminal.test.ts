import * as browserActivity from '../browserActivity';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as presentation from '../cfdPresentation';
import * as columnSort from '../marketColumnSort';
// The real freshness rules, not a stub: the page's refresh cadence is read
// from them, and a stub would let the two drift apart.
import * as bookFreshness from '../bookFreshness';
// Real too: TradePage asks it whether the pair is a VOLTEX test market.
import * as testMarkets from '../testMarkets';
// The CFD workspace (2026-10-15): the asset registry and the strip's own day-change model, real.
import * as assetIdentity from '../cfdAssetIdentity';
import * as infoStrip from '../cfdInfoStrip';

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
  const react={...React,useMemo:(fn:any)=>fn(),useState(initial:any){const at=index++;if(!(at in hooks))hooks[at]=typeof initial==='function'?initial():initial;return[hooks[at],(value:any)=>{hooks[at]=typeof value==='function'?value(hooks[at]):value;}];},useRef(initial:any){const at=index++;return hooks[at]??={current:initial};},useCallback(fn:any,deps:any[]){const at=index++,old=hooks[at];if(!old||deps.some((d,i)=>d!==old.deps[i]))hooks[at]={fn,deps};return hooks[at].fn;},useEffect(fn:any,deps:any[]){const at=index++,old=hooks[at];if(!old||deps.some((d,i)=>d!==old.deps[i])){hooks[at]={deps};effects.push(()=>{old?.cleanup?.();hooks[at].cleanup=fn();});}}};
  const api=new Proxy(options.api??{},{get:(obj,key:string)=>obj[key]??(()=>new Promise(()=>{}))});
  const compiled=ts.transpileModule(read(file),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const output:any={};
  new Function('require','exports','window','document',compiled)((name:string)=>{
    if(name.endsWith('/browserActivity')) return browserActivity;
    if(name.endsWith('/useCompactAccountPanel')){
      const module:any={};const code=ts.transpileModule(read('lib/useCompactAccountPanel.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      new Function('require','exports',code)(()=>react,module);return module;
    }
    if(name.endsWith('/displaySnapshotCache'))return{displayRefreshDelay:()=>6*60*60*1000,SLOW_DISPLAY_REFRESH_MS:6*60*60*1000,readDisplayJson:(url:string)=>options.readDisplayJson?options.readDisplayJson(url):api.getCfdTickers()};
    if(name==='react')return react;if(name.endsWith('/marketColumnSort'))return columnSort;if(name.endsWith('/api'))return{api,ApiError:Error,API_BASE:'/api/v1'};if(name.endsWith('/i18n'))return{useLanguage:()=>({t:(key:string)=>key,lang:'en'})};if(name.endsWith('/cfdPresentation'))return presentation;
    if(name.endsWith('/priceChange'))return{parseChangePercentOrNull:(v:any)=>v==null?null:Number(v),parseChangePercent:Number};if(name.endsWith('/useCfdTickers'))return{useCfdTickers:()=>options.feed};if(name.endsWith('/krakenSocket'))return{krakenSocket:{subscribeBook:()=>()=>{}}};if(name.endsWith('/bookFreshness'))return bookFreshness;if(name.endsWith('/tradingMode'))return{rememberTradingMode:jest.fn()};if(name==='react-router-dom')return{useSearchParams:()=>[options.params]};if(name.endsWith('/TerminalMarketSwitch'))return{TerminalMarketSwitch:()=>null};if(name==='../lib/terminalMarketSwitch')return jest.requireActual('../terminalMarketSwitch');if(name.endsWith('.css'))return{};
    if(name==='./Skeleton'){components.SkeletonRow??=()=>null;return{SkeletonRow:components.SkeletonRow};}
    if(name.startsWith('./')||name.startsWith('../components/')){const label=name.split('/').pop()!;components[label]??=()=>null;return{[label]:components[label]};}
    if(name.endsWith('/sampledDepth'))return{readSpotDisplayBook:()=>Promise.resolve({bids:[],asks:[],asOf:null})};
    if(name.endsWith('/spotPublicMarket'))return{readSpotPublicBook:()=>Promise.resolve({bids:[],asks:[],asOf:null})};
    if(name.endsWith('/testMarkets'))return testMarkets;
    if(name.endsWith('/testMarketStore'))return{useTestMarket:()=>({asset:null,loaded:false,error:false,clockOffsetMs:0}),useManagedListingDiscovery:()=>({assets:[],loaded:false,error:false,clockOffsetMs:0}),TEST_MARKET_TERMINAL_INTERVAL_MS:5000};
    if(name.endsWith('/useMarketData'))return{useMarketData:()=>({tickers:new Map(),loaded:false,status:'idle'})};
    if(name.endsWith('/nrxMarket'))return{isEdgeMarketPair:()=>false,isNrxPair:()=>false};
    if(name.endsWith('/cfdAssetIdentity'))return assetIdentity;
    if(name.endsWith('/cfdInfoStrip'))return infoStrip;
    if(name.endsWith('/useCfdDailySeries'))return{useCfdDailySeries:()=>options.daily??new Map()};
    if(name.endsWith('/useCfdPracticePositions'))return{useCfdPracticePositionLines:()=>[]};
    return req(name);
  },output,{setInterval,clearInterval,setTimeout,clearTimeout,location:options.location},{hidden:false,addEventListener:jest.fn(),removeEventListener:jest.fn()});
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

test.each(['?market=cfd','?market=cfd&symbol=WTIUSD','?market=cfd&symbol=EURUSD','?market=cfd&symbol=INVALID'])('TradePage %s renders interactive three-column CFD terminal',query=>{
 const options={params:new URLSearchParams(query),feed:{tickers:rows,configured:true,loadError:false,reload:jest.fn()}};const page=mount('pages/TradePage.tsx',options),tree=page.render(),all=nodes(tree);
 expect(tree.props.className).toBe('trade-terminal cfd-terminal market-reference terminal-studio vx-terminal');const expected=query.includes('WTIUSD')?'WTIUSD':query.includes('EURUSD')?'EURUSD':'XAUUSD';
 for(const component of ['CfdOrderForm','CfdInstrumentList','CfdTickerBar'])expect(all.find(n=>n.type===page.components[component]).props.symbol).toBe(expected);
 // Chart Workspace 2.0 (2026-10-15): the Spot/Futures terminal chart with the CFD market, not the old CfdChart.
 const chart=all.find(n=>n.type===page.components.TerminalChart);expect(chart.props.pair).toBe(expected);expect(chart.props.market).toBe('cfd');expect(chart.props.drawingTools).toBe(true);
 expect(all.some(n=>n.type===page.components.CfdChart)).toBe(false);
 expect(all.some(n=>n.type===page.components.OrderBookPanel)).toBe(false);
});

test('all thirteen canonical display instruments render without fabricated extras',()=>{const list=mount('components/CfdInstrumentList.tsx');const tree=list.render({symbol:'XAUUSD',tickers:rows,configured:true,loadError:false,onRetry:jest.fn(),onChange:jest.fn()});expect(nodes(tree).filter(n=>n.type==='button'&&n.props.className?.includes('cfd-option'))).toHaveLength(13);for(const row of rows)expect(text(tree)).toContain(row.symbol);});

// 2026-10-15: the marks come from one registry (lib/cfdAssetIdentity): issuer flags for a currency pair
// (flag-icons, MIT, bundled — a few hundred bytes each, inlined by the build), the element symbol for a
// metal, the benchmark for oil. Still no remote host, no CDN, no provider icon and no per-row request.
test('CFD instrument marks are bundled local assets with zero remote requests',()=>{
 const icon=read('components/CfdInstrumentIcon.tsx'),iconCss=read('components/CfdInstrumentIcon.css');
 const list=read('components/CfdInstrumentList.tsx'),markets=read('components/CfdMarketsSection.tsx');
 expect(icon).toContain('<svg');expect(icon).not.toMatch(/https?:\/\//);
 for(const flag of ['eu','us','gb','jp','au','ca','ch','nz']){expect(icon).toContain(`import ${flag} from '../assets/cfd-flags/${flag}.svg'`);expect(readFileSync(resolve(root,'src/assets/cfd-flags',`${flag}.svg`),'utf8')).toMatch(/^<svg[^>]*viewBox="0 0 512 512"/);}
 expect(readFileSync(resolve(root,'src/assets/cfd-flags/LICENSE-flag-icons.txt'),'utf8')).toContain('The MIT License');
 expect(icon).toContain('onError');expect(icon).toContain('cfd-flag-fallback');
 expect(icon).toContain("import './CfdInstrumentIcon.css'");
 expect(list).toContain("import { CfdInstrumentIcon } from './CfdInstrumentIcon'");
 expect(list).toContain('<CfdInstrumentIcon symbol={tk.symbol}/>');
 expect(markets).toContain("import { CfdInstrumentIcon } from './CfdInstrumentIcon'");
 expect(markets).toContain('<CfdInstrumentIcon symbol={tk.symbol} compact/>');
 expect(list).not.toContain('CFD_ICON_BY_SYMBOL');
 for(const symbol of ['XAUUSD','XAGUSD','XPTUSD','XPDUSD','WTIUSD','XBRUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'])
   expect(assetIdentity.cfdAsset(symbol)?.symbol).toBe(symbol);
 for(const symbol of ['XAUUSD','XAGUSD','XPTUSD','XPDUSD','XBRUSD'])expect(iconCss).toContain(`.cfd-instrumentIcon-${symbol}`);
 expect(assetIdentity.CFD_ASSETS.filter(a=>a.assetClass==='metals').map(a=>a.mark)).toEqual(['Au','Ag','Pt','Pd']);
 for(const asset of assetIdentity.CFD_ASSETS.filter(a=>a.assetClass==='forex'))for(const code of [asset.base,asset.quote])expect(assetIdentity.isCfdCurrency(code)).toBe(true);
 expect(iconCss).toContain('radial-gradient');
 expect(iconCss).toContain('.cfd-instrumentIcon--compact');
});

test('visible CFD right panel is a functional local practice order ticket',()=>{
 const source=read('components/CfdOrderForm.tsx');
 expect(source).toContain('openCfdPaperPosition');expect(source).toContain('<form');expect(source).toContain('type="submit"');expect(source).toContain('LeverageSlider');
 expect(source).not.toMatch(/api\.openCfdPosition|getFuturesBalances|openCfdPosition\(/);
});

test('bottom panel provides local practice positions and history without account requests',()=>{
 const source=read('components/CfdPositionsPanel.tsx');
 expect(source).toContain('closeCfdPaperPosition');expect(source).toContain('useCfdTickers');expect(source).toContain("type Tab='open'|'history'");
 expect(source).not.toMatch(/getCfdPositions|getCfdPositionHistory|api\.closeCfdPosition|api\.getFuturesBalances/);
});

// 2026-10-15: CfdChart is gone; the CFD chart is the workspace chart, and its candles come from
// lib/cfdCandles — the same display route, the same six-hour snapshot cache, the edge in production.
test('CFD candles read the display route through the snapshot cache, and production never falls back to Render',()=>{
 const source=read('lib/cfdCandles.ts');
 expect(source).toContain('/cfd/display/candles/');expect(source).toContain('MARKET_EDGE_BASE');
 expect(source).toContain('readDisplayJson(cfdCandleUrl(');expect(source).toContain('SLOW_DISPLAY_REFRESH_MS');
 expect(source).not.toContain('fallbackUrl');expect(source).not.toContain('bounded Render');
 expect(existsSync(resolve(root,'src/components/CfdChart.tsx'))).toBe(false);
});

test('production CFD ticker feed reads one Cloudflare snapshot and never Render',async()=>{
 const reads=jest.fn(async()=>({configured:true,tickers:rows}));
 const hook=mount('lib/useCfdTickers.ts',{location:{hostname:'voltextech.net'},readDisplayJson:reads});
 hook.render(true);await tick();const state=hook.render(true);
 expect(reads).toHaveBeenCalledTimes(1);
 expect((reads.mock.calls as any)[0][0]).toBe('https://market.voltextech.net/cfd/display/tickers?v=9');
 expect(state.tickers).toHaveLength(13);expect(state.loadError).toBe(false);
 const source=read('lib/useCfdTickers.ts');
 expect(source).not.toContain('fallbackEndpoint');expect(source).not.toContain('fillMissingQuotes');
});

test('ticker hook samples every six hours and keeps last good rows after a failed refresh',async()=>{
 const getCfdTickers=jest.fn().mockResolvedValueOnce({configured:true,tickers:rows}).mockRejectedValue(new Error('temporary'));
 const hook=mount('lib/useCfdTickers.ts',{api:{getCfdTickers}});hook.render(true);await tick();expect(hook.render(true).tickers).toHaveLength(13);jest.advanceTimersByTime(6*60*60*1000-1);await tick();expect(getCfdTickers).toHaveBeenCalledTimes(1);jest.advanceTimersByTime(1);await tick();const state=hook.render(true);expect(getCfdTickers).toHaveBeenCalledTimes(2);expect(state.tickers).toHaveLength(13);expect(state.loadError).toBe(true);expect(state.tickers.every((r:any)=>r.stale===true)).toBe(true);
});

test.each([{},null,'broken',{configured:true,tickers:null},{configured:true,tickers:{XAUUSD:'1'}}])('malformed ticker body fails safely: %p',async payload=>{const getCfdTickers=jest.fn().mockResolvedValue(payload);const hook=mount('lib/useCfdTickers.ts',{api:{getCfdTickers}});hook.render(true);await tick();const state=hook.render(true);expect(Array.isArray(state.tickers)).toBe(true);expect(state.loadError).toBe(true);});

test('WTI and Brent identities stay distinct in visible data',()=>{const wti=rows.find(x=>x.symbol==='WTIUSD')!,brent=rows.find(x=>x.symbol==='XBRUSD')!;expect(wti.providerSymbol).toBe('USOIL');expect(brent.providerSymbol).toBe('UKOIL');expect(wti.providerSymbol).not.toBe(brent.providerSymbol);});

test('display rows can never enable old execution UI helpers',()=>{const row={...rows[0],executionAllowed:true,status:'live',stale:false};expect(presentation.canExecuteCfdQuote(row as any)).toBe(false);});

test('CFD practice CSS remains scoped and responsive',()=>{const css=read('pages/trade-terminal/CfdPractice.css');expect(css).toContain('.cfd-order-panel');expect(css).not.toContain('.cfd-owned-chart');expect(css).toContain('.cfd-bottom-panel');expect(css).toContain('@media(max-width:430px)');expect(css).not.toMatch(/^\.spot-terminal/m);});

test.each([0,1])('CFD column %s sorts both ways, leaves missing data last and restores provider order without selecting',column=>{
  // 2026-10-15: the change column is the strip's own figure — the price against the previous
  // session's close from each instrument's daily bars — not the provider's changePercent24h.
  const asOf=Date.UTC(2026,8,15,12,0,0),day=Date.UTC(2026,8,15),bars=(prev:number)=>[{openTime:day-86400000,open:prev,high:prev,low:prev,close:prev,isOpen:false},{openTime:day,open:prev,high:prev*1.02,low:prev*.98,close:prev,isOpen:true}];
  const daily=new Map([['XAUUSD',bars(100/0.99)],['XAGUSD',bars(200)]]);
  const list=mount('components/CfdInstrumentList.tsx',{daily}),onChange=jest.fn();
  const data=[{...rows[0],price:'100',asOf,changePercent24h:'5'},{...rows[1],price:'200',asOf,changePercent24h:'-5'},{...rows[2],price:null,asOf,changePercent24h:undefined}];
  const props={symbol:'XAUUSD',tickers:data,configured:true,loadError:false,onRetry:jest.fn(),onChange};
  const options=(tree:any)=>nodes(tree).filter(n=>n.type==='button'&&n.props.className?.includes('cfd-option')).map(n=>n.key);
  let tree=list.render(props);expect(options(tree)).toEqual(['XAUUSD','XAGUSD','XPTUSD']);
  const click=()=>{nodes(tree).filter(n=>n.type==='button'&&n.props.className==='cfd-align-right')[column].props.onClick();tree=list.render(props);};
  click();expect(options(tree)).toEqual(['XAGUSD','XAUUSD','XPTUSD']);
  click();expect(options(tree)).toEqual(['XAUUSD','XAGUSD','XPTUSD']);
  click();expect(options(tree)).toEqual(['XAUUSD','XAGUSD','XPTUSD']);
  expect(onChange).not.toHaveBeenCalled();expect(data[0].symbol).toBe('XAUUSD');
});
test('CFD search matches names and symbols and does not create instruments',()=>{
  const list=mount('components/CfdInstrumentList.tsx');
  const props={symbol:'XAUUSD',tickers:[{...rows[0],name:'Gold'},{...rows[4],name:'WTI Oil'}],configured:true,loadError:false,onRetry:jest.fn(),onChange:jest.fn()};
  let tree=list.render(props);
  nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:'oil'}});tree=list.render(props);
  expect(nodes(tree).filter(n=>n.type==='button'&&n.props.className?.includes('cfd-option')).map(n=>n.key)).toEqual(['WTIUSD']);
  nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:'BTC'}});tree=list.render(props);
  expect(text(tree)).toContain('trade.nothingFound');expect(text(tree)).not.toContain('BTCUSD');
});
