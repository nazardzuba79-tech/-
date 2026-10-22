import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom'), React = req('react'), { act } = React;
const flush = () => new Promise<void>(done => setImmediate(done));
let dom: any, root: any, host: HTMLElement, token: string | null, modules: Map<string, any>, listeners: Set<() => void>;
let post: jest.Mock, read: jest.Mock, changed: jest.Mock, closed: jest.Mock;
const profile = { id: 'fixture-user', email: 'fixture@example.invalid', balances: [{asset:'USDT',available:'9007199254740993.000000000000000001',locked:'25'}] };
const receipt = (key: string) => ({status:'APPLIED', operationId:key, userId:profile.id, account:'SPOT', asset:'USDT', amount:'0.000000000000000002', reason:'Correction fixture', availableBefore:profile.balances[0].available, available:'9007199254740993.000000000000000003',locked:'25'});
function load(file: string): any {
  for (const suffix of ['', '.ts', '.tsx']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,(name:string) => {
    if (name.endsWith('/api')) return { getToken:()=>token,onSessionChange:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);} };
    if (name.endsWith('/browserActivity')) return { browserFetch: jest.fn() };
    if (name.endsWith('/adminReadApi')) return {adminRead:jest.fn()};
    if (name.endsWith('/adminBalanceApi')) {
      const original = load(resolve(frontend,'src/lib/adminBalanceApi.ts'));
      return {...original,postAdminAdjustment:(...args:any[])=>post(...args),readAdminAdjustment:(...args:any[])=>read(...args)};
    }
    return name.startsWith('.')?load(resolve(dirname(file),name)):req(name);
  }); return exports;
}
async function render() { const C = load(resolve(frontend,'src/pages/admin/AdminBalanceAdjustment.tsx')).AdminBalanceAdjustment; await act(async()=>{root.render(React.createElement(C,{profile,onChanged:changed,onClose:closed}));await flush();}); }
async function click(label: RegExp) {const el=Array.from(host.querySelectorAll('button')).find(b=>label.test(b.textContent??''));expect(el).toBeTruthy();await act(async()=>{el!.click();await flush();});}
async function input(index:number,value:string) {const el=host.querySelectorAll('input,textarea')[index] as HTMLInputElement;await act(async()=>{const proto=el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await flush();});}
async function prepare() {await render();await input(1,'0.000000000000000002');await input(2,'Correction fixture');await click(/^Проверить корректировку$/);}
beforeEach(()=>{
  dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  host=document.getElementById('root')!;root=req('react-dom/client').createRoot(host);modules=new Map();listeners=new Set();token='admin';changed=jest.fn();closed=jest.fn();
  post=jest.fn(async(_id,intent)=>receipt(intent.idempotencyKey));read=jest.fn();
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();jest.useRealTimers();});
test('exact preview preserves all 18 decimals beyond Number precision',()=>{const {adjustmentPreview}=load(resolve(frontend,'src/lib/adminBalanceApi.ts'));expect(adjustmentPreview(profile.balances[0].available,'0.000000000000000002')).toBe('9007199254740993.000000000000000003');expect(adjustmentPreview('10','-3.25')).toBe('6.75');expect(adjustmentPreview('1','NaN')).toBeNull();expect(adjustmentPreview('1','1e3')).toBeNull();});
test.each([
  ['0.000000000000000002', '9007199254740993.000000000000000003'],
  ['-1', '9007199254740992.000000000000000001'],
])('padded asset uses the same existing balance for preview and submitted intent (%s)', async (delta, expected) => {
  await render(); await input(0, ' usdt '); await input(1, delta); await input(2, 'Correction fixture');
  await click(/^Проверить корректировку$/);
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain(profile.balances[0].available);
  expect(host.textContent).toContain(expected);
  expect(host.textContent).toContain('USDT · Спот');
  await click(/^Подтвердить корректировку$/);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toMatchObject({ asset: 'USDT', amount: delta });
});
test('confirmation identifies account, signed delta, reason and before/after; cancel writes nothing',async()=>{await prepare();expect(host.textContent).toContain(profile.email);expect(host.textContent).toContain('9007199254740993.000000000000000003');expect(host.textContent).toContain('+0.000000000000000002');expect(post).not.toHaveBeenCalled();await click(/^Отмена$/);expect(closed).toHaveBeenCalled();expect(post).not.toHaveBeenCalled();});
test('only explicit confirmation sends one intent and renders authoritative receipt',async()=>{await prepare();await click(/^Подтвердить корректировку$/);expect(post).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Корректировка подтверждена');expect(host.textContent).toContain('В резерве: 25');expect(changed).toHaveBeenCalledTimes(1);});
test('inflight double click sends one POST',async()=>{post.mockReturnValue(new Promise(()=>{}));await prepare();await click(/^Подтвердить корректировку$/);await click(/^Подтвердить корректировку$/);expect(post).toHaveBeenCalledTimes(1);});
test('lost response recovers by GET without a second mutation',async()=>{post.mockRejectedValue(new Error('offline'));await prepare();await click(/^Подтвердить корректировку$/);const key=post.mock.calls[0][1].idempotencyKey;expect(host.textContent).toContain('Результат не определён');read.mockResolvedValue(receipt(key));await click(/^Проверить результат$/);expect(read).toHaveBeenCalledWith(profile.id,key,expect.any(AbortSignal));expect(post).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Корректировка подтверждена');});
test('404 recovery does not create a new key; explicit retry reuses exact immutable intent',async()=>{post.mockRejectedValueOnce(new Error('lost'));await prepare();await click(/^Подтвердить корректировку$/);const intent=post.mock.calls[0][1];read.mockRejectedValue(Object.assign(new Error('not found'),{status:404}));await click(/^Проверить результат$/);await click(/^Повторить с исходным ключом$/);expect(post.mock.calls[1][1]).toEqual(intent);});
test('uncertain operation survives unmount/remount in memory with the same key',async()=>{post.mockRejectedValue(new Error('lost'));await prepare();await click(/^Подтвердить корректировку$/);const intent=post.mock.calls[0][1];await act(async()=>root.render(null));await render();expect(host.textContent).toContain(intent.idempotencyKey);await click(/^Повторить с исходным ключом$/);expect(post.mock.calls[1][1]).toEqual(intent);});
test('logout clears uncertain intent and closes private dialog',async()=>{post.mockRejectedValue(new Error('lost'));await prepare();await click(/^Подтвердить корректировку$/);const key=post.mock.calls[0][1].idempotencyKey;await act(async()=>{token=null;listeners.forEach(fn=>fn());await flush();});expect(closed).toHaveBeenCalled();await act(async()=>root.render(null));token='other-admin';await render();expect(host.textContent).not.toContain(key);expect(host.querySelector('form')).not.toBeNull();});
test('hanging mutation settles to unknown after timeout, never fabricated failure/success',async()=>{jest.useFakeTimers({doNotFake:['setImmediate']});post.mockReturnValue(new Promise(()=>{}));await prepare();await click(/^Подтвердить корректировку$/);await act(async()=>{jest.advanceTimersByTime(15001);await flush();});expect(host.textContent).toContain('Результат не определён');expect(post.mock.calls[0][2].aborted).toBe(true);expect(changed).not.toHaveBeenCalled();});
test('definitive validation refusal permits editing without claiming a credit',async()=>{post.mockRejectedValue(Object.assign(new Error('Неверная сумма'),{status:400}));await prepare();await click(/^Подтвердить корректировку$/);expect(host.querySelector('form')).not.toBeNull();expect(host.textContent).toContain('Неверная сумма');expect(changed).not.toHaveBeenCalled();});
