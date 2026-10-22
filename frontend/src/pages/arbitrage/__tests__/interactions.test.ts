import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

// Actual mounted components; only exchange shell components are stubbed here.
// The separate shell suite exercises the real Nav and ticker exclusion.
const frontend = resolve(__dirname, '../../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
let dom: any, root: any, host: HTMLElement;
let calls: jest.Mock, interval: jest.SpyInstance, timeout: jest.SpyInstance, consoleError: jest.SpyInstance;
const modules = new Map<string, any>();
function load(file: string): any {
  for (const extension of ['', '.tsx', '.ts']) if (existsSync(file + extension)) { file += extension; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file,'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  new Function('exports','require',code)(exports,(name: string) => {
    if(name.endsWith('.css')) return {};
    if(name.endsWith('/Nav')) return { Nav: () => null };
    if(name.endsWith('/Footer')) return { Footer: () => null };
    if(name.endsWith('/api')) return { api:new Proxy({}, {get:() => calls}) };
    return name.startsWith('.') ? load(resolve(dirname(file),name)) : req(name);
  });
  return exports;
}
const originalFetch = globalThis.fetch;
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
beforeEach(() => {
  jest.useFakeTimers();
  consoleError=jest.spyOn(console,'error').mockImplementation(() => {});
  dom = new JSDOM('<div id="root"></div>',{url:'http://localhost/arbitrage',pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true});
  host=document.getElementById('root')!;
  root=req('react-dom/client').createRoot(host);
  calls=jest.fn(() => {throw new Error('Arbitrage must never call the network');});
  globalThis.fetch=calls as any;
  dom.window.fetch=calls;
  dom.window.WebSocket=calls;
  dom.window.EventSource=calls;
  interval=jest.spyOn(globalThis,'setInterval');
  timeout=jest.spyOn(globalThis,'setTimeout');
  modules.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  interval.mockRestore(); timeout.mockRestore();
  dom.window.close(); jest.useRealTimers(); globalThis.fetch=originalFetch;
  for(const key of ['window','document','HTMLElement','Node','IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis,key);
  const errors=consoleError.mock.calls;
  consoleError.mockRestore();
  expect(errors).toEqual([]);
});
async function mount() { const {ArbitragePage}=load(resolve(frontend,'src/pages/ArbitragePage')); await act(async()=>{root.render(React.createElement(ArbitragePage));await flush();}); }
function button(text: string) { const el=Array.from(host.querySelectorAll('button')).find(e=>e.textContent?.trim()===text || e.getAttribute('aria-label')===text); if(!el) throw new Error('Missing button: '+text); return el; }
async function click(el: Element) { await act(async()=>{el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await flush();}); }
async function input(el: HTMLInputElement, value:string) {
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value); el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await flush();});
}
async function change(el: HTMLSelectElement,value:string) { await act(async()=>{el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await flush();}); }
function field(label:string): HTMLInputElement { const el=Array.from(host.querySelectorAll('label')).find(e=>e.textContent?.startsWith(label))?.querySelector('input');if(!el)throw new Error('Missing input '+label);return el; }

test('mount, a hidden day, return, unmount and revisit make no module requests or polling timers',async()=>{
  await mount();
  await act(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new dom.window.Event('visibilitychange'));jest.advanceTimersByTime(86400000);await flush();});
  await act(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new dom.window.Event('visibilitychange'));window.dispatchEvent(new dom.window.Event('focus'));await flush();});
  await act(async()=>{root.render(null);jest.advanceTimersByTime(86400000);await flush();});
  await mount();
  expect(calls).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
  expect(timeout).not.toHaveBeenCalled();
  expect(host.querySelectorAll('button button')).toHaveLength(0);
});

test('form inputs, pair switching, scenario selection, filters, sort, modal and reset are connected',async()=>{
  await mount();
  // Interaction-specific assertions are deliberately tied to visible labels,
  // with expected arithmetic independently checked in model.test.ts.
  const selects=Array.from(host.querySelectorAll('select'));
  const pair=selects.find(e=>Array.from(e.options).some(o=>o.value==='ETH/USDT'))!;
  expect(pair).toBeTruthy();
  const budget=field('Бюджет');
  await input(budget,'25000');
  await change(pair,'ETH/USDT');
  expect(budget.value).toBe('25000');
  expect(field('Цена покупки').value).toBe('3124.8');
  expect(field('Цена продажи').value).toBe('3162.4');
  await input(budget,'');
  expect(host.textContent).toContain('Введите');
  const output=host.querySelector('[data-testid="calculator-result"]')!;
  expect(output.textContent).toContain('—');
  await click(button('Сбросить параметры'));
  expect(budget.value).toBe('10000');
  expect(pair.value).toBe('BTC/USDT');
});

test('search, result filters, both numeric sorts, selection and quick amounts update visible controls',async()=>{
  await mount();
  const search=host.querySelector('input[type="search"]') as HTMLInputElement;
  const rows=()=>Array.from(host.querySelectorAll('tbody tr'));
  await input(search,' eth ');
  expect(rows()).toHaveLength(1);expect(rows()[0].textContent).toContain('ETH');
  await click(rows()[0].querySelector('button')!);
  expect(field('Цена покупки').value).toBe('3124.8');
  await click(button('Не покрывает расходы'));
  expect(rows()).toHaveLength(0);expect(host.textContent).toContain('Сценарии не найдены');
  await click(button('Сбросить фильтры'));
  expect(rows()).toHaveLength(8);
  await click(button('Не покрывает расходы'));
  expect(rows().map(e=>e.getAttribute('data-testid')).sort()).toEqual(['scenario-row-LINK','scenario-row-XRP']);
  await click(button('Положительный результат'));expect(rows()).toHaveLength(6);
  await click(button('Все'));
  const sort=host.querySelector('select[aria-label="Сортировка сценариев"]') as HTMLSelectElement;
  await change(sort,'pair');expect(rows()[0].textContent).toContain('AVAX');
  await change(sort,'spread');expect(rows()[0].textContent).toContain('SOL');
  await change(sort,'result');expect(rows()[0].textContent).toContain('SOL');
  const quick=host.querySelector('[aria-label="Быстрые суммы"] button:last-child')!;
  await click(quick);expect(field('Бюджет').value).toBe('100000');
  await click(rows().find(e=>e.getAttribute('data-testid')==='scenario-row-TON')!.querySelector('button')!);
  expect(field('Бюджет').value).toBe('100000');expect(field('Цена покупки').value).toBe('5.214');
  expect(calls).not.toHaveBeenCalled();
});

test('scenario and calculator breakdowns keep their own budgets and keyboard focus is contained/restored',async()=>{
  await mount();
  await input(field('Бюджет'),'50000');
  const detail=button('Разобрать сценарий ETH/USDT');
  detail.focus();await click(detail);
  let dialog=document.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog).toBeTruthy();expect(dialog.textContent).toContain('ETH/USDT');
  expect(dialog.textContent!.replace(/\s/g,'')).toContain('10000');
  expect(field('Цена покупки').value).toBe('84320.5'); // detail never selects the row
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  expect((host as any).inert).toBe(true);
  const focusables=dialog.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex="0"]');
  focusables[focusables.length-1].focus();
  await act(async()=>{document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));});
  expect(document.activeElement).toBe(focusables[0]);
  await act(async()=>{document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));});
  expect(document.activeElement).toBe(focusables[focusables.length-1]);
  await act(async()=>{document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
  expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(detail);
  expect(document.body.style.overflow).toBe('');
  expect((host as any).inert).toBeFalsy();
  const formDetail=button('Разобрать сценарий');formDetail.focus();await click(formDetail);
  dialog=document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent!.replace(/\s/g,'')).toContain('50000');
  expect(dialog.textContent).toContain('BTC/USDT');
  await act(async()=>{root.render(null);});expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect((host as any).inert).toBeFalsy();
  expect(calls).not.toHaveBeenCalled();
});

test('breakdown preserves distinct small editable prices instead of displaying zero',async()=>{
  await mount();
  await input(field('Цена покупки'),'0.000001');
  await input(field('Цена продажи'),'0.0000011');
  await click(button('Разобрать сценарий'));
  const route=document.querySelector('.arb-dialog-route')!;
  expect(route.textContent).toContain('0,000001');
  expect(route.textContent).toContain('0,0000011');
  expect(route.textContent).not.toContain('0,00000 USDT');
});
