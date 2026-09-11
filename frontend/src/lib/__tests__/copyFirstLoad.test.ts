import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { CopyMarketplaceStore } from '../copyMarketplaceStore';
import { summarizeStrategy } from '../../../../src/services/copyTrading/marketplaceSummary';
import { CopyPerformanceService } from '../../../../src/services/copyTrading/CopyPerformanceService';

const frontend = resolve(__dirname, '../../..');
// Optional pristine checkout for discrimination runs; dependencies and this
// test stay identical. Normal CI always uses the current source tree.
const sourceRoot = process.env.COPY_FIRST_LOAD_SOURCE || frontend;
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const { createRoot } = req('react-dom/client');
let dom: any, root: any, host: HTMLElement, store: CopyMarketplaceStore;
let resolvePayload: (value: unknown) => void;
let rejectPayload: (reason: Error) => void;
let request: jest.Mock;
let clock = Date.parse('2026-09-11T12:00:00Z');
let session: string | null = 'viewer-a';
let payload: any;

// Evaluate the real page and all its local children with real React hooks and
// reconciliation. Only unrelated chrome/account reads and the transport seam
// are substituted. The marketplace validator/store/projections are real.
const cache = new Map<string, any>();
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (cache.has(file)) return cache.get(file);
  const exports: any = {}; cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions:{
    jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS,
  }}).outputText;
  const requireFrom = (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/Nav')) return {Nav:() => null};
    if (name.endsWith('/Footer')) return {Footer:() => null};
    if (name === 'sonner') return {Toaster:() => null, toast:{success:jest.fn()}};
    if (name.endsWith('/api')) return {getToken:() => session, api:{getPortfolioHistory:async () => ({points:[]})}};
    if (name.endsWith('/useCopyMarketplace')) return {useCopyMarketplace:() => React.useSyncExternalStore(store.subscribe,store.getState,store.getState)};
    return name.startsWith('.') ? load(resolve(dirname(file),name)) : req(name);
  };
  new Function('exports','require',code)(exports,requireFrom);
  return exports;
}
let Page: any;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const mount = () => act(async () => { root.render(React.createElement(React.StrictMode,null,React.createElement(Page))); await flush(); });
const settle = () => act(async () => { resolvePayload(payload); await flush(); });
const card = (id:string) => host.querySelector(`[data-trader-id="${id}"]`)!;
const order = () => Array.from(host.querySelectorAll('[data-trader-id]')).map(el => el.getAttribute('data-trader-id'));

beforeAll(async () => {
  const rows = new Map();
  const db = {copyPerformanceScenario:{
    findUnique:async ({where}:any) => rows.get(where.id) || null,
    create:async ({data}:any) => {const row={...data,revision:0};rows.set(data.id,row);return row;},
  }};
  const service = new CopyPerformanceService(db as never,() => new Date(clock));
  const [nazar,ksenia] = await Promise.all([service.get('nazar'),service.get('ksenia')]);
  payload = {nazar:summarizeStrategy(nazar),ksenia:summarizeStrategy(ksenia),identities:[null,null],generatedAt:new Date(clock).toISOString(),errors:{}};
  Page = load(resolve(sourceRoot,'src/pages/CopyTradingPage.tsx')).CopyTradingPage;
},30000);
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/copy-trading'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.scrollTo = jest.fn();
  session='viewer-a'; clock=Date.parse('2026-09-11T12:00:00Z');
  request=jest.fn((signal:AbortSignal) => new Promise((resolve,reject) => {
    resolvePayload=resolve;rejectPayload=reject;
    signal.addEventListener('abort',() => reject(new Error('aborted')),{once:true});
  }));
  const Store = sourceRoot === frontend ? CopyMarketplaceStore : load(resolve(sourceRoot,'src/lib/copyMarketplaceStore.ts')).CopyMarketplaceStore;
  store = new Store(request,() => session,() => clock);
  host=document.getElementById('root')!; root=createRoot(host);
});
afterEach(async () => {
  await act(async () => {root.unmount();session=null;store.getState();});
  dom.window.close();
});

test('first commit contains both shells, reserved positions and honest skeleton metrics',async () => {
  await mount();
  expect(request).toHaveBeenCalledTimes(1);
  expect(order().slice(0,2)).toEqual(['VX-001','VX-KSENIA']);
  expect(order()).toHaveLength(16);
  for(const id of ['VX-001','VX-KSENIA']) {
    const node=card(id);
    expect(node.querySelector('h3')!.textContent).toBe(id==='VX-001'?'Nazar':'Ksenia');
    expect(node.querySelector('.nazara-strategy')).not.toBeNull();
    expect(node.querySelectorAll('[data-unavailable]')).toHaveLength(id==='VX-001'?5:6);
    expect(node.textContent).not.toMatch(/NaN|\b0(?:[.,]0+)?%|\$0\b/);
    expect(node.querySelector('.copy-chart-skeleton')).not.toBeNull();
  }
});
test('response hydrates the existing sixteen cards without duplicates or ordering changes',async () => {
  await mount();
  const nodes=Array.from(host.querySelectorAll('[data-trader-id]'));const before=order();
  await settle();
  expect(order()).toEqual(before);
  expect(new Set(order()).size).toBe(16);
  nodes.forEach((node,index) => expect(host.querySelectorAll('[data-trader-id]')[index]).toBe(node));
  for(const id of ['VX-001','VX-KSENIA']) {
    expect(card(id).querySelectorAll('[data-unavailable]')).toHaveLength(0);
    expect(card(id).querySelector('.mini-chart-line')).not.toBeNull();
  }
  expect(request).toHaveBeenCalledTimes(1);
});
test.each(['VX-001','VX-KSENIA'])('%s profile opens before API response and hydrates without remount/scroll reset',async id => {
  await mount();
  await act(async () => (card(id).querySelector('.card-view-button') as HTMLButtonElement).click());
  const profile=host.querySelector('.trader-profile-page');
  expect(profile).not.toBeNull();
  expect(profile!.querySelector('h1')!.textContent).toBe(id==='VX-001'?'Nazar':'Ksenia');
  expect(profile!.querySelectorAll('[data-unavailable]').length).toBeGreaterThan(10);
  expect(profile!.textContent).not.toContain('NaN');
  const rows=profile!.querySelectorAll('.profile-metrics-grid > div').length;
  const header=profile!.querySelector('.trader-profile-hero');
  expect(dom.window.scrollTo).toHaveBeenCalledTimes(1);
  await settle();
  expect(host.querySelector('.trader-profile-page')).toBe(profile);
  expect(profile!.querySelector('.trader-profile-hero')).toBe(header);
  expect(profile!.querySelectorAll('.profile-metrics-grid > div')).toHaveLength(rows);
  expect(profile!.querySelector('.profile-chart-line')).not.toBeNull();
  expect(dom.window.scrollTo).toHaveBeenCalledTimes(1);
});
test('prefetch plus StrictMode route mount joins one in-flight request',async () => {
  void store.prefetch(); await flush(); await mount(); await settle();
  expect(request).toHaveBeenCalledTimes(1);
});
test('a COMPLETED prefetch is reused when the route mounts five seconds later',async () => {
  void store.prefetch();await flush();resolvePayload(payload);await flush();clock+=5000;
  await mount();expect(request).toHaveBeenCalledTimes(1);
  expect(card('VX-001').querySelector('.mini-chart-line')).not.toBeNull();
});
test('failed bootstrap keeps both cards honest and profiles openable',async () => {
  await mount();await act(async () => {rejectPayload(new Error('offline'));await flush();});
  expect(order().slice(0,2)).toEqual(['VX-001','VX-KSENIA']);
  expect(card('VX-001').textContent).not.toContain('NaN');
  expect(card('VX-KSENIA').querySelector('[data-unavailable]')).not.toBeNull();
  expect(store.getState().stale).toEqual({nazar:true,ksenia:true,identities:true});
  await act(async () => (card('VX-KSENIA').querySelector('.card-view-button') as HTMLButtonElement).click());
  expect(host.querySelector('h1')!.textContent).toBe('Ksenia');
});
test('new session cannot hydrate from a pending old session response',async () => {
  const old=store.prefetch();await flush();const oldResolve=resolvePayload;
  session='viewer-b';const next=store.prefetch();await flush();
  oldResolve(payload);await old;
  expect(store.getState().nazar).toBeNull();
  resolvePayload({...payload,nazar:null,ksenia:null,errors:{nazar:'unavailable',ksenia:'unavailable'}});await next;
  expect(store.getState().nazar).toBeNull();expect(request).toHaveBeenCalledTimes(2);
});
test('refresh retains last-good sections and still revalidates at 60 seconds',async () => {
  await mount();await settle();const last=store.getState().nazar;
  clock+=60000;
  await act(async () => {
    const refresh=store.refresh();await flush();
    resolvePayload({...payload,nazar:null,errors:{nazar:'unavailable'}});await refresh;
  });
  expect(request).toHaveBeenCalledTimes(2);expect(store.getState().nazar).toBe(last);
  expect(store.getState().stale.nazar).toBe(true);expect(store.getState().stale.ksenia).toBe(false);
});
test('direct entry, lazy route and both nav surfaces start the shared prefetch',() => {
  const main=readFileSync(resolve(frontend,'src/main.tsx'),'utf8');
  expect(main.indexOf('prefetchCopyMarketplace();')).toBeLessThan(main.indexOf('ReactDOM.createRoot'));
  expect(main).toContain("=== '/copy-trading'");
  const app=readFileSync(resolve(frontend,'src/App.tsx'),'utf8');
  expect(app).toMatch(/const CopyTradingPage = lazy\(\(\) => \{[\s\S]*?prefetchCopyMarketplace\(\);[\s\S]*?return import\('\.\/pages\/CopyTradingPage'\)/);
  const nav=readFileSync(resolve(frontend,'src/components/Nav.tsx'),'utf8');
  for(const event of ['onMouseEnter','onFocus','onPointerDown']) expect(nav.match(new RegExp(event+"=\\{l.to === '/copy-trading'",'g'))).toHaveLength(2);
});
test('owner image overlays initials only after successful decode',async () => {
  await mount();
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=';
  await act(async () => {
    resolvePayload({...payload,identities:[{traderId:'VX-001',displayName:'Nazar',avatarUrl:photo,avatarVersion:'test',verified:false,premium:true},null]});await flush();
  });
  const image=card('VX-001').querySelector('img') as HTMLImageElement;
  let decoded!:()=>void;
  image.decode=jest.fn(() => new Promise<void>(resolve => {decoded=resolve;}));
  await act(async () => image.dispatchEvent(new dom.window.Event('load')));
  expect(image.style.opacity).toBe('0');
  expect(card('VX-001').querySelector('.avatar-stack')!.textContent).toContain('N');
  await act(async () => {decoded();await flush();});
  expect(image.style.opacity).toBe('1');
});
