import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as futuresMath from '../futuresMath';
import { LEVERAGE_TIERS } from '../../../../src/config/futuresConfig';

/**
 * The professional Futures order panel, asserted as behaviour.
 *
 * The redesign replaces a margin-mode segmented toggle stacked on a
 * leverage slider with ONE compact popover, leaving exactly one persistent
 * slider in the panel: position size. It is a different UI over the SAME
 * values — every bound still comes from `config.minLeverage`, the live
 * `effectiveMaxLeverage` and `config.highLeverageWarningThreshold`, and the
 * submitted payload is byte-for-byte what it was.
 *
 * These tests drive the REAL components through the repo's hook-stub
 * harness (the pattern futuresFinalPolish established), with the shared
 * account store posed so the unknown-vs-empty rules from PR #14 can be
 * checked directly.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const pending = () => new Promise<any>(() => {});
const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

const FORM = 'components/FuturesOrderForm.tsx';
const CONTROL = 'components/FuturesMarginLeverage.tsx';

type Resource = { data: unknown; loading?: boolean; refreshing?: boolean; failed?: boolean; loaded?: boolean; fetchedAt?: number };
const resource = (data: unknown, failed = false): Resource =>
  ({ data, loading: false, refreshing: false, failed, loaded: data !== null || failed, fetchedAt: data === null ? 0 : 1 });

const BALANCES = [{ asset: 'USDT', available: '1000000', locked: '0' }];
function accountState(over: Partial<Record<'balances' | 'positions' | 'orders' | 'positionHistory', Resource>> = {}) {
  return {
    balances: over.balances ?? resource(BALANCES),
    positions: over.positions ?? resource([]),
    orders: over.orders ?? resource([]),
    positionHistory: over.positionHistory ?? resource([]),
  };
}

const tierConfig = {
  symbols: ['BTC/USDT'], minLeverage: 1, maxLeverage: 100, fundingIntervalHours: 8,
  highLeverageWarningThreshold: 20, leverageTiers: JSON.parse(JSON.stringify(LEVERAGE_TIERS)),
};

/** Execute the real TSX with isolated hooks; no network, no money writes. */
function mount(file: string, overrides: Record<string, any> = {}) {
  let index = 0;
  const hooks: any[] = [];
  let effects: (() => void)[] = [];
  const components: Record<string, any> = {};
  const api = new Proxy(overrides.api ?? {}, { get: (target, key: string) => target[key] ?? pending });

  /**
   * `/futures/config` is read through the one shared store now, not from a
   * mount effect in each component (see lib/futuresConfigStore). The stub
   * below resolves the SAME `getFuturesConfig` this test already provides,
   * on the same tick the old effect settled on — so every assertion runs
   * against exactly the config it always did, from exactly the render it
   * always did.
   */
  let sharedFuturesConfig: any = null;
  const stubbedConfigFetch = (overrides.api ?? {}).getFuturesConfig;
  if (stubbedConfigFetch) {
    void Promise.resolve(stubbedConfigFetch()).then((c: any) => { sharedFuturesConfig = c; }).catch(() => {});
  }
  const futuresConfigModule = {
    useFuturesConfig: () => ({
      config: sharedFuturesConfig,
      loading: sharedFuturesConfig === null,
      failed: false,
      loaded: sharedFuturesConfig !== null,
    }),
    futuresConfigStore: {
      getState: () => futuresConfigModule.useFuturesConfig(),
      ensure: () => {},
      load: () => Promise.resolve(sharedFuturesConfig),
      refresh: () => Promise.resolve(sharedFuturesConfig),
      subscribe: () => () => {},
    },
  };


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
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) hooks[i] = { deps, fn };
      return hooks[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = index++, previous = hooks[i];
      if (!previous || deps === undefined || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };

  const refreshes: string[][] = [];
  const futuresAccountModule = {
    useFuturesAccount: () => overrides.account ?? accountState(),
    refreshFuturesAccount: (keys?: string[]) => { refreshes.push(keys ?? ['*']); },
  };

  const compiled = ts.transpileModule(source(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const output: any = {};
  new Function('require', 'exports', 'window', 'document', compiled)((name: string) => {
    if (name === 'react') return react;
    if (name === '../lib/api') return { api, ApiError: Error };
    if (name === '../lib/useFuturesAccount') return futuresAccountModule;
    if (name === '../lib/futuresConfigStore') return futuresConfigModule;
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string, p?: any) => (p ? `${key}:${JSON.stringify(p)}` : key) }) };
    if (name === '../lib/toast') return { useToast: () => ({ success: jest.fn(), error: jest.fn() }) };
    if (name === '../lib/futuresMath') return futuresMath;
    if (name.endsWith('.css')) return {};
    // Child components are stubbed EXCEPT the margin/leverage control,
    // which is the thing under test — it is mounted for real below.
    if (name.startsWith('./') || name.startsWith('../components/')) {
      const label = name.split('/').pop()!.replace(/\.tsx?$/, '');
      const component = components[label] ?? (components[label] = () => null);
      return { [label]: component };
    }
    return req(name);
  }, output, {
    confirm: overrides.confirm ?? jest.fn(() => true),
    setTimeout, clearTimeout, setInterval, clearInterval,
  }, { addEventListener: () => {}, removeEventListener: () => {} });

  const Component = output[Object.keys(output)[0]];
  return {
    components, refreshes,
    render(props: any = {}) {
      index = 0;
      const tree = Component(props);
      const queued = effects; effects = [];
      queued.forEach((fn) => fn());
      return tree;
    },
  };
}

function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
const byClass = (tree: any, cls: string) =>
  nodes(tree).filter((n) => typeof n.props?.className === 'string' && n.props.className.split(' ').includes(cls));
const text = (tree: any) => JSON.stringify(tree);
/** Chip labels render as a JSX children array (`[20, 'x']`), so flatten. */
const chipLabels = (tree: any) =>
  byClass(tree, 'fo-mlChip').map((n) => [n.props.children].flat(2).join(''));

const props = { symbol: 'BTC/USDT', onPlaced: jest.fn() };

// The form keeps a mark-price `setInterval`; without fake timers it holds
// the Node event loop open after the assertions finish.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Drive the real order form to a priced, sized order. */
async function orderForm(overrides: Record<string, any> = {}) {
  const placed = overrides.placed ?? jest.fn().mockResolvedValue({});
  const form = mount(FORM, {
    account: overrides.account ?? accountState(),
    confirm: overrides.confirm,
    api: {
      getFuturesConfig: () => Promise.resolve(overrides.config ?? tierConfig),
      getFuturesMarkPrice: () => Promise.resolve({ markPrice: '50000' }),
      placeFuturesOrder: placed,
      ...overrides.extraApi,
    },
  });
  form.render(props);
  await tick();
  const render = () => form.render(props);
  const change = (tree: any, placeholder: string, value: string) =>
    nodes(tree).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder)
      .props.onChange({ target: { value } });
  return { form, placed, render, change, tree: render() };
}

async function pricedForm(overrides: Record<string, any> = {}) {
  const f = await orderForm(overrides);
  f.change(f.tree, '0.00', '50000');
  f.change(f.tree, '0.00000', '1');
  await tick();
  return { ...f, tree: f.render() };
}

const submit = (tree: any) =>
  nodes(tree).find((n) => n.type === 'form').props.onSubmit({ preventDefault: jest.fn() });

// ── A. Exactly one persistent slider ─────────────────────────────────

describe('A. the panel keeps exactly ONE persistent slider', () => {
  test('the leverage slider is gone from the futures panel', () => {
    const code = source(FORM);
    expect(code).not.toContain('LeverageSlider');
    expect(code).not.toContain('MarginTypeToggle');
    expect(code).toContain('FuturesMarginLeverage');
  });

  test('only the position-size control renders a slider', async () => {
    const f = await pricedForm();
    // PercentSlider is the panel's one slider; it is stubbed here, so it
    // appears exactly once as a child element.
    const sliders = nodes(f.tree).filter((n) => n.type === f.form.components.PercentSlider);
    expect(sliders).toHaveLength(1);
    // And no range input survives anywhere in the panel itself.
    expect(nodes(f.tree).filter((n) => n.type === 'input' && n.props?.type === 'range')).toHaveLength(0);
  });

  test('the margin/leverage control renders no slider of its own', () => {
    const control = mount(CONTROL);
    const tree = control.render({
      marginType: 'ISOLATED', onMarginTypeChange: jest.fn(),
      leverage: 10, onLeverageChange: jest.fn(),
      min: 1, max: 50, warningThreshold: 20,
    });
    // Closed: just the trigger.
    expect(nodes(tree).filter((n) => n.type === 'input')).toHaveLength(0);
    nodes(tree).find((n) => n.type === 'button').props.onClick();
    const open = control.render({
      marginType: 'ISOLATED', onMarginTypeChange: jest.fn(),
      leverage: 10, onLeverageChange: jest.fn(),
      min: 1, max: 50, warningThreshold: 20,
    });
    // Open: one numeric stepper input, and NOT a range.
    const inputs = nodes(open).filter((n) => n.type === 'input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].props.type).toBe('number');
    expect(inputs.some((i) => i.props.type === 'range')).toBe(false);
  });

  test('the size presets are 10 / 25 / 50 / 75 / 100', async () => {
    const f = await pricedForm();
    const slider = nodes(f.tree).find((n) => n.type === f.form.components.PercentSlider);
    expect(slider.props.presets).toEqual([10, 25, 50, 75, 100]);
  });
});

// ── B. The leverage selector respects the real bounds ────────────────

describe('B. leverage bounds come from the same values as before', () => {
  const open = (overrides: Record<string, any>) => {
    const control = mount(CONTROL);
    const p = {
      marginType: 'ISOLATED' as const, onMarginTypeChange: jest.fn(),
      leverage: 10, onLeverageChange: jest.fn(),
      min: 1, max: 50, warningThreshold: 20, ...overrides,
    };
    control.render(p);
    const trigger = nodes(control.render(p)).find((n) => n.type === 'button');
    trigger.props.onClick();
    return { control, tree: control.render(p), props: p };
  };

  test('no preset above the effective ceiling is offered', () => {
    const { tree } = open({ max: 20 });
    const chips = chipLabels(tree);
    expect(chips).toEqual(['1x', '5x', '10x', '20x']);
    expect(chips).not.toContain('50x');
    expect(chips).not.toContain('100x');
  });

  test('the ceiling itself is always offered, even when it is not a round preset', () => {
    const { tree } = open({ max: 37 });
    expect(chipLabels(tree)).toEqual(['1x', '5x', '10x', '20x', '37x']);
  });

  test('presets below the minimum are not offered', () => {
    const { tree } = open({ min: 10, max: 50, leverage: 10 });
    expect(chipLabels(tree)).toEqual(['10x', '20x', '50x']);
  });

  test('the stepper cannot leave [min, max]', () => {
    const onLeverageChange = jest.fn();
    const { tree } = open({ min: 1, max: 20, leverage: 20, onLeverageChange });
    const steps = byClass(tree, 'fo-mlStep');
    expect(steps[1].props.disabled).toBe(true); // "+" at the ceiling
    const input = nodes(tree).find((n) => n.type === 'input');
    input.props.onChange({ target: { value: '999' } });
    expect(onLeverageChange).toHaveBeenCalledWith(20);
    input.props.onChange({ target: { value: '-5' } });
    expect(onLeverageChange).toHaveBeenLastCalledWith(1);
  });

  test('an unknown ceiling disables the control rather than guessing one', () => {
    const control = mount(CONTROL);
    const p = {
      marginType: 'ISOLATED' as const, onMarginTypeChange: jest.fn(),
      leverage: 10, onLeverageChange: jest.fn(),
      min: 1, max: null, warningThreshold: 20,
    };
    const tree = control.render(p);
    const trigger = nodes(tree).find((n) => n.type === 'button');
    expect(trigger.props.disabled).toBe(true);
    // And it shows a dash, not a leverage it cannot justify.
    expect(text(tree)).toContain('—');
    trigger.props.onClick();
    expect(byClass(control.render(p), 'fo-mlChip')).toHaveLength(0);
  });

  test('the form feeds it config.minLeverage, effectiveMaxLeverage and the warning threshold', async () => {
    const f = await pricedForm();
    const control = nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage);
    expect(control.props.min).toBe(tierConfig.minLeverage);
    expect(control.props.warningThreshold).toBe(tierConfig.highLeverageWarningThreshold);
    // 50 000 notional, empty account -> the 50k tier's ceiling, exactly as
    // the untouched formula computes it.
    const expected = Math.min(
      tierConfig.maxLeverage,
      futuresMath.getLeverageTier(tierConfig.leverageTiers, 50_000)?.maxLeverage ?? tierConfig.maxLeverage
    );
    expect(control.props.max).toBe(expected);
  });
});

// ── C. Selecting leverage changes no formula ─────────────────────────

describe('C. leverage selection does not change any calculation', () => {
  test('required margin stays notional / leverage across selections', async () => {
    for (const leverage of [1, 5, 10, 20]) {
      const f = await pricedForm();
      const control = nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage);
      control.props.onLeverageChange(leverage);
      await tick();
      const tree = f.render();
      const rows = byClass(tree, 'fo-infoRow').map((r) => text(r));
      // 50 000 / leverage, formatted by the untouched expression.
      expect(rows.join(' ')).toContain((50_000 / leverage).toFixed(2));
    }
  });

  test('order value is the untouched notional', async () => {
    const f = await pricedForm();
    expect(text(f.tree)).toContain((50_000).toFixed(2));
  });
});

// ── D/E/F/G/H. The submitted payload is unchanged ────────────────────

describe('the placeFuturesOrder payload is byte-for-byte what it was', () => {
  test('E. LIMIT / BUY / ISOLATED default', async () => {
    const f = await pricedForm();
    submit(f.tree);
    await tick();
    expect(f.placed).toHaveBeenCalledWith({
      symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '50000',
      quantity: '1', leverage: 10, marginType: 'ISOLATED', reduceOnly: false,
    });
    // No extra fields were smuggled in by the redesign.
    expect(Object.keys(f.placed.mock.calls[0][0]).sort()).toEqual(
      ['leverage', 'marginType', 'price', 'quantity', 'reduceOnly', 'side', 'symbol', 'type']
    );
  });

  test('F. MARKET sends no price and keeps the mark-price behaviour', async () => {
    const f = await orderForm();
    const typeTab = byClass(f.tree, 'fo-typeTab').find((n) => n.props.children === 'trade.marketOrder');
    typeTab.props.onClick();
    await tick();
    let tree = f.render();
    // No editable limit price is offered.
    expect(nodes(tree).some((n) => n.type === 'input' && n.props?.placeholder === '0.00')).toBe(false);
    f.change(tree, '0.00000', '2');
    await tick();
    tree = f.render();
    submit(tree);
    await tick();
    expect(f.placed).toHaveBeenCalledWith({
      symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', price: undefined,
      quantity: '2', leverage: 10, marginType: 'ISOLATED', reduceOnly: false,
    });
  });

  test('G. CROSS and SHORT travel unchanged', async () => {
    const f = await pricedForm();
    nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage)
      .props.onMarginTypeChange('CROSS');
    await tick();
    // The side used to be a tab clicked before filling the form in. It is
    // now the button that submits, so the SHORT button is what sends a
    // SHORT — this asserts the direction still reaches the payload, by the
    // route a trader actually takes.
    sideButton(f.render(), 'sell').props.onClick();
    await tick();
    expect(f.placed).toHaveBeenCalledWith(expect.objectContaining({
      side: 'SELL', marginType: 'CROSS', type: 'LIMIT', price: '50000', quantity: '1',
    }));
  });

  test('H. Reduce Only travels unchanged, and still works without exposure data', async () => {
    const f = await pricedForm({
      account: accountState({ positions: resource(null), orders: resource(null) }),
    });
    const checkbox = nodes(f.tree).find((n) => n.type === 'input' && n.props.type === 'checkbox');
    checkbox.props.onChange({ target: { checked: true } });
    await tick();
    const tree = f.render();
    submit(tree);
    await tick();
    // PR #14's rule: a risk-REDUCING order needs no exposure projection, so
    // unknown positions/orders must not block it.
    expect(f.placed).toHaveBeenCalledWith(expect.objectContaining({ reduceOnly: true }));
  });

  test('the high-leverage confirmation still gates submission', async () => {
    const confirm = jest.fn(() => false);
    const f = await pricedForm({ confirm });
    nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage)
      .props.onLeverageChange(20);
    await tick();
    submit(f.render());
    await tick();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f.placed).not.toHaveBeenCalled();
  });
});

// ── I/J/K. Unknown is never zero, never empty, never invented ────────

describe('unknown data is never fabricated', () => {
  test('I. an unknown balance shows a dash and sizes nothing', async () => {
    const f = await pricedForm({ account: accountState({ balances: resource(null) }) });
    expect(text(f.tree)).toContain('—');
    const slider = nodes(f.tree).find((n) => n.type === f.form.components.PercentSlider);
    slider.props.onChange(50);
    await tick();
    // The quantity field keeps what the trader typed; nothing was sized
    // from a fake zero balance.
    const qty = nodes(f.render()).find((n) => n.type === 'input' && n.props.placeholder === '0.00000');
    expect(qty.props.value).toBe('1');
  });

  test('J. unknown exposure yields no leverage ceiling, not an empty account', async () => {
    const f = await pricedForm({ account: accountState({ positions: resource(null) }) });
    const control = nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage);
    expect(control.props.max).toBeNull();
  });

  test('K. the fee row shows a dash — VOLTEX has no futures fee source', async () => {
    const f = await pricedForm();
    const feeRow = byClass(f.tree, 'fo-infoRow').find((r) => text(r).includes('trade.fee'));
    expect(feeRow).toBeDefined();
    expect(text(feeRow)).toContain('—');
    // The fabricated zero this row used to carry is gone.
    expect(text(feeRow)).not.toContain('0.00');
    expect(text(feeRow)).not.toContain('0%');
    // The fabricated literal must not come back as RENDERED output. The
    // audit note in the source deliberately quotes it, so this checks the
    // JSX expression rather than the whole file.
    expect(source(FORM)).not.toContain("(0%)</span>");
    expect(source(FORM)).not.toMatch(/0\.00 \{quoteAsset\} \(0%\)/);
  });

  test('order value and required margin dash out when the price is unknown', async () => {
    // MARKET with no mark price: the old panel showed "0.00 USDT", which
    // reads as a free order rather than an unknown one.
    const f = await orderForm({ extraApi: { getFuturesMarkPrice: () => pending() } });
    byClass(f.tree, 'fo-typeTab').find((n) => n.props.children === 'trade.marketOrder').props.onClick();
    await tick();
    let tree = f.render();
    f.change(tree, '0.00000', '1');
    await tick();
    tree = f.render();
    const value = byClass(tree, 'fo-infoRow').find((r) => text(r).includes('futures.orderValue'));
    expect(text(value)).toContain('—');
    expect(text(value)).not.toContain('0.00');
  });

  test('a REAL empty account still yields a real ceiling and a real zero exposure', async () => {
    const f = await pricedForm({ account: accountState({ positions: resource([]), orders: resource([]) }) });
    const control = nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage);
    expect(typeof control.props.max).toBe('number');
  });
});

/** The two direction buttons. `submit-btn buy` / `submit-btn sell` are the
 *  classes the CTA already used for its colours — the split reuses them
 *  rather than inventing a control. */
const sideButton = (tree: any, side: 'buy' | 'sell') =>
  nodes(tree).find((n: any) => n.type === 'button' && n.props?.className === `submit-btn ${side}`);

// ── The submit button matches the submit guard ───────────────────────

describe('the submit button reflects the SAME guard handleSubmit uses', () => {
  /** Long and short are the same control twice, under the same guard, so
   *  every assertion below holds for either. Reading the LONG one keeps
   *  these tests saying exactly what they said before the split; the pair
   *  is checked to agree in `both buttons answer to one guard`. */
  const submitButton = (tree: any) => sideButton(tree, 'buy');

  test('1. a known account state leaves the button enabled', async () => {
    const f = await pricedForm();
    expect(submitButton(f.tree).props.disabled).toBe(false);
    submit(f.tree);
    await tick();
    expect(f.placed).toHaveBeenCalled();
  });

  test('2. an unknown leverage ceiling disables the button, matching the guard', async () => {
    // positions unknown -> exposure unknown -> effectiveMaxLeverage null.
    const f = await pricedForm({ account: accountState({ positions: resource(null) }) });
    expect(nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage).props.max).toBeNull();
    expect(submitButton(f.tree).props.disabled).toBe(true);
    // And the guard still refuses, so the two agree rather than one
    // compensating for the other.
    submit(f.tree);
    await tick();
    expect(f.placed).not.toHaveBeenCalled();
  });

  test('2b. unknown ORDERS disables it for the same reason', async () => {
    const f = await pricedForm({ account: accountState({ orders: resource(null) }) });
    expect(submitButton(f.tree).props.disabled).toBe(true);
  });

  test('3. REDUCE ONLY stays enabled with unknown exposure — it does not need it', async () => {
    const f = await pricedForm({
      account: accountState({ positions: resource(null), orders: resource(null) }),
    });
    // Before ticking reduce-only, the same account state disables it.
    expect(submitButton(f.tree).props.disabled).toBe(true);

    nodes(f.tree).find((n) => n.type === 'input' && n.props.type === 'checkbox')
      .props.onChange({ target: { checked: true } });
    await tick();
    const tree = f.render();

    // A risk-REDUCING order short-circuits the projection before reading
    // positions or orders, so the ceiling is known and the button is live.
    expect(submitButton(tree).props.disabled).toBe(false);
    submit(tree);
    await tick();
    expect(f.placed).toHaveBeenCalledWith(expect.objectContaining({ reduceOnly: true }));
  });

  // ── The direction is the button ──────────────────────────────────
  //
  // The side used to be a mode: a tab above the form, entered before any
  // field was touched. Now the form is direction-neutral and each button
  // carries its own side. That is only true if the side travels as an
  // ARGUMENT — a React state update scheduled by the button's click is
  // NOT visible to a submit handler firing in the same event, so a
  // `setSide` here would send the PREVIOUS direction. These pin that.

  test('a fresh form sends SHORT when SHORT is pressed — no tab, no prior click', async () => {
    const f = await pricedForm();
    // Nothing has selected a side. The first and only act is pressing Short.
    sideButton(f.tree, 'sell').props.onClick();
    await tick();
    expect(f.placed).toHaveBeenCalledWith(expect.objectContaining({ side: 'SELL' }));
  });

  test('a fresh form sends LONG when LONG is pressed', async () => {
    const f = await pricedForm();
    sideButton(f.tree, 'buy').props.onClick();
    await tick();
    expect(f.placed).toHaveBeenCalledWith(expect.objectContaining({ side: 'BUY' }));
  });

  test('reversing sends the NEW direction, not the one pressed before it', async () => {
    // The regression that a state-based side would produce: press Long,
    // then Short, and the second order goes out as another LONG.
    const f = await pricedForm();
    sideButton(f.tree, 'buy').props.onClick();
    await tick();
    sideButton(f.render(), 'sell').props.onClick();
    await tick();
    expect(f.placed).toHaveBeenCalledTimes(2);
    expect(f.placed.mock.calls[0][0]).toMatchObject({ side: 'BUY' });
    expect(f.placed.mock.calls[1][0]).toMatchObject({ side: 'SELL' });
  });

  test('both buttons answer to one guard', async () => {
    // They are the same control twice: whatever disables one disables the
    // other, or a trader could open a position in a state that refuses to
    // close it.
    const f = await pricedForm({ account: accountState({ orders: resource(null) }) });
    expect(sideButton(f.tree, 'buy').props.disabled).toBe(true);
    expect(sideButton(f.tree, 'sell').props.disabled).toBe(true);

    const ok = await pricedForm();
    expect(sideButton(ok.tree, 'buy').props.disabled).toBe(false);
    expect(sideButton(ok.tree, 'sell').props.disabled).toBe(false);
  });

  test('neither button is type=submit — the form must not pick a side by itself', async () => {
    // A `type="submit"` pair would let a stray Enter fire whichever button
    // the browser considers first, choosing a DIRECTION for the trader.
    const f = await pricedForm();
    expect(sideButton(f.tree, 'buy').props.type).toBe('button');
    expect(sideButton(f.tree, 'sell').props.type).toBe('button');
  });

  test('4. while submitting, the button is disabled', async () => {
    let release!: () => void;
    const placed = jest.fn(() => new Promise<void>((r) => { release = () => r(); }));
    const f = await pricedForm({ placed });
    expect(submitButton(f.tree).props.disabled).toBe(false);

    submit(f.tree);
    await tick();
    expect(submitButton(f.render()).props.disabled).toBe(true);

    release();
    await tick();
    expect(submitButton(f.render()).props.disabled).toBe(false);
  });

  test('4b. a second submit while one is in flight sends nothing extra', async () => {
    const placed = jest.fn(() => new Promise<void>(() => {}));
    const f = await pricedForm({ placed });
    submit(f.tree);
    await tick();
    submit(f.render());
    await tick();
    expect(placed).toHaveBeenCalledTimes(1);
  });

  test('5. the payload is unchanged by this gating', async () => {
    const f = await pricedForm();
    submit(f.tree);
    await tick();
    expect(f.placed).toHaveBeenCalledWith({
      symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '50000',
      quantity: '1', leverage: 10, marginType: 'ISOLATED', reduceOnly: false,
    });
    expect(Object.keys(f.placed.mock.calls[0][0]).sort()).toEqual(
      ['leverage', 'marginType', 'price', 'quantity', 'reduceOnly', 'side', 'symbol', 'type']
    );
  });

  test('the high-leverage confirmation is a prompt, not a precondition', async () => {
    // Disabling the button on the warning threshold would make high
    // leverage unusable rather than guarded; it stays enabled and the
    // confirm still gates the send.
    const confirm = jest.fn(() => false);
    const f = await pricedForm({ confirm });
    nodes(f.tree).find((n) => n.type === f.form.components.FuturesMarginLeverage)
      .props.onLeverageChange(20);
    await tick();
    const tree = f.render();
    expect(submitButton(tree).props.disabled).toBe(false);
    submit(tree);
    await tick();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f.placed).not.toHaveBeenCalled();
  });

  test('button and guard read one expression, not two copies', () => {
    const code = source(FORM);
    expect(code).toContain('disabled={!canSubmit}');
    expect(code).toContain('if (!canSubmit) return;');
    // The old visual-only condition is gone.
    expect(code).not.toContain('disabled={submitting}');
  });
});

// ── L. No spot conditional-order surface, no invented TP/SL ──────────

describe('L. the panel references no spot conditional-order machinery', () => {
  const code = source(FORM);

  test('no spot trigger endpoint is referenced', () => {
    for (const forbidden of ['PENDING_TRIGGER', 'updateOrderTrigger', 'getMyOrders', 'ocoGroupId', 'triggerPrice']) {
      expect(code).not.toContain(forbidden);
    }
  });

  test('no TP/SL controls were invented on top of a contract that has none', () => {
    for (const forbidden of ['takeProfit', 'stopLoss', 'takeProfitPrice', 'stopLossPrice']) {
      expect(code).not.toContain(forbidden);
    }
  });

  test('the account store from PR #14 is still the only source of account data', () => {
    expect(code).toContain('useFuturesAccount');
    // No component-local polling was reintroduced for account resources.
    expect(code).not.toContain('getFuturesBalances');
    expect(code).not.toContain('getFuturesPositions');
    expect(code).not.toContain('getMyFuturesOrders');
  });
});

// ── The margin/leverage popover's own behaviour ──────────────────────

describe('the popover behaves like a popover', () => {
  const p = {
    marginType: 'ISOLATED' as const, onMarginTypeChange: jest.fn(),
    leverage: 10, onLeverageChange: jest.fn(),
    min: 1, max: 50, warningThreshold: 20,
  };

  test('it starts closed and toggles', () => {
    const control = mount(CONTROL);
    expect(byClass(control.render(p), 'fo-mlPopover')).toHaveLength(0);
    nodes(control.render(p)).find((n) => n.type === 'button').props.onClick();
    expect(byClass(control.render(p), 'fo-mlPopover')).toHaveLength(1);
  });

  test('the trigger summarises mode and leverage in one line', () => {
    const control = mount(CONTROL);
    const tree = control.render(p);
    const trigger = byClass(tree, 'fo-mlTrigger')[0];
    expect(text(trigger)).toContain('futures.isolated');
    expect(text(trigger)).toContain('10x');
  });

  test('it marks high leverage without changing the threshold', () => {
    const control = mount(CONTROL);
    const tree = control.render({ ...p, leverage: 25 });
    expect(byClass(tree, 'fo-mlHigh').length).toBeGreaterThan(0);
    const low = mount(CONTROL).render({ ...p, leverage: 5 });
    expect(byClass(low, 'fo-mlHigh')).toHaveLength(0);
  });

  test('it declares dialog semantics and an expanded state', () => {
    const control = mount(CONTROL);
    const trigger = byClass(control.render(p), 'fo-mlTrigger')[0];
    expect(trigger.props['aria-haspopup']).toBe('dialog');
    expect(trigger.props['aria-expanded']).toBe(false);
    trigger.props.onClick();
    expect(byClass(control.render(p), 'fo-mlTrigger')[0].props['aria-expanded']).toBe(true);
  });

  test('outside-click and Escape handling is registered while open only', () => {
    const code = source(CONTROL);
    expect(code).toContain("document.addEventListener('mousedown'");
    expect(code).toContain("document.addEventListener('keydown'");
    expect(code).toContain("if (!open) return;");
    expect(code).toContain("event.key !== 'Escape'");
    // Focus returns to the trigger rather than being lost.
    expect(code).toContain('triggerRef.current?.focus()');
  });
});

// ── The stylesheet stays Futures-scoped ──────────────────────────────

test('every new selector is scoped to the futures terminal', () => {
  const css = readFileSync(resolve(frontend, 'src/pages/trade-terminal/FuturesTerminal.css'), 'utf8');
  const selectors: string[] = [];
  require('postcss').parse(css).walkRules((rule: any) => selectors.push(...rule.selectors));
  for (const selector of selectors.filter((s) => s.includes('fo-ml'))) {
    expect(selector.startsWith('.futures-terminal ')).toBe(true);
  }
  expect(selectors.some((s) => s.includes('fo-mlPopover'))).toBe(true);
});
