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
function materialize(){const frame=document.createElement('iframe');script().parentElement!.querySelector('.tradingview-widget-container__widget')!.append(frame);return frame;}
test.each(['spot','futures','cfd'])('one chart across ten rapid switches, detached late work cannot stack: %s',async market=>{
  const names=market==='cfd'?['XAUUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','XAUUSD','EURUSD','GBPUSD','USDJPY']:['BTC','ETH','SOL','XRP','ADA','DOGE','AVAX','LINK','LTC','DOT'].map(base=>`${base}/USDT`);
  let old:HTMLElement|null=null;let oldFrame:HTMLIFrameElement|null=null;
  for(const pair of names){await render(pair,market,true);if(old){expect(old.isConnected).toBe(false);expect(oldFrame!.isConnected).toBe(false);old.append(document.createElement('iframe'));}
    old=script().parentElement;oldFrame=materialize();expect(host.querySelectorAll('iframe')).toHaveLength(1);expect(host.querySelectorAll('script')).toHaveLength(1);
  }
});
test('timeframe label is driven by the exact interval sent to the chart; controls cannot drift',async()=>{
  await render();expect(config().interval).toBe('15');expect(host.textContent).toContain('BTC/USDT · 15m');const old=materialize();
  await click('1h');expect(config().interval).toBe('60');expect(host.textContent).toContain('BTC/USDT · 1h');expect(old.isConnected).toBe(false);
  await render('ETH/USDT');expect(config().interval).toBe('60');expect(host.textContent).toContain('ETH/USDT · 1h');
  await click('1D');expect(config().interval).toBe('D');expect(host.textContent).toContain('ETH/USDT · 1D');
  expect(config()).toMatchObject({hide_top_toolbar:true,withdateranges:false,hide_legend:true,hide_side_toolbar:false,allow_symbol_change:false});
});
test('supported indicators and volume pass into the sole chart',async()=>{await render();const select=host.querySelector('select')!;await act(async()=>{select.value='MASimple@tv-basicstudies';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});expect(config().studies).toEqual(['MASimple@tv-basicstudies']);await click('VOL');expect(config().hide_volume).toBe(true);expect(host.querySelectorAll('script')).toHaveLength(1);});
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
test('verified CFD mapping and compact visible attribution are preserved',async()=>{await render('XAUUSD','cfd');expect(config().symbol).toBe('OANDA:XAUUSD');expect(host.textContent).toContain('XAU/USD · 15m');expect(host.textContent).toContain('by TradingView');expect(host.querySelector('.terminal-chart-controls')!.textContent).not.toMatch(/OANDA|BYBIT|Perpetual Contract/);expect(host.querySelector('.terminal-chart-controls a')).not.toBeNull();});
test('fallback translations remain available in all seven locales',()=>{for(const key of ['trade.cfdChartUnavailable','trade.cfdChartUnavailableHint','trade.cfdChartRetry'])expect(readAllLocales().split('\n').filter(line=>line.includes(`'${key}':`))).toHaveLength(7);});
