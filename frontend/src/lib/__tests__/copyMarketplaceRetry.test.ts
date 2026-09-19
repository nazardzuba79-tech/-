import { CopyMarketplaceStore } from '../copyMarketplaceStore';
import { summarizeStrategy } from '../../../../src/services/copyTrading/marketplaceSummary';
import { withKseniaReportedTrade } from '../../../../src/services/copyTrading/kseniaReportedTrade';
import { advanceKseniaReview, createKseniaReviewState, kseniaReviewResponse }
  from '../../../../src/services/copyTrading/canonical/kseniaReview';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { nazarPresentationResponse } from '../../../../src/services/copyTrading/nazarPresentation';
import { advanceState } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';

/**
 * WHY A FAILED ATTEMPT MUST NOT EARN A COOLDOWN.
 *
 * `prefetch()` exists so that hovering the nav link and then arriving on the
 * page is one request rather than two. It throttles on `lastAttempt`, which
 * `refresh()` stamps when an attempt STARTS — so a request that started and
 * then failed looks exactly like one that started and succeeded.
 *
 * That is what puts the owner's screenshot on the screen: the hover's request
 * fails (a blip, a 503 from one instance, a 15s timeout), the user clicks
 * through within the next thirty seconds, the page mounts, asks for data, is
 * told "you just asked" — and renders «Данные недоступны» for both traders
 * with nothing in flight behind it.
 *
 * The rule these tests pin: a SUCCESS may be reused for thirty seconds; a
 * FAILURE may not be reused at all. Mounting the page after a failed attempt
 * must always put a real request on the wire.
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}
/** Real sections, straight off the production path — never hand-built. */
const ksenia = () => withKseniaReportedTrade(
  summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 11))) as any);
const nazar = () => summarizeStrategy(
  nazarPresentationResponse(advanceState(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')), 12) as any) as any);
/** Built once: rebuilding a real history per call costs seconds, and every
 *  assertion here is about the STORE, not about the history. */
const sections = { nazar: nazar(), ksenia: ksenia() };
const payload = () => ({ generatedAt: '2026-09-17T12:00:00Z',
  nazar: sections.nazar, ksenia: sections.ksenia, identities: null, errors: {} });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

it('mounting after a failed prefetch still puts a request on the wire', async () => {
  let clock = Date.parse('2026-09-17T12:00:00Z');
  const calls: string[] = [];
  let failNext = true;
  const store = new CopyMarketplaceStore(async () => {
    calls.push(new Date(clock).toISOString());
    if (failNext) throw new Error('network');
    return payload();
  }, () => 'token-a', () => clock, memoryStorage());

  // The hover, five seconds before the click. It fails.
  await store.prefetch();
  await flush();
  expect(calls).toHaveLength(1);
  expect(store.getState().nazar).toBeNull();
  expect(store.getState().ksenia).toBeNull();

  // The click. Well inside the thirty-second prefetch window.
  clock += 5_000;
  failNext = false;
  const unsubscribe = store.subscribe(() => {});
  await flush(); await flush();

  // Before the fix this is still 1: the page mounted, asked, and was told
  // to wait — leaving both cards reading «Данные недоступны» with nothing
  // in flight. Both traders must be on screen instead.
  expect(calls).toHaveLength(2);
  expect(store.getState().nazar).not.toBeNull();
  expect(store.getState().ksenia).not.toBeNull();
  unsubscribe();
});

it('a successful attempt is still reused, so hover-then-click is one request', async () => {
  let clock = Date.parse('2026-09-17T12:00:00Z');
  const calls: string[] = [];
  const store = new CopyMarketplaceStore(async () => { calls.push('x'); return payload(); },
    () => 'token-a', () => clock, memoryStorage());

  await store.prefetch();
  await flush();
  expect(calls).toHaveLength(1);

  clock += 5_000;
  const unsubscribe = store.subscribe(() => {});
  await flush(); await flush();
  // The throttle still does its job: one bootstrap, not two.
  expect(calls).toHaveLength(1);
  expect(store.getState().nazar).not.toBeNull();
  unsubscribe();
});

it('one section failing never blanks the other, in either direction', async () => {
  let clock = Date.parse('2026-09-17T12:00:00Z');
  let body: any = payload();
  const store = new CopyMarketplaceStore(async () => body, () => 'token-a', () => clock, memoryStorage());
  await store.refresh(); await flush();
  expect(store.getState().nazar).not.toBeNull();
  expect(store.getState().ksenia).not.toBeNull();

  // Ksenia breaks. Nazar must survive untouched, with its own timestamp.
  const stampBefore = store.getState().fetchedAt.nazar;
  clock += 120_000;
  body = { ...payload(), ksenia: null, errors: { ksenia: 'temporarily_unavailable' } };
  await store.refresh(); await flush();
  expect(store.getState().ksenia).not.toBeNull();     // last-good kept
  // Nazar was refreshed in place: its own confirmation time moved forward
  // while Ksenia's did not.
  expect(store.getState().fetchedAt.nazar).toBeGreaterThan(stampBefore!);
  expect(store.getState().stale.ksenia).toBe(true);

  // And the other way round.
  clock += 120_000;
  body = { ...payload(), nazar: null, errors: { nazar: 'temporarily_unavailable' } };
  await store.refresh(); await flush();
  expect(store.getState().nazar).not.toBeNull();
  expect(store.getState().ksenia).not.toBeNull();
  expect(store.getState().stale.nazar).toBe(true);
});
