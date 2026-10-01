import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

// Mount the actual OTC page, form, detail and actions. Only the unrelated
// exchange shell and HTTP boundary are fixtures. No real account/network.
const frontend=resolve(__dirname,'../../../..'), req=createRequire(resolve(frontend,'package.json'));
const React=req('react'), {act}=React, {JSDOM}=req('jsdom');
const modules=new Map<string,any>(), sessionListeners=new Set<()=>void>();
let dom:any,root:any,host:HTMLElement,token:string|null,calls:jest.Mock,openSupport:jest.Mock,errorLog:jest.SpyInstance;
const tokenFor=(id:string)=>`fixture.${Buffer.from(JSON.stringify({sub:id})).toString('base64url')}.not-a-signature`;
class ApiError extends Error { constructor(public status:number,message:string){super(message);} }
const config={enabled:true,routes:[{country:'RU',cityId:'geonames-524901',asset:'USDT',fiat:'USD',cashPrecision:2},{country:'UA',cityId:'geonames-703448',asset:'USDT',fiat:'EUR',cashPrecision:2}]};
const summary={id:'0e997edf-1b9a-47d2-aaed-ef2c3c287f97',number:'OTC-1',country:'RU',cityId:'geonames-524901',asset:'USDT',quantity:'10000',fiat:'USD',tier:'otc-convert',status:'RESERVED',version:1,offerVersion:0,acceptedOfferVersion:null,acceptedAt:null,cancelRequested:false,pickupRevision:0,createdAt:'2026-10-01T10:00:00Z',reservedQuantity:'10000'};
const detail=()=>({...summary,offers:[],reservation:{asset:'USDT',quantity:'10000',status:'HELD'}});
function load(file:string):any{
  for(const ext of ['', '.tsx','.ts','.json'])if(existsSync(file+ext)){file+=ext;break;}
  if(file.endsWith('.json'))return JSON.parse(readFileSync(file,'utf8'));
  if(modules.has(file))return modules.get(file);
  const exports:any={};modules.set(file,exports);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true}}).outputText;
  new Function('exports','require',code)(exports,(name:string)=>{
    if(name.endsWith('.css'))return {};
    if(name.endsWith('/Nav'))return {Nav:()=>null};if(name.endsWith('/Footer'))return {Footer:()=>null};
    if(name.endsWith('/DepositModal'))return {DepositModal:()=>React.createElement('div',{'data-testid':'deposit'},'Обычный депозит')};
    if(name.endsWith('/supportWidget'))return {openSupportWidget:openSupport};
    if(name.endsWith('/CountryCombobox'))return {CountryCombobox:({value,onChange}:any)=>React.createElement('select',{'aria-label':'Страна',value:value??'',onChange:(e:any)=>onChange(e.target.value)},['','RU','UA'].map(v=>React.createElement('option',{key:v,value:v},v)))};
    if(name.endsWith('/api'))return {getToken:()=>token,onSessionChange:(fn:()=>void)=>{sessionListeners.add(fn);return()=>sessionListeners.delete(fn);},request:calls,ApiError};
    return name.startsWith('.')?load(resolve(dirname(file),name)):req(name);
  });return exports;
}
const originalFetch=globalThis.fetch;
const globalNames=['window','document','localStorage','HTMLElement','Node','Event','IS_REACT_ACT_ENVIRONMENT'];
const originalGlobals=new Map(globalNames.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
beforeEach(()=>{
  jest.useFakeTimers();errorLog=jest.spyOn(console,'error').mockImplementation(()=>{});
  dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/otc',pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true});
  host=document.getElementById('root')!;root=req('react-dom/client').createRoot(host);token=tokenFor('user-a');modules.clear();sessionListeners.clear();
  openSupport=jest.fn();calls=jest.fn(async(path:string)=>{
    if(path==='/otc/config')return config;if(path==='/otc/balances')return {eligible:true,balances:[{asset:'USDT',available:'20000'}]};
    if(path.includes('/messages'))return {rows:[],hasMore:false};
    if(path.includes('?page='))return {rows:[summary],hasMore:false};
    if(path.endsWith(summary.id))return detail();
    throw Error(`Unexpected fixture request: ${path}`);
  });
  globalThis.fetch=jest.fn(()=>{throw Error('Network forbidden');}) as any;
});
afterEach(async()=>{
  await act(async()=>root.unmount());dom.window.close();jest.useRealTimers();globalThis.fetch=originalFetch;
  for(const [key,descriptor] of originalGlobals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  const errors=errorLog.mock.calls;errorLog.mockRestore();expect(errors).toEqual([]);
});
const button=(text:string)=>{const el=Array.from(host.querySelectorAll('button')).find(e=>e.textContent?.trim()===text);if(!el)throw Error('Missing button '+text);return el;};
const field=(label:string,tag='input')=>{const el=Array.from(host.querySelectorAll('label')).find(e=>e.textContent?.startsWith(label))?.querySelector(tag);if(!el)throw Error('Missing field '+label);return el as HTMLInputElement;};
async function click(el:Element){await act(async()=>{el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await flush();});}
async function change(el:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{const prototype=el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await flush();});}
// Former public composition remains test-only; all financial assertions below
// still exercise the unchanged real components, including account remounts.
async function mountPage(){const {OtcPage}=load(resolve(frontend,'src/pages/otc/__fixtures__/LegacyOtcPage'));await act(async()=>{root.render(React.createElement(OtcPage));await flush();});}
async function fill(){await change(host.querySelector('[aria-label="Страна"]')!,'RU');await change(field('Город','select'),'geonames-524901');await change(field('Количество'),'10000');await change(field('Получаете','select'),'USD');}
async function confirm(){await click(button('Проверить параметры'));await click(host.querySelector('.otc-cash-confirm input[type="checkbox"]')!);}
const posts=()=>calls.mock.calls.filter(([,options])=>options?.method==='POST');

test('public OTC only opens support, without reads, reserve writes or draft prefilling',async()=>{
  const {OtcPage}=load(resolve(frontend,'src/pages/OtcPage'));
  await act(async()=>{root.render(React.createElement(OtcPage));await flush();});
  expect(calls).not.toHaveBeenCalled();expect(openSupport).not.toHaveBeenCalled();
  expect(host.querySelectorAll('input,textarea,form')).toHaveLength(0);
  for(const el of Array.from(host.querySelectorAll('button')))await click(el);
  expect(openSupport).toHaveBeenCalledTimes(4);
  expect(calls).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  await act(async()=>{jest.advanceTimersByTime(86400000);await flush();});
  expect(calls).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('country reset and all edits remain local; no reserve before both confirmations; idle day has no own requests',async()=>{
  await mountPage();expect(calls).toHaveBeenCalledTimes(2);expect(field('Город','select').disabled).toBe(true);
  await fill();expect(posts()).toHaveLength(0);expect(calls).toHaveBeenCalledTimes(2);
  await change(host.querySelector('[aria-label="Страна"]')!,'UA');expect(field('Город','select').value).toBe('');expect(field('Получаете','select').value).toBe('');
  await fill();await click(button('Проверить параметры'));expect(posts()).toHaveLength(0);
  expect(button('Создать заявку и зарезервировать 10000 USDT').disabled).toBe(true);
  await act(async()=>{jest.advanceTimersByTime(86400000);await flush();});expect(calls).toHaveBeenCalledTimes(2);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test('commit response alone opens durable request; exact Q, key and account draft; no deposit redirect',async()=>{
  await mountPage();await fill();await confirm();
  calls.mockImplementationOnce(async(path:string,options:any)=>{expect(path).toBe('/otc/requests');const body=JSON.parse(options.body);expect(body.quantity).toBe('10000');expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);return summary;});
  await click(button('Создать заявку и зарезервировать 10000 USDT'));
  expect(posts()).toHaveLength(1);expect(host.textContent).toContain('Заявка OTC-1 подтверждена сервером');
  expect(host.textContent).toContain('Приватная поддержка по заявке');expect(host.querySelector('[data-testid="deposit"]')).toBeNull();
});
test('ambiguous create survives remount and reuses original key without automatically POSTing',async()=>{
  await mountPage();await fill();await confirm();calls.mockImplementationOnce(async()=>{throw Error('Lost reply');});
  await click(button('Создать заявку и зарезервировать 10000 USDT'));const sent=posts()[0][1].body;
  expect(host.textContent).toContain('Результат исходной попытки уточняется');
  await act(async()=>{root.render(null);await flush();});await mountPage();expect(posts()).toHaveLength(1);
  calls.mockImplementationOnce(async(_path:string,options:any)=>{expect(options.body).toBe(sent);return summary;});
  await click(button('Повторить с тем же ключом'));expect(posts()).toHaveLength(2);expect(host.textContent).toContain('Заявка OTC-1 подтверждена сервером');
});
test('known insufficient funds does not fabricate success; deposit stays explicit; disabled policy cannot reserve',async()=>{
  await mountPage();await fill();await change(field('Количество'),'25000');
  expect(host.textContent).toContain('Не хватает 5000 USDT');expect(button('Проверить параметры').disabled).toBe(true);
  await click(button('Пополнить обычный баланс'));expect(host.querySelector('[data-testid="deposit"]')).not.toBeNull();expect(posts()).toHaveLength(0);
  calls.mockImplementationOnce(async()=>({...config,enabled:false}));await click(button('Обновить доступный остаток'));await change(field('Количество'),'10000');
  expect(button('Проверить параметры').disabled).toBe(true);expect(posts()).toHaveLength(0);
});
test('account switch discards private in-flight data and uses a different draft namespace',async()=>{
  await mountPage();await fill();await click(button('Мои заявки'));
  let resolveOld!:(v:any)=>void;calls.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  await click(host.querySelector('.otc-cash-list-item')!);
  await act(async()=>{token=tokenFor('user-b');for(const fn of sessionListeners)fn();await flush();});
  await act(async()=>{resolveOld({...detail(),number:'PRIVATE_OLD_ACCOUNT'});await flush();});
  expect(host.textContent).not.toContain('PRIVATE_OLD_ACCOUNT');expect(host.textContent).not.toContain('Приватная поддержка по заявке');expect(field('Количество').value).toBe('');
  expect(localStorage.getItem('voltex:otc-draft:v1:user-a')).toContain('10000');expect(localStorage.getItem('voltex:otc-draft:v1:user-b')).not.toContain('10000');
});

test('failed balance refresh locks an already confirmed form without fabricating a remaining amount',async()=>{
  await mountPage();await fill();await confirm();
  calls.mockImplementationOnce(async()=>{throw Error('Unavailable');});
  await click(button('Обновить доступный остаток'));
  expect(host.textContent).toContain('Доступно после резерва: — USDT');
  expect(button('Создать заявку и зарезервировать 10000 USDT').disabled).toBe(true);
  expect(posts()).toHaveLength(0);
});
test('private chat renders server text literally, retries one message key, no address in storage/list/URL',async()=>{
  const secret='<img src=x onerror=alert(1)> LOCAL PRIVATE DESK';let saved=false;
  const base=calls.getMockImplementation()!;calls.mockImplementation(async(path:string,options:any)=>{
    if(path.includes('/messages')&&options?.method==='POST'){if(!saved){saved=true;throw Error('lost reply');}return {id:'message-id'};}
    if(path.includes('/messages'))return {rows:[{id:'m',sender:'ADMIN',kind:'PICKUP',text:secret,createdAt:summary.createdAt}],hasMore:false};return base(path,options);
  });
  await mountPage();await click(button('Мои заявки'));expect(host.textContent).not.toContain(secret);await click(host.querySelector('.otc-cash-list-item')!);
  expect(host.textContent).toContain(secret);expect(host.querySelector('.otc-cash-messages img')).toBeNull();
  await change(field('Сообщение','textarea'),'Вопрос клиента');await click(button('Отправить сообщение'));await click(button('Повторить исходное сообщение'));
  expect(posts()).toHaveLength(2);expect(posts()[0][1].body).toBe(posts()[1][1].body);
  expect(JSON.stringify({...localStorage})).not.toContain(secret);expect(window.location.href).not.toContain('DESK');
});
test('admin actions are explicit and use expected version; filters only query on Apply',async()=>{
  const {CashList,CashDetailPanel}=load(resolve(frontend,'src/pages/otc/OtcCashDesk'));
  await act(async()=>{root.render(React.createElement(CashList,{admin:true,onOpen:()=>{}}));await flush();});const count=calls.mock.calls.length;
  await change(field('Статус','select'),'RESERVED');expect(calls).toHaveBeenCalledTimes(count);await click(button('Применить'));expect(calls.mock.calls.at(-1)![0]).toContain('status=RESERVED');
  await act(async()=>{root.render(React.createElement(CashDetailPanel,{id:summary.id,admin:true,onClose:()=>{}}));await flush();});
  await click(button('Отклонить и вернуть резерв'));expect(posts()).toHaveLength(0);
  expect(button('Подтвердить действие').disabled).toBe(true);await click(host.querySelector('.otc-cash-actions input[type="checkbox"]')!);
  calls.mockImplementationOnce(async(path:string,options:any)=>{expect(path).toContain('/actions');expect(JSON.parse(options.body)).toMatchObject({action:'reject',version:1});return {status:'REJECTED',version:2};});
  await click(button('Подтвердить действие'));expect(posts()).toHaveLength(1);
});
test('balance invalidation is event-driven and cross-tab account scoped',async()=>{
  const {invalidateSpendableBalances,onSpendableBalancesChanged}=load(resolve(frontend,'src/lib/balanceInvalidation'));const changed=jest.fn(),stop=onSpendableBalancesChanged(changed);
  invalidateSpendableBalances();expect(changed).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new dom.window.StorageEvent('storage',{key:'voltex:balance-revision',newValue:JSON.stringify({account:'other',nonce:'x'})}));expect(changed).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new dom.window.StorageEvent('storage',{key:'voltex:balance-revision',newValue:JSON.stringify({account:'user-a',nonce:'y'})}));expect(changed).toHaveBeenCalledTimes(2);
  stop();invalidateSpendableBalances();expect(changed).toHaveBeenCalledTimes(2);expect(calls).not.toHaveBeenCalled();
});
test('OTC error boundary never echoes arbitrary server text or database secrets',()=>{
  const {cashError,rejectedCreate}=load(resolve(frontend,'src/pages/otc/cashApi'));
  for(const text of ['postgresql://sensitive.invalid/password','<script>payload</script>','Stack trace SECRET'])expect(cashError(new Error(text))).not.toContain(text);
  expect(rejectedCreate(new ApiError(409,'INSUFFICIENT_BALANCE'))).toBe(true);
  expect(rejectedCreate(new ApiError(503,'RESULT_UNKNOWN_CHECK_ORIGINAL_KEY'))).toBe(false);
});
