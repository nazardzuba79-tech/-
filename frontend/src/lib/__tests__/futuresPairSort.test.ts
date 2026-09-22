import * as futuresReference from '../futuresReference';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
const symbols = ['ETH/USDT', 'BTC/USDT', 'SOL/USDT', 'UNKNOWN/USDT'];
const tickers = new Map([
  ['BTC/USDT', { lastPrice:'70000', changePercent24h:'-2', quoteVolume24h:'100' }],
  ['ETH/USDT', { lastPrice:'2500', changePercent24h:'0', quoteVolume24h:'900' }],
  ['SOL/USDT', { lastPrice:'100', changePercent24h:'5', quoteVolume24h:'200' }],
]);
let dom:any, root:any, host:HTMLElement;
const pick = jest.fn();
beforeEach(async () => {
  dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/futures'});
  Object.assign(globalThis, {window:dom.window, document:dom.window.document, HTMLElement:dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true});
  host=document.getElementById('root')!;
  root=req('react-dom/client').createRoot(host);
  const output:any={};
  const code=ts.transpileModule(readFileSync(resolve(frontend,'src/components/FuturesPairList.tsx'),'utf8'), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const favorites = new Set(['ETH/USDT', 'SOL/USDT']);
  new Function('exports','require',code)(output,(name:string) => {
    // JSDOM checks behavior here; the dedicated Chromium regression loads real CSS.
    if(name === './FuturesPairList.css')return {};
    if(name.endsWith('/i18n'))return {useLanguage:()=>({t:(key:string)=>key})};
    if(name.endsWith('/useFuturesReference'))return {useFuturesReference:()=>new Map([...tickers].map(([pair,row])=>[pair,Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Number(value)]))]))};
    if(name.endsWith('/futuresReference'))return futuresReference;
    if(name.endsWith('/CryptoIcon'))return {CryptoIcon:()=>null};
    if(name.endsWith('/priceChange'))return {parseChangePercent:Number};
    if(name.endsWith('/formatNumber'))return {formatPrice:String};
    if(name.endsWith('/useFavorites'))return {useFavorites:()=>({favorites,toggle:jest.fn()})};
    if(name.endsWith('/useWindowedRows'))return {useWindowedRows:(n:number)=>({start:0,end:n,padTop:0,padBottom:0,ref:()=>{}})};
    // Deliberately still stubbed, and deliberately poisoned: the futures
    // list no longer imports the catalogue at all, so if this is ever
    // reached again the values below are wrong for these contracts and a
    // cross-domain 7d would show up as an obviously false number.
    if(name.endsWith('/catalogueStore'))return {catalogueStore:{subscribe:()=>{
      throw new Error('futures pair list must not subscribe to the CoinGecko catalogue');
    }}};
    return req(name);
  });
  pick.mockClear();
  await act(async()=>root.render(React.createElement(output.FuturesPairList,{symbols,symbol:'SOL/USDT',onChange:pick})));
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();});
const order=()=>Array.from(host.querySelectorAll('.pair-row')).map(n=>n.getAttribute('aria-label'));
async function sort(index:number){await act(async()=>(host.querySelectorAll('.pch-sort')[index] as HTMLButtonElement).click());}

test.each([0,1])('column %s cycles descending, ascending, default; unknown last and BTC restored without changing selected contract',async index=>{
  expect(host.querySelector('select')).toBeNull();
  expect(order()).toEqual(['BTC/USDT','ETH/USDT','SOL/USDT','UNKNOWN/USDT']);
  const list=host.querySelector('.pairs-list') as HTMLElement;list.scrollTop=500;
  await sort(index);expect(list.scrollTop).toBe(0);
  expect(order()).toEqual(index===0?['BTC/USDT','ETH/USDT','SOL/USDT','UNKNOWN/USDT']:['SOL/USDT','ETH/USDT','BTC/USDT','UNKNOWN/USDT']);
  await sort(index);
  expect(order()).toEqual(index===0?['SOL/USDT','ETH/USDT','BTC/USDT','UNKNOWN/USDT']:['BTC/USDT','ETH/USDT','SOL/USDT','UNKNOWN/USDT']);
  await sort(index);expect(order()).toEqual(['BTC/USDT','ETH/USDT','SOL/USDT','UNKNOWN/USDT']);
  expect(host.querySelector('.pair-row.active')?.getAttribute('aria-label')).toBe('SOL/USDT');
  expect(pick).not.toHaveBeenCalled();
});
test('changing column starts descending; default does not inject BTC into favorites',async()=>{
  await act(async()=>(host.querySelector('.pairs-tab') as HTMLButtonElement).click());
  await sort(0);await sort(0);await sort(1);
  expect(order()).toEqual(['SOL/USDT','ETH/USDT']);
  await sort(1);await sort(1);
  expect(order()).toEqual(['ETH/USDT','SOL/USDT']);
});
