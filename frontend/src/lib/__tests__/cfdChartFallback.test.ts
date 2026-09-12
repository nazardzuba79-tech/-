import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { readAllLocales } from '../../../test-utils/i18nSource';

// Real React/DOM lifecycle, official-script boundary simulated locally. No feed or financial writes.
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
let dom:any, root:any, host:HTMLElement, Chart:any, CfdChart:any, lang:string;
const modules = new Map<string,any>();
function load(file:string):any {
  for(const suffix of ['', '.tsx', '.ts']) if(existsSync(file+suffix)){ file+=suffix;break; }
  if(modules.has(file))return modules.get(file);
  const output:any={};modules.set(file,output);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(output,(name:string)=>{
    if(name.endsWith('.css'))return {};
    if(name.endsWith('/i18n'))return {useLanguage:()=>({lang,t:(key:string)=>key})};
    return name.startsWith('.')?load(resolve(dirname(file),name)):req(name);
  });return output;
}
beforeEach(()=>{
  dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/trade'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  host=document.getElementById('root')!;root=req('react-dom/client').createRoot(host);lang='en';modules.clear();
  Chart=load(resolve(frontend,'src/components/TradingViewAdvancedChart')).TradingViewAdvancedChart;
  CfdChart=load(resolve(frontend,'src/components/CfdChart')).CfdChart;
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();});
const script=()=>host.querySelector('script') as HTMLScriptElement;
const config=()=>JSON.parse(script().text);
async function render(pair='BTC/USDT',market='spot',strict=false){await act(async()=>root.render(React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(Chart,{pair,market}))));}
async function click(label:string){const btn=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label)!;expect(btn).toBeDefined();await act(async()=>btn.click());}
function materialize(){const frame=document.createElement('iframe');// The real official loader replaces its placeholder; the iframe is a direct owned child.
  script().parentElement!.querySelector('.tradingview-widget-container__widget')!.replaceWith(frame);return frame;}
test.each(['spot','futures','cfd'])('one chart across twenty rapid switches, detached late work cannot stack: %s',async market=>{
  const names=market==='cfd'?['XAUUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','XAUUSD','EURUSD','GBPUSD','USDJPY']:['BTC','ETH','SOL','XRP','ADA','DOGE','AVAX','LINK','LTC','DOT'].map(base=>`${base}/USDT`);
  let old:HTMLElement|null=null;let oldFrame:HTMLIFrameElement|null=null;
  for(const pair of [...names, ...names]){await render(pair,market,true);if(old){expect(old.isConnected).toBe(false);expect(oldFrame!.isConnected).toBe(false);old.append(document.createElement('iframe'));}
    old=script().parentElement;oldFrame=materialize();expect(host.querySelectorAll('iframe')).toHaveLength(1);expect(host.querySelectorAll('script')).toHaveLength(1);
  }
});
test('native widget owns timeframe without a duplicate or stale parent label',async()=>{
  await render();expect(config().interval).toBe('15');const frame=materialize();
  expect(host.querySelector('.terminal-chart-controls')).toBeNull();
  expect(host.querySelector('[aria-label="Chart timeframe"]')).toBeNull();
  expect(host.textContent).not.toMatch(/15m|1h|1D|VOL/);
  await render();expect(frame.isConnected).toBe(true);
  await render('ETH/USDT');expect(frame.isConnected).toBe(false);expect(config().symbol).toBe('BYBIT:ETHUSDT');
  expect(config()).toMatchObject({hide_top_toolbar:false,withdateranges:true,hide_legend:true,hide_side_toolbar:false,allow_symbol_change:false});
});
test('native TradingView full indicators and volume remain available',async()=>{await render();expect(config()).toMatchObject({hide_top_toolbar:false,hide_side_toolbar:false,hide_volume:false,studies:[]});expect(host.querySelector('select[aria-label="Chart indicator"]')).toBeNull();expect(host.querySelectorAll('script')).toHaveLength(1);});
test('script failure shows honest fallback, preserves CFD disclaimer and retry recovers',async()=>{
  await act(async()=>root.render(React.createElement(CfdChart,{symbol:'XAUUSD'})));const first=script();await act(async()=>first.dispatchEvent(new dom.window.Event('error')));
  expect(host.textContent).toContain('trade.cfdChartUnavailable');expect(host.textContent).toContain('trade.cfdPriceDisclaimer');
  await click('trade.cfdChartRetry');expect(script()).not.toBe(first);expect(first.isConnected).toBe(false);expect(host.querySelector('[role=status]')).toBeNull();materialize();expect(host.querySelectorAll('iframe')).toHaveLength(1);
});
test('loaded script without a widget times out and can retry, no poisoned global promise',async()=>{
  const callbacks:Function[]=[];jest.spyOn(dom.window,'setTimeout').mockImplementation((callback:any)=>{callbacks.push(callback);return 1;});
  await render();await act(async()=>{callbacks[callbacks.length-1]();});expect(host.textContent).toContain('trade.cfdChartUnavailable');await click('trade.cfdChartRetry');expect(host.querySelector('[role=status]')).toBeNull();expect(host.querySelectorAll('script')).toHaveLength(1);
});
test('unmount pending script cancels callbacks and removes all owned nodes',async()=>{await render();const oldScript=script(),owned=oldScript.parentElement!;await act(async()=>root.render(null));expect(oldScript.onerror).toBeNull();owned.append(document.createElement('iframe'));expect(host.childElementCount).toBe(0);expect(owned.isConnected).toBe(false);});
test.each([['ru','ru'],['en','en'],['zh','zh_CN'],['es','es'],['ja','ja']])('locale switch remounts cleanly: %s',async(selected,expected)=>{await render();const old=materialize();lang=selected;await render('EUR/USD');expect(config().locale).toBe(expected);expect(old.isConnected).toBe(false);});
test('unknown CFD mapping and malformed symbols never substitute another instrument',async()=>{await render('UNKNOWN','cfd');expect(script()).toBeNull();expect(host.textContent).toContain('trade.cfdChartUnavailable');await render('BTC<script>');expect(script()).toBeNull();});
test('verified CFD mapping and compact visible attribution are preserved',async()=>{await render('XAUUSD','cfd');expect(config().symbol).toBe('OANDA:XAUUSD');expect(host.textContent).toContain('XAU/USD chart');expect(host.textContent).toContain('by TradingView');expect(host.querySelector('.voltex-tradingview-chart__copyright')!.textContent).not.toMatch(/OANDA|BYBIT|Perpetual Contract/);expect(host.querySelector('.terminal-chart-controls a')).toBeNull();expect(host.querySelector('.voltex-tradingview-chart__copyright a')).not.toBeNull();});
test('fallback translations remain available in all seven locales',()=>{for(const key of ['trade.cfdChartUnavailable','trade.cfdChartUnavailableHint','trade.cfdChartRetry'])expect(readAllLocales().split('\n').filter(line=>line.includes(`'${key}':`))).toHaveLength(7);});

test('supported dark canvas config and visible attribution below the entire plot',async()=>{
  await render();expect(config()).toMatchObject({backgroundColor:'#0d141d',gridColor:'#0e151e',theme:'dark',autosize:true});
  const footer=host.querySelector('.voltex-tradingview-chart__copyright')!;
  expect(footer.previousElementSibling).toBe(host.querySelector('.voltex-tradingview-chart__plot'));
  expect(footer.textContent).toContain('by TradingView');
  expect(host.querySelector('style')).toBeNull();
});
