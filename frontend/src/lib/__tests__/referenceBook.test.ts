import { referencePrice, referenceQuantity, referenceRowCount, visibleDepthRatio, REFERENCE_CENTER_HEIGHT, REFERENCE_ROW_HEIGHT } from '../referenceBook';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
let dom:any, root:any, host:HTMLElement, Book:any, view:any, listener:any;
const release = jest.fn();
const subscribe = jest.fn((_pair:string, callback:any) => {listener=callback; return release;});
const pick = jest.fn();
const modules = new Map<string,any>();
function load(file:string):any {
  for(const suffix of ['', '.tsx', '.ts']) if(existsSync(file+suffix)){file+=suffix;break;}
  if(modules.has(file))return modules.get(file);
  const output:any={};modules.set(file,output);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(output,(name:string)=>{
    if(name.endsWith('/i18n'))return {useLanguage:()=>({lang:'en',t:(key:string)=>key})};
    if(name.endsWith('/useMarketData'))return {useMarketTicker:()=>view};
    if(name.endsWith('/krakenSocket'))return {krakenSocket:{subscribeTrades:subscribe}};
    return name.startsWith('.')?load(resolve(dirname(file),name)):req(name);
  });return output;
}
const level=(price:number,quantity:number)=>({price:String(price),quantity:String(quantity)});
const bids=[level(100,1),level(99,2),level(98,3)], asks=[level(101,4),level(102,5),level(103,6)];
beforeEach(()=>{
  dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/futures'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  host=document.getElementById('root')!;root=req('react-dom/client').createRoot(host);modules.clear();
  view={ticker:{lastPrice:'100.25'},error:false,stale:false};release.mockClear();subscribe.mockClear();pick.mockClear();
  Book=load(resolve(frontend,'src/components/FuturesReferenceBook')).FuturesReferenceBook;
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();});
async function render(pair='BTC/USDT',b=bids,a=asks,trades:any[]=[]){await act(async()=>root.render(React.createElement(Book,{pair,bids:b,asks:a,onPickPrice:pick,trades,lastPrice:!view.error&&!view.stale&&Number(view.ticker?.lastPrice)>0?Number(view.ticker.lastPrice):null})));}
async function click(selector:string){const button=host.querySelector(selector) as HTMLButtonElement;expect(button).not.toBeNull();await act(async()=>button.click());}

test('consistent decimals, tiny real quantities never rounded to zero, invalid quantities unavailable',()=>{
  expect(referenceQuantity(1)).toBe('1.000');expect(referenceQuantity(0.004)).toBe('0.004');
  expect(Number(referenceQuantity(1e-12))).toBeGreaterThan(0);
  expect(referenceQuantity(0)).toBe('0.000');
  for(const v of [NaN,Infinity,-1])expect(referenceQuantity(v)).toBe('—');
});
test.each([312,460,472,598])('row budget at %spx cannot expose partial rows',height=>{
  // Against the REAL row pitch, not a copy of it. Repeating the number here
  // meant this pinned one specific height rather than the invariant it
  // names — change the pitch and the ladder is still whole rows, but the
  // assertion was measuring the old one.
  for(const both of [true,false])expect(referenceRowCount(height,both)*REFERENCE_ROW_HEIGHT*(both?2:1)+REFERENCE_CENTER_HEIGHT).toBeLessThanOrEqual(height);
});
test('depth ratio needs both real sides, never substitutes a fake 50/50',()=>{
  expect(visibleDepthRatio([],[])).toBeNull();
  expect(visibleDepthRatio([{price:1,quantity:1,cumulative:1}],[])).toBeNull();
  expect(visibleDepthRatio([{price:1,quantity:1,cumulative:1}],[{price:2,quantity:3,cumulative:3}])).toBe(25);
});
test('total column is cumulative BASE quantity, not level quote notional; last price is not midpoint',async()=>{
  await render();const rows=host.querySelectorAll('.rb-bids .rb-row');
  expect(rows[1].textContent).toContain('99.0002.0003.000');
  expect(rows[1].querySelector('span:last-child')!.getAttribute('title')).toBe('3 BTC');
  expect(host.querySelector('.rb-center strong')!.textContent).toBe('100.25');
  expect(host.querySelector('.rb-ratio')!.textContent).toContain('29%');
});
test('display modes work and price selection preserves exact tiny tick',async()=>{
  await render('TINY/USDT',[level(0.0000081234,2)],[level(0.0000081236,3)]);
  const row=host.querySelector('.rb-bids button')!;const exact=row.querySelector('span')!.getAttribute('title');
  await click('.rb-bids button');expect(pick).toHaveBeenCalledWith(exact);expect(Number(exact)).toBeGreaterThan(0);
  await click('.rb-modes button:nth-child(2)');expect(host.querySelector('.rb-asks')).toBeNull();
  await click('.rb-modes button:nth-child(3)');expect(host.querySelector('.rb-bids')).toBeNull();
  await click('.rb-modes button:nth-child(1)');expect(host.querySelector('.rb-bids')).not.toBeNull();
});
test.each([{error:true},{stale:true},{ticker:null},{ticker:{lastPrice:'0'}},{ticker:{lastPrice:'NaN'}}])('unavailable last is never shown as live; any derived midpoint is explicitly identified: %j',async override=>{
  view={...view,...override};await render();expect(host.querySelector('.rb-center strong')!.textContent).toBe('100.50');
  expect(host.querySelector('.rb-mid-label')!.textContent).toBe('Mid');
  expect(host.querySelector('.rb-center strong')!.getAttribute('title')).toContain('best bid + best ask');
  await render('BTC/USDT',[],[]);expect(host.querySelector('.rb-center strong')!.textContent).toBe('—');
  expect(host.querySelector('.rb-mid-label')).toBeNull();
});
test('tape uses only parent-owned exact-contract trades, without a Spot subscription',async()=>{
  await render();await click('.rb-tabs button:nth-child(2)');expect(subscribe).not.toHaveBeenCalled();
  await render('BTC/USDT',bids,asks,[{id:'1',price:'100',quantity:'2',side:'BUY',time:1000}]);
  expect(host.querySelectorAll('.rb-tape .rb-row')).toHaveLength(1);
  await render('ETH/USDT');expect(host.querySelectorAll('.rb-tape .rb-row')).toHaveLength(0);
});

test.each([0.000000987654,0.000000000000034,0.000009876,0.09999999,999.999,1234,999999,1e9,1e20,Number.MIN_VALUE,Number.MAX_VALUE])('long quantity %s fits a narrow column and never becomes false zero', value=>{
  const display=referenceQuantity(value);expect(display.length).toBeLessThanOrEqual(8);expect(parseFloat(display)).toBeGreaterThan(0);expect(display).not.toContain('…');
});
test('price display is bounded while the price-pick value and tooltip preserve full tiny-price precision',async()=>{
  expect(referencePrice(76803.9,0.1)).toBe('76,803.90');
  expect(Number(referencePrice(1e-25))).toBeGreaterThan(0);
  const value=0.0000000123456789;expect(referencePrice(value,1e-12).length).toBeLessThanOrEqual(10);
  await render('TINY/USDT',[level(value,0.0000000987654321)],[level(value+1e-12,2)]);
  const row=host.querySelector('.rb-bids button')!;const exact=row.querySelector('span')!.getAttribute('title');
  await click('.rb-bids button');expect(pick).toHaveBeenLastCalledWith(exact);expect(Number(exact)).toBeGreaterThan(0);
  expect(row.querySelector('span:nth-of-type(2)')!.getAttribute('title')).toBe('9.87654321e-8 TINY');
});

test('center uses the fresh selected-contract execution; stale execution cannot override the ticker',async()=>{
 const trade={id:'latest',price:'100.50',quantity:'0.1',time:Date.now(),side:'BUY'};
 await render('BTC/USDT',bids,asks,[trade]);expect(host.querySelector('.rb-center strong')!.textContent).toBe('100.50');
 await render('BTC/USDT',bids,asks,[{...trade,time:Date.now()-30001}]);
 // The arrow is no longer glued to the front of the number. It has its own
 // fixed-width slot AFTER the price, as the reference terminal draws it, so
 // that a flip from up to down cannot shift the digits sideways. Asserted as
 // the two parts rather than as one concatenated string, which is what the
 // panel actually guarantees.
 const centre=host.querySelector('.rb-center strong')!;
 expect(centre.querySelector('.rb-last')!.textContent).toBe('100.25');
 expect(centre.querySelector('.rb-arrow')!.textContent).toBe('↓');
 expect(centre.textContent).toBe('100.25↓');
});
