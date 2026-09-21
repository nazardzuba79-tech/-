import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { CopyMarketplaceStore, validStrategy, type CopyMarketplaceState } from '../copyMarketplaceStore';
import { cacheKey } from '../copyMarketplaceCache';
import { summarizeStrategy } from '../../../../src/services/copyTrading/marketplaceSummary';
import { withKseniaReportedTrade } from '../../../../src/services/copyTrading/kseniaReportedTrade';
import { withKseniaReportedWeek, KSENIA_REPORTED_WEEK } from '../../../../src/services/copyTrading/kseniaReportedWeek';
import { redactTradeHistory } from '../../../../src/services/copyTrading/tradeHistoryVisibility';
import { advanceKseniaReview, createKseniaReviewState, kseniaReviewResponse }
  from '../../../../src/services/copyTrading/canonical/kseniaReview';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { nazarPresentationResponse } from '../../../../src/services/copyTrading/nazarPresentation';
import { advanceState } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';

/**
 * THE COPY TRADING CRITICAL PATH — NAZAR (VX-001) AND KSENIA (VX-KSENIA).
 *
 * Every other Copy Trading suite pins one behaviour each. This one exists to
 * make a CLASS of failure impossible to merge, and it is deliberately the
 * shortest, most boring file that can do that. If a future change leaves
 * either trader in an eternal «Загрузка…», loses their figures, breaks the
 * session transition, breaks the redacted payload, unpins the owner-reported
 * weekly result, reveals withheld trades, prints a fabricated zero, or lets
 * one session read another's data, one of the cases below turns red.
 *
 * THE MACHINE-ENFORCED PART. Cases come and go; `noEternalLoading` is the
 * rule they all carry. It is not a assertion about one scenario — it is a
 * closed statement about the store:
 *
 *     settled === false  =>  a real request is in flight
 *     no request in flight  =>  settled === true
 *
 * checked at QUIESCENCE — after every microtask and every zero-delay timer
 * has run, but BEFORE any clock is advanced. That last part is the whole
 * point. The hang this file guards against was never permanent in the
 * mathematical sense: a sixty-second poll or a window focus would eventually
 * rescue it. On a page the viewer is already looking at, neither may ever
 * come, and sixty seconds of skeleton over data the browser already has is
 * the bug. So the invariant is checked with the clock held still: whatever
 * ends an attempt must settle the state itself, not leave it for a timer.
 *
 * Nothing here is hand-built. Both sections come off the REAL backend path —
 * the same `summarizeStrategy` → Ksenia overlays → `redactTradeHistory`
 * chain that src/api/routes/copyPerformance.ts serves — so a payload change
 * on the server breaks these tests rather than the production card.
 */

const REAL = new Date('2026-09-17T12:00:00Z').getTime();
const SESSION_A = 'session-token-a';
const SESSION_B = 'session-token-b';

/** The two sections exactly as the marketplace route emits them. Built once:
 *  replaying a real history costs seconds and none of these cases is about
 *  the history. */
const SECTIONS = {
  nazar: redactTradeHistory(summarizeStrategy(
    nazarPresentationResponse(advanceState(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')), 12) as any) as any)),
  ksenia: redactTradeHistory(withKseniaReportedWeek(withKseniaReportedTrade(
    summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 11))) as any) as any) as any),
};
const payload = (over: Record<string, unknown> = {}) => ({
  generatedAt: '2026-09-17T12:00:00Z', nazar: SECTIONS.nazar, ksenia: SECTIONS.ksenia,
  identities: null, errors: {}, ...over,
});

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}

type Responder = (signal: AbortSignal, call: number) => Promise<unknown>;

/**
 * A store with a countable wire.
 *
 * `inFlight` is incremented the moment the fetcher is ENTERED and decremented
 * when it settles, however it settles, so it answers exactly the question the
 * invariant asks: is there a real request behind this skeleton?
 */
function harness(respond: Responder, opts: { session?: () => string | null; clock?: () => number } = {}) {
  const storage = memoryStorage();
  const probe = { inFlight: 0, calls: 0 };
  let clock = REAL;
  const now = opts.clock ?? (() => clock);
  const store = new CopyMarketplaceStore(async (signal: AbortSignal) => {
    probe.inFlight++; probe.calls++;
    try { return await respond(signal, probe.calls); } finally { probe.inFlight--; }
  }, opts.session ?? (() => SESSION_A), now, storage);
  return {
    store, probe, storage,
    advanceClock: (ms: number) => { clock += ms; },
    get clock() { return clock; },
  };
}

/** Drain everything that can run WITHOUT the clock moving. */
async function quiesce() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
  }
}

/**
 * INVARIANT 1, as a single callable rule.
 *
 * Throwing rather than `expect`-ing is on purpose: the message has to name
 * the step, because whoever hits this in CI is looking at a state machine
 * with a dozen exits and needs to know which one leaked.
 */
async function noEternalLoading(h: ReturnType<typeof harness>, step: string): Promise<CopyMarketplaceState> {
  await quiesce();
  const state = h.store.getState();
  if (!state.settled && h.probe.inFlight === 0) {
    throw new Error(`INVARIANT 1 — ETERNAL LOADING at "${step}": the store reports settled=false `
      + `with nothing on the wire. Whatever ended that attempt must settle the state itself; a card `
      + `may not wait for the 60s poll or a window focus to be told the truth. `
      + `diagnosis=${JSON.stringify(state.diagnosis)} refreshing=${state.refreshing}`);
  }
  return state;
}

/** A request that only ever ends by being abandoned. */
const hang: Responder = (signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
  signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

// ── 1–4  THE PAYLOAD CONTRACT ────────────────────────────────────────────────
// The exact production response shape, validated by the exact production
// validator. These four are what make a backend change break here first.

it('1 — the production Nazar section validates as VX-001', () => {
  expect(validStrategy(SECTIONS.nazar, 'VX-001')).toBe(true);
  // Not merely "an object": the figures the card reads must be real numbers,
  // never a fabricated zero standing in for an unknown. See invariant 8.
  const analytics = (SECTIONS.nazar as any).analytics;
  for (const key of ['roi7', 'roi30', 'roi90', 'roiAll', 'winRate', 'aum', 'activeFollowers']) {
    expect(Number.isFinite(analytics[key])).toBe(true);
  }
  expect(validStrategy(SECTIONS.nazar, 'VX-KSENIA')).toBe(false); // never the other trader's card
});

it('2 — the production Ksenia section validates as VX-KSENIA', () => {
  expect(validStrategy(SECTIONS.ksenia, 'VX-KSENIA')).toBe(true);
  expect(validStrategy(SECTIONS.ksenia, 'VX-001')).toBe(false);
  expect((SECTIONS.ksenia as any).provenance).toBe('SYNTHETIC_REVIEW');
});

it('3 — a redacted payload with the executions withheld is legitimate, not malformed', () => {
  for (const [id, section] of [['VX-001', SECTIONS.nazar], ['VX-KSENIA', SECTIONS.ksenia]] as const) {
    const s = section as any;
    // The policy of #141: the rows are gone, the DECLARATION is present, and
    // the real total survives — «скрыто» is not «ноль сделок».
    expect(s.trades).toEqual([]);
    expect(s.tradeVisibility).toMatchObject({ mode: 'HIDDEN', reason: 'OWNER_RESTRICTED' });
    expect(s.tradeHistoryCount).toBeGreaterThan(0);
    expect(s.tradeStats.ALL.totalTrades).toBe(s.tradeHistoryCount);
    expect(validStrategy(section, id)).toBe(true);
  }
  // A payload that lost its rows WITHOUT declaring it is still rejected: the
  // declaration is what separates policy from a truncated response.
  const undeclared = { ...(SECTIONS.nazar as any) };
  delete undeclared.tradeVisibility;
  expect(validStrategy(undeclared, 'VX-001')).toBe(false);
});

it('4 — the owner-reported weekly result is 61.9%, from one place only', () => {
  expect(KSENIA_REPORTED_WEEK.returnPct).toBe(61.9);
  expect(KSENIA_REPORTED_WEEK.source).toBe('OWNER_REPORTED');
  // It reaches the card through the payload, not through a component's own copy.
  const k = SECTIONS.ksenia as any;
  expect(k.analytics.roi7).toBe(61.9);
  expect(k.economics.periods['7D'].roi).toBe(61.9);
  expect(k.reportedWeeks?.[0]?.returnPct).toBe(61.9);

  // ONE VALUE, ONE PLACE. A second hardcoded production copy is the way this
  // number drifts, so a second one fails here. Tests, QA harnesses and docs
  // may name it freely — they are where it is checked, not where it lives.
  const roots = [resolve(__dirname, '../../../../src'), resolve(__dirname, '../../../src')];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
        walk(path); continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      if (path.endsWith(`${'kseniaReportedWeek'}.ts`)) continue; // the source of truth itself
      if (/\b61\.9\b/.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };
  roots.forEach(walk);
  expect(offenders).toEqual([]);
});

// ── 5–15  THE STATE MACHINE ──────────────────────────────────────────────────
// Every case below carries `noEternalLoading` at each step, so case 15 is not
// a separate test so much as the rule the other ten are audited against.

it('5 — cold load: one request, real figures, settled', async () => {
  const h = harness(async () => payload());
  const stop = h.store.subscribe(() => {});
  const state = await noEternalLoading(h, 'cold load');
  expect(h.probe.calls).toBe(1);
  expect(state.settled).toBe(true);
  expect(state.diagnosis).toEqual({ nazar: 'ok', ksenia: 'ok', identities: 'rejected_by_client' });
  expect(state.nazar!.analytics.roi7).toBeCloseTo((SECTIONS.nazar as any).analytics.roi7, 6);
  expect(state.ksenia!.analytics.roi7).toBe(61.9);
  stop();
});

it('6 — the token arrives after the page has painted', async () => {
  let token: string | null = null;
  const h = harness(async () => payload(), { session: () => token });
  const stop = h.store.subscribe(() => {});

  // No session to ask with. The store owes a verdict immediately — this is
  // the case that used to leave a skeleton with nothing behind it.
  const before = await noEternalLoading(h, 'mounted without a token');
  expect(h.probe.calls).toBe(0);
  expect(before.settled).toBe(true);
  expect(before.nazar).toBeNull();

  token = SESSION_A;
  h.store.syncSession();
  const after = await noEternalLoading(h, 'token arrived');
  expect(h.probe.calls).toBe(1);
  expect(after.nazar).not.toBeNull();
  expect(after.ksenia).not.toBeNull();
  stop();
});

it('7 — a FAILED prefetch never counts as fresh data', async () => {
  let fail = true;
  const h = harness(async () => { if (fail) throw new Error('network'); return payload(); });

  await h.store.prefetch();                       // the nav hover, and it fails
  await noEternalLoading(h, 'prefetch failed');
  expect(h.probe.calls).toBe(1);

  h.advanceClock(5_000);                          // the click, well inside 30s
  fail = false;
  const stop = h.store.subscribe(() => {});
  const state = await noEternalLoading(h, 'mounted after a failed prefetch');
  expect(h.probe.calls).toBe(2);                  // 1 here is the regression
  expect(state.nazar).not.toBeNull();
  expect(state.ksenia).not.toBeNull();
  stop();

  // A SUCCESS, by contrast, is worth reusing for thirty seconds.
  h.advanceClock(1_000);
  await h.store.prefetch();
  await noEternalLoading(h, 'prefetch after a success');
  expect(h.probe.calls).toBe(2);
});

it('8 — the session changes while a request is in flight', async () => {
  let token = SESSION_A;
  const asked: string[] = [];
  const release: Array<(value: unknown) => void> = [];
  const h = harness((_signal, call) => {
    asked.push(token);
    return new Promise(resolve => { release[call - 1] = resolve; });
  }, { session: () => token });
  const stop = h.store.subscribe(() => {});
  await quiesce();
  expect(asked).toEqual([SESSION_A]);

  // B arrives while A's request is still open.
  token = SESSION_B;
  h.store.syncSession();
  await quiesce();
  // B does not inherit A's state, and does not sit waiting on A's answer: it
  // has a request of its own on the wire.
  expect(asked).toEqual([SESSION_A, SESSION_B]);
  expect(h.store.getState().nazar).toBeNull();

  // A's answer lands late. It belongs to a session that has gone, so it is
  // discarded — B must never be shown the previous account's figures.
  release[0](payload());
  await quiesce();
  expect(h.store.getState().nazar).toBeNull();

  // B's own answer lands and is the one that paints.
  release[1](payload());
  const state = await noEternalLoading(h, 'session switched mid-flight');
  expect(state.settled).toBe(true);
  expect(state.nazar).not.toBeNull();
  expect(state.ksenia!.analytics.roi7).toBe(61.9);
  stop();
});

it('9 — a request abandoned at fifteen seconds settles as a timeout', async () => {
  const h = harness(hang);
  const stop = h.store.subscribe(() => {});
  await quiesce();
  expect(h.probe.inFlight).toBe(1);
  // Still loading, and that is correct: a real request IS on the wire.
  expect(h.store.getState().settled).toBe(false);

  h.advanceClock(15_000);
  await jest.advanceTimersByTimeAsync(15_000);
  const state = await noEternalLoading(h, 'abandoned at 15s');
  expect(state.settled).toBe(true);
  expect(state.diagnosis).toEqual({ nazar: 'timeout', ksenia: 'timeout', identities: 'timeout' });
  stop();
});

it('10 — a request that never reaches the server settles as a network failure', async () => {
  const h = harness(async () => { throw new TypeError('Failed to fetch'); });
  const stop = h.store.subscribe(() => {});
  const state = await noEternalLoading(h, 'connection refused');
  expect(state.settled).toBe(true);
  expect(state.diagnosis.nazar).toBe('network');
  expect(state.diagnosis.ksenia).toBe('network');
  // Nothing was fabricated to fill the gap.
  expect(state.nazar).toBeNull();
  expect(state.ksenia).toBeNull();
  stop();
});

it('11 — a later failure keeps the last validated figures instead of blanking the cards', async () => {
  let ok = true;
  const h = harness(async () => { if (!ok) throw new Error('500'); return payload(); });
  const stop = h.store.subscribe(() => {});
  const loaded = await noEternalLoading(h, 'first load');
  const roi = loaded.nazar!.analytics.roi7;
  const kseniaRoi = loaded.ksenia!.analytics.roi7;

  ok = false;
  h.advanceClock(61_000);
  await h.store.refresh();
  const after = await noEternalLoading(h, 'refresh failed after a success');
  expect(after.settled).toBe(true);
  expect(after.nazar!.analytics.roi7).toBe(roi);          // real, not re-skeletoned
  expect(after.ksenia!.analytics.roi7).toBe(kseniaRoi);
  expect(after.ksenia!.analytics.roi7).toBe(61.9);        // and still the reported one
  expect(after.stale.nazar).toBe(true);                   // shown as what it is
  expect(after.stale.ksenia).toBe(true);
  stop();
});

it('12 — logging out takes the snapshot with it; the next login never reads it', async () => {
  let token: string | null = SESSION_A;
  const h = harness(async () => payload(), { session: () => token });
  const stop = h.store.subscribe(() => {});
  await noEternalLoading(h, 'loaded as A');
  expect(h.storage.map.has(cacheKey(SESSION_A))).toBe(true);

  token = null;
  h.store.syncSession();
  const out = await noEternalLoading(h, 'logged out');
  expect(out.settled).toBe(true);
  expect(out.nazar).toBeNull();
  expect(out.ksenia).toBeNull();
  expect(h.storage.map.has(cacheKey(SESSION_A))).toBe(false);

  // B arrives on the same machine and must start from nothing of A's.
  token = SESSION_B;
  h.store.syncSession();
  expect(h.storage.map.has(cacheKey(SESSION_B))).toBe(false);
  const b = await noEternalLoading(h, 'logged in as B');
  expect(b.settled).toBe(true);
  expect(h.storage.map.has(cacheKey(SESSION_A))).toBe(false);
  stop();
});

/**
 * THE SESSION CHANGE THAT ARRIVES WITHOUT A BROADCAST.
 *
 * `onSessionChange` is an in-memory list, so it only ever fires in the tab
 * that called `setToken`/`clearToken`. Every OTHER tab shares the same
 * localStorage and learns about the change the next time something reads the
 * token — which, for this store, is `checkSession()` inside `getState()`,
 * the function React calls as its snapshot getter on every render.
 *
 * That path swaps the state for the new session and returns. Until this
 * case existed, it neither settled nor put a request on the wire, so both
 * cards fell back to «Загрузка…» and stayed there until the sixty-second
 * poll or a window focus happened to come round. Nothing on the page
 * triggers either, so on a tab the viewer is looking at it is simply a
 * skeleton that never resolves — while every demo trader beside it, which
 * needs no request at all, renders normally.
 */
it('12a — another tab logs in; this tab is mounted and learns of it through getState()', async () => {
  let token: string | null = SESSION_A;
  const h = harness(async () => payload(), { session: () => token });
  const stop = h.store.subscribe(() => {});
  await noEternalLoading(h, 'loaded as A');
  expect(h.probe.calls).toBe(1);

  // No `syncSession` — this tab never called setToken, so nothing told it.
  token = SESSION_B;
  const duringRender = h.store.getState();
  expect(duringRender.nazar).toBeNull();          // A's figures are gone, rightly

  const state = await noEternalLoading(h, 'another tab logged in');
  expect(h.probe.calls).toBe(2);                  // a REAL request for B
  expect(state.settled).toBe(true);
  expect(state.nazar).not.toBeNull();
  expect(state.ksenia!.analytics.roi7).toBe(61.9);
  stop();
});

it('12b — the token vanishes under a mounted page', async () => {
  let token: string | null = SESSION_A;
  const h = harness(async () => payload(), { session: () => token });
  const stop = h.store.subscribe(() => {});
  await noEternalLoading(h, 'loaded as A');

  // Storage cleared by the browser, another tab, or an extension. There is
  // no session to ask with, so the viewer is owed a verdict immediately —
  // not a skeleton behind which nothing will ever be requested.
  token = null;
  h.store.getState();
  const state = await noEternalLoading(h, 'token vanished');
  expect(state.settled).toBe(true);
  expect(state.nazar).toBeNull();
  expect(state.ksenia).toBeNull();
  expect(h.probe.calls).toBe(1);                  // and nothing was asked without a token
  stop();
});

it('12c — a session change while the page is closed is answered when it opens', async () => {
  let token: string | null = SESSION_A;
  const h = harness(async () => payload(), { session: () => token });
  // Never mounted. A login elsewhere in the app must not fire a marketplace
  // request for a page nobody is on; the next mount is what asks.
  token = SESSION_B;
  h.store.syncSession();
  await quiesce();
  expect(h.probe.calls).toBe(0);

  const stop = h.store.subscribe(() => {});
  const state = await noEternalLoading(h, 'opened after a session change');
  expect(h.probe.calls).toBe(1);
  expect(state.settled).toBe(true);
  expect(state.nazar).not.toBeNull();
  stop();
});

it('13 — leaving the route and coming back repaints the real figures at once', async () => {
  const h = harness(async () => payload());
  const stop = h.store.subscribe(() => {});
  const first = await noEternalLoading(h, 'first visit');
  const roi = first.nazar!.analytics.roi7;
  stop();                                             // route away

  // A fresh store, as a hard reload gives: same session, same storage.
  const reloaded = new CopyMarketplaceStore(async () => payload(), () => SESSION_A,
    () => h.clock, h.storage);
  const seen: boolean[] = [];
  const stop2 = reloaded.subscribe(() => { seen.push(reloaded.getState().nazar !== null); });
  // Before any response: the validated snapshot is already on screen.
  expect(reloaded.getState().nazar!.analytics.roi7).toBe(roi);
  expect(reloaded.getState().ksenia!.analytics.roi7).toBe(61.9);
  await quiesce();
  expect(reloaded.getState().settled).toBe(true);
  stop2();
  expect(seen.length).toBeGreaterThan(0);
});

it('14 — one failed section never takes a healthy one off the screen', async () => {
  for (const broken of ['nazar', 'ksenia'] as const) {
    const survivor = broken === 'nazar' ? 'ksenia' : 'nazar';
    const h = harness(async () => payload({ [broken]: null, errors: { [broken]: 'temporarily_unavailable' } }));
    const stop = h.store.subscribe(() => {});
    const state = await noEternalLoading(h, `${broken} unavailable`);
    expect(state.settled).toBe(true);
    expect(state[broken]).toBeNull();
    expect(state.diagnosis[broken]).toBe('server_unavailable');
    expect(state[survivor]).not.toBeNull();             // the whole point
    expect(state.diagnosis[survivor]).toBe('ok');
    stop();
  }
  // Identities failing must not cost either performance card.
  const h = harness(async () => payload({ identities: null, errors: { identities: 'temporarily_unavailable' } }));
  const stop = h.store.subscribe(() => {});
  const state = await noEternalLoading(h, 'identities unavailable');
  expect(state.nazar).not.toBeNull();
  expect(state.ksenia).not.toBeNull();
  expect(state.identities).toEqual([]);
  stop();
});

it('15 — no exit from an attempt leaves the cards loading with nothing on the wire', async () => {
  // The exits, enumerated. Each one is a way an attempt can END that is not
  // a successful response, and each used to be a candidate for the hang.
  const exits: Array<[string, () => ReturnType<typeof harness>, (h: ReturnType<typeof harness>) => Promise<void>]> = [
    ['no session at all', () => harness(async () => payload(), { session: () => null }), async () => {}],
    ['malformed envelope', () => harness(async () => ({ nothing: true })), async () => {}],
    ['a 200 that is not JSON we know', () => harness(async () => null), async () => {}],
    ['both sections refused by this build', () => harness(async () => payload({ nazar: {}, ksenia: {} })), async () => {}],
    ['server marked every section failed', () => harness(async () => payload({
      nazar: null, ksenia: null, identities: null,
      errors: { nazar: 'temporarily_unavailable', ksenia: 'temporarily_unavailable', identities: 'temporarily_unavailable' },
    })), async () => {}],
    ['rejection with no name', () => harness(async () => { throw 'plain string'; }), async () => {}],
    ['abandoned at 15s', () => harness(hang), async h => { h.advanceClock(15_000); await jest.advanceTimersByTimeAsync(15_000); }],
  ];
  for (const [label, build, drive] of exits) {
    const h = build();
    const stop = h.store.subscribe(() => {});
    await quiesce();
    await drive(h);
    const state = await noEternalLoading(h, label);
    expect(state.settled).toBe(true);
    // And nothing was invented to fill the silence.
    if (state.nazar === null) expect(state.diagnosis.nazar).not.toBe('ok');
    if (state.ksenia === null) expect(state.diagnosis.ksenia).not.toBe('ok');
    stop();
  }

  // The same rule through the OTHER two entry points, which do not go through
  // `subscribe` and each have their own early returns.
  const direct = harness(async () => payload(), { session: () => null });
  await direct.store.refresh();
  await noEternalLoading(direct, 'refresh() with no session');
  await direct.store.prefetch();
  await noEternalLoading(direct, 'prefetch() with no session');
});
