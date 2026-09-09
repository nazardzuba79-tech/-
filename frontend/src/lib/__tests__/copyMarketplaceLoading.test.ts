import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { CopyMarketplaceStore, validStrategy, type CopyMarketplaceResponse } from '../copyMarketplaceStore';
import { kseniaTrader, kseniaTraderShell } from '../kseniaCopyTrading';
import { syntheticNazaraTrader } from '../syntheticCopyTrading';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { nazarPresentationResponse } from '../../../../src/services/copyTrading/nazarPresentation';
import { createKseniaReviewState, kseniaReviewResponse } from '../../../../src/services/copyTrading/canonical/kseniaReview';

let response: CopyMarketplaceResponse;
beforeAll(() => {
  response = {
    nazar: nazarPresentationResponse(createReviewSyntheticState(new Date('2026-09-06T12:00:00Z'))),
    ksenia: kseniaReviewResponse(createKseniaReviewState()),
    identities: [
      { traderId: 'VX-001', displayName: 'Nazar', avatarUrl: null, avatarVersion: null, verified: false, premium: true },
      { traderId: 'VX-KSENIA', displayName: 'Ksenia', avatarUrl: null, avatarVersion: null, verified: false, premium: true },
    ], generatedAt: '2026-09-06T12:00:00Z', errors: {},
  };
});
function setup() {
  let time = Date.parse('2026-09-06T12:00:00Z');
  let token: string | null = 'session-a';
  const fetcher = jest.fn(async (_signal: AbortSignal): Promise<unknown> => response);
  const store = new CopyMarketplaceStore(fetcher, () => token, () => time);
  return { store, fetcher, advance: (ms = 2000) => { time += ms; }, token: (value: string | null) => { token = value; } };
}

test('both canonical strategy responses pass validation without mutation', () => {
  const before = JSON.stringify(response);
  expect(validStrategy(response.nazar, 'VX-001')).toBe(true);
  expect(validStrategy(response.ksenia, 'VX-KSENIA')).toBe(true);
  expect(validStrategy(response.ksenia, 'VX-001')).toBe(false);
  expect(JSON.stringify(response)).toBe(before);
});
test('Ksenia shell has safe identity and no invented economics', () => {
  expect(kseniaTraderShell).toMatchObject({ id:'VX-KSENIA',name:'Ksenia',strategy:'Multi-Asset Strategy',initials:'K',identityVerified:false,ownerAvatarUrl:null });
  for (const field of ['roi7','roi30','roi90','roiAll','winRate','drawdown','copiers','aum','volume','activeMonths','performanceFee'] as const)
    expect(Number.isNaN(kseniaTraderShell[field])).toBe(true);
});
test('successful bootstrap populates both strategies once', async () => {
  const { store, fetcher } = setup();
  expect(store.getState().nazar).toBeNull();
  await store.refresh();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(store.getState()).toMatchObject({ nazar:response.nazar,ksenia:response.ksenia,refreshing:false,settled:true,stale:{nazar:false,ksenia:false,identities:false} });
});
test.each(['nazar','ksenia','identities'] as const)('%s partial failure keeps peers and last-good data', async section => {
  const { store, fetcher, advance } = setup();
  await store.refresh(); const previous = store.getState(); advance();
  fetcher.mockResolvedValue({ ...response,[section]:null,errors:{[section]:'temporarily_unavailable'} });
  await store.refresh(); const next = store.getState();
  expect(next[section]).toBe(previous[section]);
  expect(next.fetchedAt[section]).toBe(previous.fetchedAt[section]);
  expect(next.stale[section]).toBe(true);
  for (const peer of (['nazar','ksenia','identities'] as const).filter(key=>key!==section)) expect(next.stale[peer]).toBe(false);
});
test.each([false,true])('total failure with prior data=%s never supplies fake zeros', async loaded => {
  const { store, fetcher, advance } = setup();
  if (loaded) await store.refresh();
  const previous = store.getState(); advance(); fetcher.mockRejectedValue(new Error('HTTP 500'));
  await store.refresh();
  expect(store.getState()).toMatchObject({ nazar:previous.nazar,ksenia:previous.ksenia,identities:previous.identities,stale:{nazar:true,ksenia:true,identities:true} });
});
test('slow refresh retains figures throughout and 100 callers share one fetch', async () => {
  const { store, fetcher, advance } = setup();
  await store.refresh(); advance(); const previous = store.getState();
  let release!: (value: unknown) => void;
  fetcher.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const requests = Array.from({length:100},()=>store.refresh()); await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(store.getState().refreshing).toBe(true);
  expect(store.getState().nazar).toBe(previous.nazar); expect(store.getState().ksenia).toBe(previous.ksenia);
  release(response); await Promise.all(requests);
  expect(store.getState().refreshing).toBe(false);
});
test.each([null,{},[],{generatedAt:'bad'},{...{generatedAt:'2026-09-06'},nazar:[],ksenia:{analytics:{}},identities:'invalid'}])('malformed bootstrap %p preserves last-good sections', async invalid => {
  const { store, fetcher, advance } = setup(); await store.refresh(); const previous = store.getState(); advance();
  fetcher.mockResolvedValue(invalid); await store.refresh();
  expect(store.getState().nazar).toBe(previous.nazar); expect(store.getState().ksenia).toBe(previous.ksenia);
});
test.each(['analytics','economics','trades','dailyResults','followers','equityHistory'])('malformed %s is rejected before rendering', field => {
  expect(validStrategy({...response.ksenia,[field]:null},'VX-KSENIA')).toBe(false);
});
test('a real zero is valid; a null or missing ROI is unavailable', async () => {
  const zero = {...response.ksenia!,analytics:{...response.ksenia!.analytics,roi90:0},economics:{...response.ksenia!.economics!,periods:{...response.ksenia!.economics!.periods,'90D':{...response.ksenia!.economics!.periods['90D'],roi:0}}}};
  expect(validStrategy(zero,'VX-KSENIA')).toBe(true); expect(kseniaTrader(zero).roi90).toBe(0);
  expect(validStrategy({...zero,analytics:{...zero.analytics,roi90:null}},'VX-KSENIA')).toBe(false);
});
test('identity revalidation updates avatar/KYC in place without changing economics', async () => {
  const { store, fetcher, advance } = setup(); await store.refresh(); const first=store.getState(); advance();
  fetcher.mockResolvedValue({...response,identities:[response.identities![0],{...response.identities![1],verified:true,avatarUrl:'data:image/png;base64,YQ==',avatarVersion:'v2'}]});
  await store.refresh(); const next=store.getState();
  expect(next.ksenia).toBe(first.ksenia);
  expect(kseniaTrader(next.ksenia,next.identities[1])).toMatchObject({id:'VX-KSENIA',identityVerified:true,ownerAvatarUrl:'data:image/png;base64,YQ=='});
});
test('new login clears memory and ignores the previous login response', async () => {
  const { store, fetcher, token } = setup(); let release!: (value: unknown) => void;
  fetcher.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  const pending=store.refresh(); await Promise.resolve(); token('session-b');
  expect(store.getState().nazar).toBeNull(); release(response); await pending;
  expect(store.getState().nazar).toBeNull();
});
test('return visit renders last-good synchronously and revalidates; no unused timers', async () => {
  jest.useFakeTimers();
  try {
    const { store, fetcher, advance }=setup(); const first=store.subscribe(()=>{}); await store.refresh(); first(); advance();
    expect(jest.getTimerCount()).toBe(0); expect(store.getState().ksenia).toBe(response.ksenia);
    const second=store.subscribe(()=>{}); await store.refresh(); expect(fetcher).toHaveBeenCalledTimes(2); second();
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
test('stale day/identity timestamps are honest before revalidation finishes', async () => {
  const { store, advance }=setup(); await store.refresh(); advance(86_400_000);
  expect(store.getState().stale).toEqual({nazar:true,ksenia:true,identities:true});
  expect(store.getState().ksenia).toBe(response.ksenia);
});
test('prefetch is opt-in, deduplicated, and creates no polling timer', async () => {
  jest.useFakeTimers();
  try {
    const { store,fetcher,advance }=setup(); expect(fetcher).not.toHaveBeenCalled();
    await Promise.all([store.prefetch(),store.prefetch(),store.refresh()]); expect(fetcher).toHaveBeenCalledTimes(1);
    advance(5000); await store.prefetch(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

// Render the real TSX components, including chart/metric presentation. Only
// account hooks and site chrome are isolated; no marketplace output is mocked.
const frontend=resolve(__dirname,'../../..');
const req=createRequire(resolve(frontend,'package.json'));
const React=req('react'); const {renderToStaticMarkup}=req('react-dom/server');
function renderer() {
  const cache=new Map<string,any>();
  function load(file:string):any {
    if(cache.has(file)) return cache.get(file);
    const output:any={}; cache.set(file,output);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const local=(name:string):any=>{
      if(name.endsWith('.css')) return {};
      if(name.endsWith('/useCopyLists')) return {useFavorites:()=>({favorites:new Set(),toggleFavorite:()=>{}}),useFollowing:()=>({following:new Set(),toggleFollowing:()=>{}})};
      if(name.endsWith('/FeaturedAvatarContext')) return {useFeaturedAvatar:()=>null,FeaturedAvatarProvider:({children}:any)=>children};
      if(name.endsWith('/CopyDepositDialog')) return {CopyDepositDialog:()=>null};
      if(!name.startsWith('.')) return req(name);
      const base=resolve(dirname(file),name); const target=['.ts','.tsx'].map(ext=>base+ext).find(existsSync);
      if(!target) throw Error('Unresolved test import '+base);
      return load(target);
    };
    new Function('exports','require',code)(output,local); return output;
  }
  return { ...load(resolve(frontend,'src/pages/copy-trading-bolt/components.tsx')),
    EligibilityProvider: load(resolve(frontend,'src/pages/copy-trading-bolt/CopyEligibilityContext.tsx')).CopyEligibilityProvider };
}
const components=renderer();
const markup=(node:unknown)=>renderToStaticMarkup(React.createElement(components.EligibilityProvider,{depositUsd:9999.99},node));
const roster=(html:string)=>[...html.matchAll(/data-trader-id="([^"]+)"/g)].map(match=>match[1]);
test('real first render has Nazar and Ksenia in final roster positions; completion inserts no card',()=>{
  const before=markup(React.createElement(components.Marketplace,{onOpen:()=>{}}));
  const after=markup(React.createElement(components.Marketplace,{onOpen:()=>{},nazara:syntheticNazaraTrader(response.nazar),synthetic:response.nazar,ksenia:kseniaTrader(response.ksenia),kseniaSynthetic:response.ksenia}));
  expect(roster(before).slice(0,2)).toEqual(['VX-001','VX-KSENIA']);
  expect(roster(before)).toEqual(roster(after)); expect(roster(before)).toHaveLength(16);
  const card=before.split('data-trader-id="VX-KSENIA"')[1].split('</article>')[0];
  expect(card).toContain('Ksenia'); expect(card).toContain('—');
  expect(card).not.toMatch(/NaN|0\.00%|0 подписчиков|0 закрытых/);
  expect(card).toContain('disabled=""');
});
test('opening a pending Ksenia profile never generates catalogue trades or risk metrics',()=>{
  const html=markup(React.createElement(components.Profile,{trader:kseniaTraderShell,onBack:()=>{}}));
  expect(html).toContain('Ksenia'); expect(html).toContain('—');
  expect(html).not.toMatch(/NaN|Infinity|0\.00%|BTC · ETH · SOL/);
});
