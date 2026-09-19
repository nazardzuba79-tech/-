import { CopyMarketplaceStore, validStrategy } from '../copyMarketplaceStore';
import { cacheKey, readSnapshot } from '../copyMarketplaceCache';
import { privateStrategyView } from '../copyMarketplacePrivacy';
import { summarizeStrategy } from '../../../../src/services/copyTrading/marketplaceSummary';
import { withKseniaReportedTrade } from '../../../../src/services/copyTrading/kseniaReportedTrade';
import { createKseniaReviewState, advanceKseniaReview, kseniaReviewResponse } from '../../../../src/services/copyTrading/canonical/kseniaReview';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { advanceState } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';
import { nazarPresentationResponse } from '../../../../src/services/copyTrading/nazarPresentation';

// Deterministic model fixtures, not production data or claims about a person.
const stamp = Date.parse('2026-09-19T12:00:00Z');
const identity = ['VX-001','VX-KSENIA'].map(traderId => ({ traderId, displayName: 'fixture',
  avatarUrl: null, avatarVersion: null, verified: false, premium: false }));
let payload: any;
beforeAll(() => {
  payload = { generatedAt: new Date(stamp).toISOString(), identities: identity, errors: {},
    nazar: summarizeStrategy(nazarPresentationResponse(advanceState(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')), 14) as any)),
    ksenia: withKseniaReportedTrade(summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(),13)))) };
}, 60000);
function memory() {
  const map = new Map<string,string>();
  return { map, getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key,value); }, removeItem: (key: string) => { map.delete(key); } };
}

test('pre-privacy cache is migrated before paint and stored trades are removed without losing aggregates', () => {
  const storage = memory();
  storage.setItem(cacheKey('A'),JSON.stringify({ ...payload, fetchedAt: { nazar:stamp, ksenia:stamp, identities:stamp } }));
  const state = new CopyMarketplaceStore(async () => payload, () => 'A', () => stamp, storage).getState();
  for (const name of ['nazar','ksenia'] as const) {
    expect(state[name]!.trades).toEqual([]);
    expect(state[name]!.tradeVisibility!.mode).toBe('HIDDEN');
    expect(state[name]!.analytics).toEqual(payload[name].analytics);
    expect(state[name]!.economics).toEqual(payload[name].economics);
    expect(state[name]).not.toHaveProperty('reportedPerformance');
    expect((readSnapshot('A',storage)![name] as any).trades).toEqual([]);
  }
  expect(state.fetchedAt.ksenia).toBe(stamp);
});

test('a validated older server response cannot re-expose trades while deployments roll', async () => {
  const store = new CopyMarketplaceStore(async () => payload, () => 'A', () => stamp, memory());
  await store.refresh();
  expect(store.getState().ksenia!.trades).toEqual([]);
  expect(store.getState().ksenia!.tradeHistoryCount).toBe(payload.ksenia.tradeHistoryCount);
  expect(validStrategy(store.getState().ksenia,'VX-KSENIA')).toBe(true);
});

test('identity-only HTTP 200 does not suppress the navigation retry', async () => {
  let now=stamp;
  let response: any={...payload,nazar:null,ksenia:null,errors:{nazar:'temporarily_unavailable',ksenia:'temporarily_unavailable'}};
  const fetcher=jest.fn(async () => response);
  const store=new CopyMarketplaceStore(fetcher,()=> 'A',()=>now,memory());
  await store.prefetch(); now+=5000; response=payload; await store.prefetch();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(store.getState().nazar).not.toBeNull();
  expect(store.getState().ksenia).not.toBeNull();
});

test('old last-good values cannot disguise a failed performance response as success', async () => {
  let now=stamp, response:any=payload;
  const fetcher=jest.fn(async () => response);
  const store=new CopyMarketplaceStore(fetcher,()=> 'A',()=>now,memory());
  await store.refresh(); now+=60000;
  response={...payload,ksenia:null,errors:{ksenia:'temporarily_unavailable'}};
  await store.refresh();
  expect(store.getState().ksenia!.analytics).toEqual(payload.ksenia.analytics);
  now+=5000; response=payload; await store.prefetch();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(store.getState().stale.ksenia).toBe(false);
});

test('a late rejected request from another session cannot alter the successful retry cooldown', async () => {
  let session='A', now=stamp, rejectOld!: (e: Error) => void;
  const fetcher=jest.fn(() => session==='A' ? new Promise((_resolve,reject)=>{rejectOld=reject;}) : Promise.resolve(payload));
  const store=new CopyMarketplaceStore(fetcher,()=>session,()=>now,memory());
  const old=store.refresh(); await Promise.resolve();
  session='B'; store.syncSession(); await store.refresh();
  rejectOld(new Error('old session')); await old;
  now+=5000; await store.prefetch();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(store.getState().diagnosis.ksenia).toBe('ok');
});

test('HIDDEN cannot accompany executable trade rows or a reported execution block', () => {
  const hidden=privateStrategyView(payload.ksenia);
  expect(validStrategy(hidden,'VX-KSENIA')).toBe(true);
  expect(validStrategy({...hidden,trades:payload.ksenia.trades},'VX-KSENIA')).toBe(false);
  expect(validStrategy({...hidden,reportedPerformance:payload.ksenia.reportedPerformance},'VX-KSENIA')).toBe(false);
});
