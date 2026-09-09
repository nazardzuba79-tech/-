import { futuresAccountStore, type FuturesAccountState } from '../futuresAccountStore';
import { api, getToken, setToken, clearToken } from '../api';

/**
 * The Futures account-store consolidation, asserted as behaviour.
 *
 * Measured on the shipped build before this store existed
 * (`scripts/qa-futures-account-harness.cjs` + browser QA): the futures
 * terminal ran five `setInterval`s over three authenticated endpoints and
 * issued 75 account requests per idle minute — /futures/positions three
 * times over, /futures/balances twice.
 *
 * Two properties matter here and neither is about speed:
 *
 *   1. ONE timer and ONE in-flight request per RESOURCE, however many
 *      components subscribe — and separate resources stay separate, so a
 *      balances failure cannot blank the positions table.
 *   2. Account state is SESSION-scoped. Component state used to die with
 *      the unmount on logout; module-level state does not, and a logout in
 *      this app is a route change rather than a reload. A response issued
 *      under one session must never be committed under another.
 */

jest.mock('../api', () => {
  let token: string | null = 'token-a';
  const listeners = new Set<() => void>();
  return {
    api: {
      getFuturesBalances: jest.fn(),
      getFuturesPositions: jest.fn(),
      getMyFuturesOrders: jest.fn(),
      getFuturesPositionHistory: jest.fn(),
    },
    getToken: () => token,
    setToken: (next: string) => {
      token = next;
      for (const l of Array.from(listeners)) l();
    },
    clearToken: () => {
      token = null;
      for (const l of Array.from(listeners)) l();
    },
    onSessionChange: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Test-only: change the token WITHOUT notifying, which is what another
     *  browser tab writing localStorage looks like from in here. */
    __setTokenSilently: (next: string | null) => { token = next; },
  };
});

const getFuturesBalances = api.getFuturesBalances as jest.Mock;
const getFuturesPositions = api.getFuturesPositions as jest.Mock;
const getMyFuturesOrders = api.getMyFuturesOrders as jest.Mock;
const getFuturesPositionHistory = api.getFuturesPositionHistory as jest.Mock;

const BALANCES_A = [{ asset: 'USDT', available: '10000.00000000', locked: '250.00000000' }];
const BALANCES_B = [{ asset: 'USDT', available: '333.00000000', locked: '0' }];
const POSITIONS_A = [{
  id: 'pos-a1', symbol: 'BTC/USDT', side: 'LONG', size: '0.05', entryPrice: '104000',
  leverage: 10, marginType: 'ISOLATED', initialMargin: '520', liquidationPrice: '94600',
  markPrice: '104235', unrealizedPnl: '11.75', roe: '2.26', openedAt: '2026-09-09T10:00:00.000Z',
}];

/** A promise the test resolves by hand, so completion ORDER is chosen
 *  rather than hoped for. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let queued microtasks run. Jest's fake timers also fake `setImmediate`,
 *  so draining has to stay on the microtask queue: a handful of awaited
 *  `Promise.resolve()`s clears the store's `.then/.catch/.finally` chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  futuresAccountStore._resetForTests();
  setToken('token-a');
  getFuturesBalances.mockReset().mockResolvedValue(BALANCES_A);
  getFuturesPositions.mockReset().mockResolvedValue(POSITIONS_A);
  getMyFuturesOrders.mockReset().mockResolvedValue([]);
  getFuturesPositionHistory.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  futuresAccountStore._resetForTests();
  jest.useRealTimers();
});

// ── 1. Deduplication ─────────────────────────────────────────────────

describe('one timer and one request per resource', () => {
  test('three components wanting positions produce ONE timer and ONE request', async () => {
    const seen: FuturesAccountState[] = [];
    const a = futuresAccountStore.subscribe((s) => seen.push(s), { positions: 5000 });
    const b = futuresAccountStore.subscribe(() => {}, { positions: 5000 });
    const c = futuresAccountStore.subscribe(() => {}, { positions: 4000 });
    await flush();

    expect(getFuturesPositions).toHaveBeenCalledTimes(1);
    expect(futuresAccountStore._timerCount).toBe(1);
    expect(futuresAccountStore._subscriberCount).toBe(3);
    expect(seen[seen.length - 1].positions.data).toEqual(POSITIONS_A);

    a(); b(); c();
  });

  test('the shared cadence is the FASTEST any live subscriber asked for', async () => {
    const slow = futuresAccountStore.subscribe(() => {}, { positions: 5000 });
    await flush();
    expect(futuresAccountStore._intervalOf('positions')).toBe(5000);

    const fast = futuresAccountStore.subscribe(() => {}, { positions: 4000 });
    await flush();
    // Nobody is served staler data than they asked for.
    expect(futuresAccountStore._intervalOf('positions')).toBe(4000);

    fast();
    // Back to the slower survivor's cadence, not stuck at the fast one.
    expect(futuresAccountStore._intervalOf('positions')).toBe(5000);
    slow();
  });

  test('polling stops entirely when the last subscriber leaves', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { positions: 4000, balances: 5000 });
    await flush();
    expect(futuresAccountStore._timerCount).toBe(2);

    off();
    expect(futuresAccountStore._timerCount).toBe(0);

    const before = getFuturesPositions.mock.calls.length;
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(getFuturesPositions).toHaveBeenCalledTimes(before);
  });

  test('a subscriber mounting mid-flight JOINS the request instead of issuing its own', async () => {
    const gate = deferred<typeof POSITIONS_A>();
    getFuturesPositions.mockReturnValueOnce(gate.promise);

    const a = futuresAccountStore.subscribe(() => {}, { positions: 5000 });
    const b = futuresAccountStore.subscribe(() => {}, { positions: 5000 });
    await flush();

    expect(getFuturesPositions).toHaveBeenCalledTimes(1);
    gate.resolve(POSITIONS_A);
    await flush();
    expect(futuresAccountStore.getState().positions.data).toEqual(POSITIONS_A);
    a(); b();
  });

  test('one idle minute costs one request per resource per cadence, not one per component', async () => {
    const a = futuresAccountStore.subscribe(() => {}, { balances: 5000, positions: 5000, orders: 5000 });
    const b = futuresAccountStore.subscribe(() => {}, { balances: 5000, positions: 5000 });
    const c = futuresAccountStore.subscribe(() => {}, { positions: 4000 });
    await flush();

    getFuturesBalances.mockClear();
    getFuturesPositions.mockClear();
    getMyFuturesOrders.mockClear();

    for (let elapsed = 0; elapsed < 60_000; elapsed += 1000) {
      jest.advanceTimersByTime(1000);
      await flush();
    }

    // 60s at 5s = 12, at 4s = 15. Before this store the same three
    // components cost 24 + 39 + 12 = 75.
    expect(getFuturesBalances).toHaveBeenCalledTimes(12);
    expect(getFuturesPositions).toHaveBeenCalledTimes(15);
    expect(getMyFuturesOrders).toHaveBeenCalledTimes(12);
    expect(
      getFuturesBalances.mock.calls.length + getFuturesPositions.mock.calls.length + getMyFuturesOrders.mock.calls.length
    ).toBe(39);

    a(); b(); c();
  });

  test('resources are NOT merged into one request', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000, positions: 5000 });
    await flush();
    // Two endpoints, two timers, two calls — a shared store, not one
    // monolithic payload.
    expect(getFuturesBalances).toHaveBeenCalledTimes(1);
    expect(getFuturesPositions).toHaveBeenCalledTimes(1);
    expect(futuresAccountStore._timerCount).toBe(2);
    off();
  });

  test('position history is not polled by the open-positions subscription', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { positions: 4000 });
    await flush();
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(getFuturesPositionHistory).not.toHaveBeenCalled();
    off();
  });

  test('a subscription with NO wants creates no timer and fetches nothing', async () => {
    // This is how the history tab subscribes. An absent key means "never
    // poll this"; a cadence of any value — 60_000 included — would create
    // a timer, which is exactly the bug this asserts against.
    const off = futuresAccountStore.subscribe(() => {}, {});
    await flush();

    expect(futuresAccountStore._timerCount).toBe(0);
    expect(futuresAccountStore._intervalOf('positionHistory')).toBeNull();
    expect(getFuturesPositionHistory).not.toHaveBeenCalled();

    jest.advanceTimersByTime(120_000);
    await flush();
    expect(futuresAccountStore._timerCount).toBe(0);
    expect(getFuturesPositionHistory).not.toHaveBeenCalled();
    off();
  });

  test('history still loads on demand for a subscriber that polls nothing', async () => {
    const seen: FuturesAccountState[] = [];
    const off = futuresAccountStore.subscribe((state) => seen.push(state), {});
    await flush();

    futuresAccountStore.invalidate(['positionHistory']);
    await flush();

    // One fetch, delivered to a subscriber that never asked for a cadence,
    // and still no timer anywhere.
    expect(getFuturesPositionHistory).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1].positionHistory.data).toEqual([]);
    expect(futuresAccountStore._timerCount).toBe(0);

    jest.advanceTimersByTime(120_000);
    await flush();
    expect(getFuturesPositionHistory).toHaveBeenCalledTimes(1);
    off();
  });
});

// ── 2. Event-driven refresh ──────────────────────────────────────────

describe('event-driven refresh', () => {
  test('invalidate refreshes exactly the named resources, once each', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000, positions: 5000, orders: 5000 });
    await flush();
    getFuturesBalances.mockClear();
    getFuturesPositions.mockClear();
    getMyFuturesOrders.mockClear();

    futuresAccountStore.invalidate(['balances', 'positions']);
    await flush();

    expect(getFuturesBalances).toHaveBeenCalledTimes(1);
    expect(getFuturesPositions).toHaveBeenCalledTimes(1);
    expect(getMyFuturesOrders).not.toHaveBeenCalled();
    off();
  });

  test('an invalidate landing on top of an in-flight poll costs no extra request', async () => {
    const gate = deferred<typeof BALANCES_A>();
    getFuturesBalances.mockReturnValueOnce(gate.promise);
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();
    expect(getFuturesBalances).toHaveBeenCalledTimes(1);

    futuresAccountStore.invalidate(['balances']);
    futuresAccountStore.invalidate(['balances']);
    await flush();
    expect(getFuturesBalances).toHaveBeenCalledTimes(1);

    gate.resolve(BALANCES_A);
    await flush();
    off();
  });
});

// ── 3. Session safety ────────────────────────────────────────────────

describe('session safety', () => {
  test('logout clears every held account figure', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000, positions: 5000 });
    await flush();
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_A);
    expect(futuresAccountStore.getState().positions.data).toEqual(POSITIONS_A);

    clearToken();

    expect(futuresAccountStore.getState().balances.data).toBeNull();
    expect(futuresAccountStore.getState().positions.data).toBeNull();
    expect(futuresAccountStore.getState().balances.loaded).toBe(false);
    off();
  });

  test('a logged-out tab issues no account requests at all', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();
    clearToken();
    getFuturesBalances.mockClear();

    jest.advanceTimersByTime(30_000);
    await flush();
    expect(getFuturesBalances).not.toHaveBeenCalled();
    off();
  });

  test('signing in as another user cannot show the previous user data', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_A);

    getFuturesBalances.mockResolvedValue(BALANCES_B);
    clearToken();
    setToken('token-b');
    await flush();

    const held = futuresAccountStore.getState().balances.data;
    expect(held).toEqual(BALANCES_B);
    expect(held).not.toEqual(BALANCES_A);
    off();
  });

  test('an in-flight request from the OLD session cannot commit after the session changed', async () => {
    const stale = deferred<typeof BALANCES_A>();
    getFuturesBalances.mockReturnValueOnce(stale.promise);

    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();
    expect(getFuturesBalances).toHaveBeenCalledTimes(1);

    // The session changes while user A's balances are still in the air.
    getFuturesBalances.mockResolvedValue(BALANCES_B);
    setToken('token-b');
    await flush();
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_B);

    // Now user A's response finally lands. It must be dropped.
    stale.resolve(BALANCES_A);
    await flush();

    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_B);
    expect(futuresAccountStore.getState().balances.data).not.toEqual(BALANCES_A);
    off();
  });

  test('a stale FAILURE from the old session cannot mark the new session stale', async () => {
    const stale = deferred<typeof BALANCES_A>();
    getFuturesBalances.mockReturnValueOnce(stale.promise);
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();

    getFuturesBalances.mockResolvedValue(BALANCES_B);
    setToken('token-b');
    await flush();

    stale.reject(new Error('old session request failed'));
    await flush();

    expect(futuresAccountStore.getState().balances.failed).toBe(false);
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_B);
    off();
  });

  test('a token changed WITHOUT any notification is still caught on next access', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_A);

    // Another browser tab writing localStorage: the token changes with no
    // setToken/clearToken call in THIS tab, so the notifier never fires and
    // the store's own token comparison is the only thing standing between
    // user A's balances and user B's screen.
    const mocked = jest.requireMock('../api') as { __setTokenSilently: (t: string | null) => void };
    mocked.__setTokenSilently('token-b');
    expect(getToken()).toBe('token-b');

    getFuturesBalances.mockResolvedValue(BALANCES_B);
    await futuresAccountStore.refresh('balances');
    await flush();

    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_B);
    expect(futuresAccountStore.getState().balances.data).not.toEqual(BALANCES_A);
    off();
  });
});

// ── 4. No fake zero, and failure behaviour ───────────────────────────

describe('no fake zero, and failure behaviour', () => {
  test('a cold store holds null, never an empty array', () => {
    const state = futuresAccountStore.getState();
    expect(state.balances.data).toBeNull();
    expect(state.positions.data).toBeNull();
    expect(state.orders.data).toBeNull();
    expect(state.balances.loaded).toBe(false);
  });

  test('a FAILED first load leaves data null — not [] and not 0', async () => {
    getFuturesBalances.mockRejectedValue(new Error('503'));
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();

    const balances = futuresAccountStore.getState().balances;
    expect(balances.data).toBeNull();
    expect(balances.failed).toBe(true);
    // `loaded` distinguishes "failed" from "still loading" so a view can
    // render a dash rather than a spinner forever.
    expect(balances.loaded).toBe(true);
    expect(balances.loading).toBe(false);
    off();
  });

  test('a REAL empty account is [] and is distinguishable from unknown', async () => {
    getFuturesPositions.mockResolvedValue([]);
    const off = futuresAccountStore.subscribe(() => {}, { positions: 5000 });
    await flush();

    expect(futuresAccountStore.getState().positions.data).toEqual([]);
    expect(futuresAccountStore.getState().positions.data).not.toBeNull();
    expect(futuresAccountStore.getState().positions.failed).toBe(false);
    off();
  });

  test('a failed REFRESH keeps the last good value and flags it, rather than blanking', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_A);

    getFuturesBalances.mockRejectedValue(new Error('503'));
    jest.advanceTimersByTime(5000);
    await flush();

    const balances = futuresAccountStore.getState().balances;
    expect(balances.data).toEqual(BALANCES_A); // stale last-good, still shown
    expect(balances.failed).toBe(true);
    expect(balances.loading).toBe(false);
    off();
  });

  test('a refresh over existing data sets `refreshing`, not `loading`', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();

    const gate = deferred<typeof BALANCES_A>();
    getFuturesBalances.mockReturnValueOnce(gate.promise);
    futuresAccountStore.invalidate(['balances']);

    // A stable UI must not be blanked while a background refresh runs.
    expect(futuresAccountStore.getState().balances.loading).toBe(false);
    expect(futuresAccountStore.getState().balances.refreshing).toBe(true);
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_A);

    gate.resolve(BALANCES_A);
    await flush();
    expect(futuresAccountStore.getState().balances.refreshing).toBe(false);
    off();
  });

  test('recovery after failures restores fresh data and clears the flag', async () => {
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000 });
    await flush();
    getFuturesBalances.mockRejectedValue(new Error('503'));
    jest.advanceTimersByTime(5000);
    await flush();
    expect(futuresAccountStore.getState().balances.failed).toBe(true);

    getFuturesBalances.mockResolvedValue(BALANCES_B);
    jest.advanceTimersByTime(5000);
    await flush();

    expect(futuresAccountStore.getState().balances.failed).toBe(false);
    expect(futuresAccountStore.getState().balances.data).toEqual(BALANCES_B);
    off();
  });

  test('one resource failing does not disturb another', async () => {
    getFuturesBalances.mockRejectedValue(new Error('503'));
    const off = futuresAccountStore.subscribe(() => {}, { balances: 5000, positions: 5000 });
    await flush();

    expect(futuresAccountStore.getState().balances.data).toBeNull();
    expect(futuresAccountStore.getState().balances.failed).toBe(true);
    // Positions are untouched by the balances failure — partial failure
    // stays partial.
    expect(futuresAccountStore.getState().positions.data).toEqual(POSITIONS_A);
    expect(futuresAccountStore.getState().positions.failed).toBe(false);
    off();
  });
});
