from pathlib import Path
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
def replace(path,old,new):
 p=root/path;s=p.read_text();assert s.count(old)==1,(path,old[:70],s.count(old));p.write_text(s.replace(old,new))
helper='''import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';

/** Defense at the display boundary for a validated pre-privacy response or
 * warm cache. Server redaction remains mandatory; this cannot retract data
 * already delivered by an older release. Aggregates and provenance stay intact.
 * Call ONLY after validStrategy succeeds, never to excuse malformed input. */
export function privateStrategyView<T extends SyntheticCopyTradingResponse>(value: T): T {
  if (!['VX-001', 'VX-KSENIA'].includes(value.trader.id)) return value;
  const periods = ['7D', '30D', '90D', 'ALL'] as const;
  const output = { ...value, trades: [], tradeVisibility: {
    mode: 'HIDDEN' as const,
    reason: 'OWNER_RESTRICTED' as const,
    holdingTimeUnknownPeriods: periods.filter(period =>
      value.tradeStats?.[period]?.holdingTimeTotalMinutes === undefined),
  } };
  delete (output as T & { reportedPerformance?: unknown }).reportedPerformance;
  return output;
}
'''
(root/'frontend/src/lib/copyMarketplacePrivacy.ts').write_text(helper)
p='frontend/src/lib/copyMarketplaceStore.ts'
replace(p,"import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';", "import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';\nimport { privateStrategyView } from './copyMarketplacePrivacy';")
replace(p,"  const visibleTrades = Array.isArray(value.trades)\n", "  const visibleTrades = Array.isArray(value.trades)\n    && (!hidden || (value.trades.length === 0 && value.reportedPerformance === undefined))\n")
replace(p,'state.nazar = snapshot.nazar as SyntheticCopyTradingResponse;', 'state.nazar = privateStrategyView(snapshot.nazar as SyntheticCopyTradingResponse);')
replace(p,'state.ksenia = snapshot.ksenia as KseniaResponse;', 'state.ksenia = privateStrategyView(snapshot.ksenia as KseniaResponse);')
replace(p,"      state.diagnosis.identities = 'ok';\n    }\n    return state;", "      state.diagnosis.identities = 'ok';\n    }\n    // Upgrade this session's warm cache without losing confirmed figures.\n    // Never let a previous release re-expose trades while the API is down.\n    if (state.nazar || state.ksenia || state.identities.length) writeSnapshot(session, {\n      nazar: state.nazar, ksenia: state.ksenia,\n      identities: state.identities.length ? state.identities : null, fetchedAt: state.fetchedAt,\n    }, this.storage);\n    return state;")
replace(p,"else if (section === 'nazar') next.nazar = value;\n          else next.ksenia = value;", "else if (section === 'nazar') next.nazar = privateStrategyView(value);\n          else next.ksenia = privateStrategyView(value);")
replace(p,"      // Delivered. Worth reusing for the prefetch window — but only if at\n      // least one section actually came back usable; a 200 whose every\n      // section was rejected is a failure wearing a success's clothes.\n      this.lastAttemptFailed = !next.nazar && !next.ksenia && !next.identities.length;", "      // A successful identity lookup or an old warm value is not a successful\n      // performance refresh. Either missing strategy must remain retryable.\n      this.lastAttemptFailed = next.stale.nazar || next.stale.ksenia;")
replace(p,"    }).catch((error: unknown) => {\n      this.lastAttemptFailed = true;", "    }).catch((error: unknown) => {\n      // A late rejection from an old login may not mutate this login's retry state.\n      if (generation !== this.generation || this.getSession() !== this.session) return;\n      this.lastAttemptFailed = true;")
p='frontend/src/lib/useCopyMarketplace.ts'
replace(p,"    clearToken();\n    if (typeof window !== 'undefined') window.location.href = '/';", "    // This request belongs to the captured session, not a later login.\n    if (!signal.aborted && getToken() === token) {\n      clearToken();\n      if (typeof window !== 'undefined') window.location.href = '/';\n    }")
tests='''import { CopyMarketplaceStore, validStrategy } from '../copyMarketplaceStore';
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
'''
(root/'frontend/src/lib/__tests__/copyMarketplaceReview.test.ts').write_text(tests)
p='.github/workflows/copy-trading-card-regression.yml'
replace(p,"      - name: Frontend dependencies", "      - name: Copy privacy, retry and period regressions\n        run: >-\n          npm test -- --runInBand --runTestsByPath\n          src/services/copyTrading/__tests__/tradeHistoryVisibility.test.ts\n          src/services/copyTrading/__tests__/kseniaReportedWeek.test.ts\n          frontend/src/lib/__tests__/copyMarketplaceReview.test.ts\n          frontend/src/lib/__tests__/copyMarketplaceRetry.test.ts\n          frontend/src/lib/__tests__/copyMarketplaceCache.test.ts\n          frontend/src/lib/__tests__/copyMarketplacePayload.test.ts\n      - name: Frontend dependencies")
replace(p,"      - name: Preserve browser evidence", "      - name: Browser QA - cards, hidden trades and avatar ring\n        env:\n          QA_PLAYWRIGHT_MODULE: /tmp/voltex-copy-qa/node_modules/playwright\n        run: node scripts/qa-copy-cards-trades-avatar.cjs\n      - name: Preserve browser evidence")
replace(p,'          path: docs/qa/copy-last-good-browser/', '          path: |\n            docs/qa/copy-last-good-browser/\n            docs/qa/copy-cards-trades-avatar/')
print('Applied five narrowly-scoped review files')
