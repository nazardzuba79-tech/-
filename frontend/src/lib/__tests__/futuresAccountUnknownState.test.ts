import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as futuresMath from '../futuresMath';
import { LEVERAGE_TIERS } from '../../../../src/config/futuresConfig';

/**
 * UNKNOWN is not EMPTY — asserted against the real components.
 *
 * Three review findings on the shared Futures account store, all of the
 * same shape: `data ?? []` silently turns "the server has not answered"
 * into "the account holds nothing". That is a claim about someone's money
 * that nobody made, and in the order form it is the OPTIMISTIC direction —
 * an account with no existing exposure gets the highest leverage tier.
 *
 * These tests drive the real TSX through the repo's established mount
 * harness (see futuresFinalPolish), with the account store stubbed so the
 * unknown/empty distinction can be posed directly.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const pending = () => new Promise<any>(() => {});
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

type Resource = { data: unknown; loading?: boolean; refreshing?: boolean; failed?: boolean; loaded?: boolean; fetchedAt?: number };

function resource(data: unknown, failed = false): Resource {
  return { data, loading: false, refreshing: false, failed, loaded: data !== null || failed, fetchedAt: data === null ? 0 : 1 };
}

/** The account snapshot a test wants the component to see. */
function accountState(over: Partial<Record<'balances' | 'positions' | 'orders' | 'positionHistory', Resource>> = {}) {
  return {
    balances: over.balances ?? resource([{ asset: 'USDT', available: '1000000', locked: '0' }]),
    positions: over.positions ?? resource([]),
    orders: over.orders ?? resource([]),
    positionHistory: over.positionHistory ?? resource([]),
    ...{},
  };
}

/** Execute the real TSX callbacks with isolated hooks; no network, no money writes. */
function mount(file: string, overrides: Record<string, any> = {}) {
  let index = 0;
  const hooks: any[] = [], effects: (() => void)[] = [];
  const components: Record<string, any> = {};
  const api = new Proxy(overrides.api ?? {}, { get: (target, key: string) => target[key] ?? pending });
  const react = { ...React, memo: (fn: any) => fn,
    useState(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial: any) { const i = index++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn: any) { return fn(); },
    useCallback(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) hooks[i] = { deps, fn };
      return hooks[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };

  // The account store, posed rather than fetched: `wants` is recorded so a
  // test can assert which resources the component asked to have POLLED,
  // and `refreshFuturesAccount` calls are recorded so a test can assert the
  // explicit, event-driven loads.
  const wantsSeen: Record<string, number>[] = [];
  const refreshes: string[][] = [];
  const futuresAccountModule = {
    useFuturesAccount(wants: Record<string, number>) {
      wantsSeen.push(wants ?? {});
      return overrides.account ?? accountState();
    },
    refreshFuturesAccount: (keys?: string[]) => { refreshes.push(keys ?? ['*']); },
  };

  const output: any = {};
  const compiled = ts.transpileModule(source(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', 'window', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === '../lib/api') return { api, ApiError: Error };
    if (name === '../lib/useFuturesAccount') return futuresAccountModule;
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name === '../lib/toast') return { useToast: () => ({ success: jest.fn(), error: jest.fn() }) };
    if (name === '../lib/formatNumber') return { formatPrice: String };
    if (name === '../lib/futuresMath') return futuresMath;
    if (name.endsWith('.css')) return {};
    if (name.startsWith('./') || name.startsWith('../components/')) {
      const label = name.split('/').pop()!;
      const component = components[label] ?? (components[label] = () => null);
      return { [label]: component };
    }
    return req(name);
  }, output, { setTimeout, clearTimeout, setInterval, clearInterval, confirm: jest.fn(() => true) });

  return {
    components, wantsSeen, refreshes,
    render(props: any = {}) {
      index = 0;
      const tree = output[Object.keys(output)[0]](props);
      effects.splice(0).forEach((fn) => fn());
      return tree;
    },
  };
}

function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
/** Every string the tree renders, so "did it say there are none" is answerable. */
const text = (tree: any) => JSON.stringify(tree);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// ── 1. Position history has no recurring poll ────────────────────────

describe('position history is loaded, never polled', () => {
  test('the history tab asks the store for NO history cadence', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx');
    panel.render({ refreshKey: 0, tab: 'history' });
    // An absent key is what tells the store never to create a timer. A
    // cadence of any value — 60_000 included — would create one.
    for (const wants of panel.wantsSeen) {
      expect(wants).not.toHaveProperty('positionHistory');
      expect(Object.keys(wants)).toEqual([]);
    }
  });

  test('opening the history tab triggers exactly ONE explicit history load', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx');
    panel.render({ refreshKey: 0, tab: 'history' });
    expect(panel.refreshes).toEqual([['positionHistory']]);
  });

  test('60 seconds on the history tab causes ZERO further history loads', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx');
    panel.render({ refreshKey: 0, tab: 'history' });
    expect(panel.refreshes).toHaveLength(1);

    // Re-render repeatedly across a full minute: with no timer and no
    // cadence there is nothing that could fire.
    for (let elapsed = 0; elapsed < 60_000; elapsed += 4000) {
      jest.advanceTimersByTime(4000);
      panel.render({ refreshKey: 0, tab: 'history' });
    }
    expect(panel.refreshes).toHaveLength(1);
  });

  test('the open-positions tab keeps its 4s shared cadence and wants no history', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx');
    panel.render({ refreshKey: 0, tab: 'open' });
    expect(panel.wantsSeen[0]).toEqual({ positions: 4000 });
    expect(panel.refreshes).toEqual([]);
  });

  test('closing a position explicitly refreshes history (and positions and balances)', async () => {
    const closeFuturesPosition = jest.fn().mockResolvedValue({});
    const panel = mount('components/FuturesPositionsPanel.tsx', {
      api: { closeFuturesPosition },
      account: accountState({ positions: resource([{
        id: 'p1', symbol: 'BTC/USDT', side: 'LONG', size: '0.05', entryPrice: '104000',
        leverage: 10, marginType: 'ISOLATED', initialMargin: '520', liquidationPrice: '94600',
        markPrice: '104235', unrealizedPnl: '11.75', roe: '2.26', openedAt: '2026-09-09T10:00:00.000Z',
      }]) }),
    });
    const tree = panel.render({ refreshKey: 0, tab: 'open' });
    const closeButton = nodes(tree).find((n) => n.type === 'button' && n.props.children === 'futures.close');
    expect(closeButton).toBeDefined();

    await closeButton.props.onClick();
    await tick();

    expect(closeFuturesPosition).toHaveBeenCalledWith('p1');
    expect(panel.refreshes).toEqual([['positions', 'positionHistory', 'balances']]);
    // Exactly one history refresh, from the close — not from a timer.
    expect(panel.refreshes.flat().filter((r) => r === 'positionHistory')).toHaveLength(1);
  });
});

// ── 2. Unknown positions/history must not read as empty ──────────────

describe('unknown is not empty in the positions panel', () => {
  test('A. a failed positions request does NOT claim there are no open positions', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx', {
      account: accountState({ positions: { data: null, failed: true, loaded: true, loading: false, refreshing: false, fetchedAt: 0 } }),
    });
    const tree = panel.render({ refreshKey: 0, tab: 'open' });
    expect(text(tree)).not.toContain('futures.noPositions');
    expect(text(tree)).toContain('futures.loadPositionsError');
  });

  test('A2. a not-yet-loaded positions request does NOT claim there are no open positions', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx', {
      account: accountState({ positions: resource(null) }),
    });
    const tree = panel.render({ refreshKey: 0, tab: 'open' });
    expect(text(tree)).not.toContain('futures.noPositions');
    expect(text(tree)).toContain('trade.loading');
  });

  test('B. a successful empty response DOES render the real empty state', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx', {
      account: accountState({ positions: resource([]) }),
    });
    const tree = panel.render({ refreshKey: 0, tab: 'open' });
    expect(text(tree)).toContain('futures.noPositions');
    expect(text(tree)).not.toContain('trade.loading');
    expect(text(tree)).not.toContain('futures.loadPositionsError');
  });

  test('C. a failed history request does NOT claim the history is empty', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx', {
      account: accountState({ positionHistory: { data: null, failed: true, loaded: true, loading: false, refreshing: false, fetchedAt: 0 } }),
    });
    const tree = panel.render({ refreshKey: 0, tab: 'history' });
    expect(text(tree)).not.toContain('futures.noPositionHistory');
    expect(text(tree)).toContain('futures.loadPositionsError');
  });

  test('D. a successful empty history DOES render the real empty history state', () => {
    const panel = mount('components/FuturesPositionsPanel.tsx', {
      account: accountState({ positionHistory: resource([]) }),
    });
    const tree = panel.render({ refreshKey: 0, tab: 'history' });
    expect(text(tree)).toContain('futures.noPositionHistory');
    expect(text(tree)).not.toContain('futures.loadPositionsError');
  });

  test('last-good rows survive a failed refresh rather than being blanked', () => {
    const rows = [{
      id: 'p1', symbol: 'BTC/USDT', side: 'LONG', size: '0.05', entryPrice: '104000',
      leverage: 10, marginType: 'ISOLATED', initialMargin: '520', liquidationPrice: '94600',
      markPrice: '104235', unrealizedPnl: '11.75', roe: '2.26', openedAt: '2026-09-09T10:00:00.000Z',
    }];
    const panel = mount('components/FuturesPositionsPanel.tsx', {
      // data present AND failed: the store's stale-last-good state.
      account: accountState({ positions: { data: rows, failed: true, loaded: true, loading: false, refreshing: false, fetchedAt: 1 } }),
    });
    const tree = panel.render({ refreshKey: 0, tab: 'open' });
    expect(text(tree)).toContain('104000');
    expect(text(tree)).not.toContain('futures.noPositions');
  });
});

// ── 3. The order form must not project exposure from unknown inputs ──

const tierConfig = {
  minLeverage: 1, maxLeverage: 100, highLeverageWarningThreshold: 20,
  leverageTiers: JSON.parse(JSON.stringify(LEVERAGE_TIERS)),
};

/** Drive the real order form to a priced, sized, non-reduce-only order —
 *  the only state in which the projection reads positions and orders. */
function orderForm(account: ReturnType<typeof accountState>) {
  const placed = jest.fn().mockResolvedValue({});
  const form = mount('components/FuturesOrderForm.tsx', {
    account,
    api: {
      getFuturesConfig: () => Promise.resolve(tierConfig),
      getFuturesMarkPrice: () => Promise.resolve({ markPrice: '50000' }),
      placeFuturesOrder: placed,
    },
  });
  const props = { symbol: 'BTC/USDT', onPlaced: jest.fn() };
  form.render(props);
  const change = (tree: any, placeholder: string, value: string) =>
    nodes(tree).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder)
      .props.onChange({ target: { value } });
  return { form, placed, props, change, render: () => form.render(props) };
}

/** The slider is the exposure-derived leverage preview: it is rendered only
 *  when `effectiveMaxLeverage` is a number, and its `max` IS that ceiling. */
const leverageCeiling = (form: any, tree: any) => {
  const slider = nodes(tree).find((n: any) => n.type === form.components.LeverageSlider);
  return slider ? slider.props.max : null;
};

async function pricedForm(account: ReturnType<typeof accountState>) {
  const f = orderForm(account);
  await tick();
  let tree = f.render();
  f.change(tree, '0.00', '50000');
  f.change(tree, '0.00000', '1');
  await tick();
  tree = f.render();
  return { ...f, tree };
}

describe('exposure preview refuses unknown account state', () => {
  test('A. positions unknown + orders known: no exposure-derived leverage preview', async () => {
    const f = await pricedForm(accountState({ positions: resource(null), orders: resource([]) }));
    expect(leverageCeiling(f.form, f.tree)).toBeNull();
  });

  test('B. positions known + orders unknown: no exposure-derived leverage preview', async () => {
    const f = await pricedForm(accountState({ positions: resource([]), orders: resource(null) }));
    expect(leverageCeiling(f.form, f.tree)).toBeNull();
  });

  test('B2. a failed request is unknown too, not an empty account', async () => {
    const f = await pricedForm(accountState({
      positions: { data: null, failed: true, loaded: true, loading: false, refreshing: false, fetchedAt: 0 },
      orders: resource([]),
    }));
    expect(leverageCeiling(f.form, f.tree)).toBeNull();
  });

  test('C. both known and empty: a REAL zero existing exposure, preview valid', async () => {
    const f = await pricedForm(accountState({ positions: resource([]), orders: resource([]) }));
    // 50 000 notional, no existing exposure -> the 50k tier's ceiling.
    const ceiling = leverageCeiling(f.form, f.tree);
    expect(typeof ceiling).toBe('number');
    const expected = Math.min(
      tierConfig.maxLeverage,
      futuresMath.getLeverageTier(tierConfig.leverageTiers, 50_000)?.maxLeverage ?? tierConfig.maxLeverage
    );
    expect(ceiling).toBe(expected);
  });

  test('D. both known WITH a position and a working order: identical to the formula', async () => {
    const position = {
      id: 'p1', symbol: 'BTC/USDT', side: 'LONG' as const, size: '4', entryPrice: '50000',
      leverage: 10, marginType: 'ISOLATED' as const, initialMargin: '20000', liquidationPrice: '45000',
      markPrice: '50000', unrealizedPnl: '0', roe: '0', openedAt: '2026-09-09T10:00:00.000Z',
    };
    const order = {
      id: 'o1', symbol: 'BTC/USDT', side: 'BUY' as const, type: 'LIMIT', price: '50000',
      originalQuantity: '2', remainingQuantity: '2', status: 'OPEN', reduceOnly: false,
      leverage: 10, marginType: 'ISOLATED' as const, createdAt: '2026-09-09T10:00:00.000Z',
    };
    const f = await pricedForm(accountState({ positions: resource([position]), orders: resource([order]) }));

    // The expected value comes from the untouched formula itself, called
    // here with exactly the inputs the component builds.
    const projected = futuresMath.projectFuturesExposureNotional({
      position: { side: 'LONG', size: 4, entryPrice: 50_000 },
      activeOrders: [{ side: 'BUY', remainingQuantity: 2, price: 50_000 }],
      candidate: { side: 'BUY', remainingQuantity: 1, price: 50_000 },
    });
    const expected = Math.min(
      tierConfig.maxLeverage,
      futuresMath.getLeverageTier(tierConfig.leverageTiers, projected)?.maxLeverage ?? tierConfig.maxLeverage
    );
    expect(leverageCeiling(f.form, f.tree)).toBe(expected);
    // And it is genuinely tighter than the empty-account answer, so the
    // comparison above is not vacuous.
    const empty = await pricedForm(accountState({ positions: resource([]), orders: resource([]) }));
    expect(expected).toBeLessThan(leverageCeiling(empty.form, empty.tree));
  });

  test('a reduce-only order does NOT need the account state — risk-reducing orders stay available', async () => {
    const f = orderForm(accountState({ positions: resource(null), orders: resource(null) }));
    await tick();
    let tree = f.render();
    f.change(tree, '0.00', '50000');
    f.change(tree, '0.00000', '1');
    const reduce = nodes(f.render()).find((n: any) => n.type === 'input' && n.props.type === 'checkbox');
    expect(reduce).toBeDefined();
    reduce.props.onChange({ target: { checked: true } });
    await tick();
    tree = f.render();
    // The projection short-circuits to a real 0 before reading either
    // resource, so the ceiling is the config maximum and the form works.
    expect(leverageCeiling(f.form, tree)).toBe(tierConfig.maxLeverage);
  });

  test('nothing typed yet does not need the account state either', async () => {
    const f = orderForm(accountState({ positions: resource(null), orders: resource(null) }));
    await tick();
    const tree = f.render();
    // Zero notional short-circuits: the initial paint is unaffected by this
    // change, which is what keeps it out of the common path.
    expect(leverageCeiling(f.form, tree)).toBe(tierConfig.maxLeverage);
  });

  test('E. the order payload is unchanged when the account state IS known', async () => {
    const f = await pricedForm(accountState({ positions: resource([]), orders: resource([]) }));
    const form = nodes(f.tree).find((n: any) => n.type === 'form');
    form.props.onSubmit({ preventDefault: jest.fn() });
    await tick();
    expect(f.placed).toHaveBeenCalledWith({
      symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '50000',
      quantity: '1', leverage: 10, marginType: 'ISOLATED', reduceOnly: false,
    });
  });

  test('E2. submit is refused, and no order sent, while exposure inputs are unknown', async () => {
    const f = await pricedForm(accountState({ positions: resource(null), orders: resource([]) }));
    const form = nodes(f.tree).find((n: any) => n.type === 'form');
    form.props.onSubmit({ preventDefault: jest.fn() });
    await tick();
    // Safer than pretending existing exposure is zero: the backend would
    // recompute and reject it anyway.
    expect(f.placed).not.toHaveBeenCalled();
  });
});
