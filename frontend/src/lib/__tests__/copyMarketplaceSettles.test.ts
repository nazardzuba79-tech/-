import { CopyMarketplaceStore } from '../copyMarketplaceStore';
import { summarizeStrategy } from '../../../../src/services/copyTrading/marketplaceSummary';
import { withKseniaReportedTrade } from '../../../../src/services/copyTrading/kseniaReportedTrade';
import { redactTradeHistory } from '../../../../src/services/copyTrading/tradeHistoryVisibility';
import { advanceKseniaReview, createKseniaReviewState, kseniaReviewResponse }
  from '../../../../src/services/copyTrading/canonical/kseniaReview';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { nazarPresentationResponse } from '../../../../src/services/copyTrading/nazarPresentation';
import { advanceState } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';

/**
 * A CARD MAY NEVER SIT IN «Загрузка…» FOREVER.
 *
 * «Загрузка…» means one thing: this browser has asked and has not been
 * answered yet. The moment that stops being true — for ANY reason, including
 * reasons that are not a response — the card owes the viewer a verdict:
 * real figures, or an honest unavailable state.
 *
 * `settled` is what carries that, and it was only ever set on two paths:
 * the response handler and the catch. Every OTHER way an attempt can end
 * returns early and leaves `settled` false with nothing scheduled behind it,
 * so the skeleton stays on screen until a 60s timer or a window focus
 * happens to come round — and on a page the viewer is already looking at,
 * neither may ever happen.
 *
 * These are the four ways out. Each one is a hang.
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}
/** Real sections, straight off the production path, redacted exactly as the
 *  live route redacts them — so this is the payload production serves. */
const ksenia = () => redactTradeHistory(withKseniaReportedTrade(
  summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 11))) as any));
const nazar = () => redactTradeHistory(summarizeStrategy(
  nazarPresentationResponse(advanceState(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')), 12) as any) as any));
const sections = { nazar: nazar(), ksenia: ksenia() };
const payload = () => ({ generatedAt: '2026-09-17T12:00:00Z',
  nazar: sections.nazar, ksenia: sections.ksenia, identities: null, errors: {} });
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };

it('a mount with no session yet still settles, and fetches when the token arrives', async () => {
  let clock = Date.parse('2026-09-17T12:00:00Z');
  let token: string | null = null;
  const calls: number[] = [];
  const store = new CopyMarketplaceStore(async () => { calls.push(clock); return payload(); },
    () => token, () => clock, memoryStorage());

  const unsubscribe = store.subscribe(() => {});
  await flush();
  // Nothing could be fetched — but the card must not be told "still loading"
  // for ever. With no session there is nothing coming, and that is a verdict.
  expect(store.getState().settled).toBe(true);
  expect(calls).toHaveLength(0);

  // The token arrives a moment later, as it does when auth resolves after
  // the route has already painted.
  token = 'token-a';
  clock += 200;
  store.syncSession();
  await flush(); await flush();
  expect(calls).toHaveLength(1);
  expect(store.getState().nazar).not.toBeNull();
  expect(store.getState().ksenia).not.toBeNull();
  unsubscribe();
});

it('a response voided by a session change starts a fresh attempt for the new one', async () => {
  let clock = Date.parse('2026-09-17T12:00:00Z');
  let token: string | null = 'token-a';
  let release: (v: unknown) => void = () => {};
  let attempts = 0;
  const store = new CopyMarketplaceStore(
    () => { attempts++; return new Promise(resolve => { release = resolve; }).then(() => payload()); },
    () => token, () => clock, memoryStorage());

  const unsubscribe = store.subscribe(() => {});
  await flush();
  expect(store.getState().settled).toBe(false);   // correctly waiting

  // The session changes while the request is in flight. Discarding that
  // answer is right — it belongs to someone else. What must NOT happen is
  // the new session being left with nothing in flight and a skeleton up.
  token = 'token-b';
  store.syncSession();
  release(null);
  await flush(); await flush();
  expect(attempts).toBeGreaterThan(1);
  unsubscribe();
});

it('the one-second collapse never swallows the only attempt', async () => {
  let clock = Date.parse('2026-09-17T12:00:00Z');
  const calls: number[] = [];
  const store = new CopyMarketplaceStore(async () => { calls.push(clock); return payload(); },
    () => 'token-a', () => clock, memoryStorage());

  // Two mounts in the same tick, as StrictMode does. One request, and the
  // state settles — the second mount must not be left waiting on a request
  // that the collapse declined to make.
  const a = store.subscribe(() => {});
  const b = store.subscribe(() => {});
  await flush(); await flush();
  expect(calls).toHaveLength(1);
  expect(store.getState().settled).toBe(true);
  expect(store.getState().nazar).not.toBeNull();
  a(); b();
});

it('the real redacted payload still validates, so neither card is dropped', async () => {
  let clock = Date.parse('2026-09-17T12:00:00Z');
  const store = new CopyMarketplaceStore(async () => payload(), () => 'token-a', () => clock, memoryStorage());
  await store.refresh();
  await flush();
  // This is the exact shape production serves after #141's redaction: empty
  // `trades`, a `tradeVisibility` declaration and no `reportedPerformance`.
  expect((sections.ksenia as any).trades).toEqual([]);
  expect((sections.ksenia as any).tradeVisibility.mode).toBe('HIDDEN');
  expect(store.getState().nazar).not.toBeNull();
  expect(store.getState().ksenia).not.toBeNull();
  expect(store.getState().settled).toBe(true);
});
