import { byClass, byData, mountComponent, nodes, readSource, tick } from '../../../test-utils/terminalMount';

/**
 * THE SEVEN PROOFS THE FUTURES PRO TERMINAL HAS TO PASS.
 *
 * Each describe below is one of them, and each is written as the thing
 * that must be IMPOSSIBLE rather than the thing that should happen:
 *
 *   1. The calculator cannot move money.
 *   2. "Use values" fills a draft and nothing else.
 *   3. Reduce Only takes TP/SL away, rather than disabling it.
 *   4. TP/SL travels on the order, and only to an engine that takes it.
 *   5. Close All cannot run without a confirmation, and cannot report a
 *      success the engine did not give.
 *   6. No control exists for a capability the engine does not have.
 *   7. Margin is never labelled as the order's value.
 *
 * The backend half of proof 1 lives in
 * `src/private-trading/__tests__/nativeQuoteReadOnly.test.ts`, which runs
 * the quote service against a repository whose every write method throws.
 * This file is the client half: the component itself never reaches for a
 * command.
 */

const FORM = 'components/FuturesOrderForm.tsx';
const CALCULATOR = 'components/FuturesCalculator.tsx';
const PANEL = 'components/FuturesPositionsPanel.tsx';
const STATUS = 'components/FuturesTerminalStatus.tsx';
const CHART = 'components/PriceChart.tsx';
const PAGE = 'pages/FuturesPage.tsx';

const tierConfig = {
  symbols: ['BTC/USDT'],
  minLeverage: 1,
  maxLeverage: 100,
  highLeverageWarningThreshold: 50,
  leverageTiers: [
    { notionalCap: 50000, maxLeverage: 100, maintenanceMarginRate: 0.005 },
    { notionalCap: null, maxLeverage: 50, maintenanceMarginRate: 0.01 },
  ],
};

const settled = <T,>(data: T) => ({ data, loading: false, refreshing: false, failed: false });
const account = (overrides: Record<string, unknown> = {}) => ({
  balances: settled([{ asset: 'USDT', available: '100000', balance: '100000' }]),
  positions: settled([]),
  positionHistory: settled([]),
  orders: settled([]),
  ...overrides,
});

const contractRules = {
  qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '100',
  maxMarketOrderQty: '50', minNotionalValue: '5',
  takerFeeRate: '0.00055', makerFeeRate: '0.0002',
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** The real order ticket, priced and sized, on a chosen engine. */
async function ticket(overrides: Record<string, any> = {}) {
  const placed = overrides.placed ?? jest.fn().mockResolvedValue({});
  const form = mountComponent(FORM, {
    account: overrides.account ?? account(),
    execution: { placeOrder: placed, ...(overrides.execution ?? {}) },
    api: {
      getFuturesConfig: () => Promise.resolve(tierConfig),
      getFuturesMarkPrice: () => Promise.resolve({ markPrice: '80000' }),
    },
  });
  const props = { symbol: 'BTC/USDT', onPlaced: jest.fn(), executionEnabled: true, ...overrides.props };
  form.render(props);
  await tick();
  const render = () => form.render(props);
  const type = (tree: any, hook: string, value: string) =>
    byData(tree, hook)[0].props.onChange({ target: { value } });
  const field = (tree: any, placeholder: string, value: string) =>
    nodes(tree).find((n: any) => n.type === 'input' && n.props.placeholder === placeholder)
      .props.onChange({ target: { value } });
  let tree = render();
  field(tree, '0.00', '80000');
  field(tree, '0.00000', '0.5');
  await tick();
  return { placed, render, type, field, tree: render() };
}

// ── 1 & 2. The calculator asks; it never acts ────────────────────────────

/**
 * A file's EXECUTABLE lines.
 *
 * The bans below are about what the code does, and a doc comment that
 * names `closePositionAllocation` — the engine function the quote route
 * reuses — is the file explaining itself, not the file calling anything.
 * Stripping comments first is what makes the ban mean what it says.
 */
const executable = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('1. the calculator cannot move money', () => {
  const code = executable(readSource(CALCULATOR));

  it('reaches for no command, no order and no protection write', () => {
    // The whole vocabulary that changes an account. None of it appears.
    for (const forbidden of [
      'placeOrder', 'closePosition', 'cancelOrder', 'setProtection', 'clearProtection',
      'nativeDemoApi.command', 'useFuturesExecution', 'placeFuturesOrder',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({ forbidden, present: false });
    }
  });

  it('makes exactly one kind of request, and it is the read-only quote', () => {
    const calls = [...code.matchAll(/nativeDemoApi\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(calls)]).toEqual(['quote']);
  });

  it('says so on its face, so the claim is checkable without reading this file', () => {
    expect(code).toContain('data-calculator-readonly');
  });
});

describe('2. "Use values" fills a draft and nothing else', () => {
  it('hands the draft to the caller and submits nothing', async () => {
    const onUseValues = jest.fn();
    const quote = jest.fn().mockResolvedValue({
      kind: 'ORDER', entryNotional: '40000', baseInitialMargin: '4000', positionMargin: '4022',
      openingFee: '22', closeFeeReserve: '22', totalCost: '4044', violation: null,
      takerFeeRate: '0.00055', makerFeeRate: '0.0002',
    });
    const calculator = mountComponent(CALCULATOR, {
      modules: { '../lib/nativeDemoApi': { nativeDemoApi: { quote } } },
    });
    const props = { open: true, onClose: jest.fn(), symbol: 'BTC/USDT', onUseValues,
      initial: { price: '80000', quantity: '0.5', leverage: '10' } };
    calculator.render(props);
    await tick();
    const tree = calculator.render(props);

    const use = byData(tree, 'data-calculator-use-values')[0];
    expect(use).toBeDefined();
    use.props.onClick();

    expect(onUseValues).toHaveBeenCalledTimes(1);
    // A DRAFT: the four fields an order ticket needs filling in, and no
    // instruction to do anything with them.
    expect(Object.keys(onUseValues.mock.calls[0][0]).sort())
      .toEqual(['leverage', 'price', 'quantity', 'side']);
  });

  it('the order ticket treats the draft as typing, not as a submission', async () => {
    const t = await ticket({ props: { calculatorDraft: { side: 'SHORT', price: '79000', quantity: '0.25', leverage: '20', seq: 1 } } });
    await tick();
    // Filling fields is not placing an order. Nothing was sent.
    expect(t.placed).not.toHaveBeenCalled();
  });
});

// ── 3 & 4. TP/SL at entry ────────────────────────────────────────────────

describe('3. Reduce Only takes TP/SL away rather than disabling it', () => {
  const code = readSource(FORM);

  it('renders the levels only while the ticket is not a reducing one', () => {
    expect(code).toContain('const entryProtectionAvailable = execution.entryProtection && !reduceOnly;');
    // A greyed-out input invites a trader to hunt for the switch that turns
    // it on. Under Reduce Only there is a sentence instead.
    expect(code).toContain("{t('futures.tpslReduceOnlyOff')}");
  });

  it('is absent entirely on an engine that would ignore it', async () => {
    const real = await ticket();
    expect(byData(real.tree, 'data-entry-take-profit')).toHaveLength(0);
    const native = await ticket({ execution: { entryProtection: true, contract: contractRules } });
    expect(byData(native.tree, 'data-entry-take-profit')).toHaveLength(1);
  });

  it('arms nothing when the ticket turns into a reducing one', async () => {
    const t = await ticket({ execution: { entryProtection: true, contract: contractRules } });
    t.type(t.tree, 'data-entry-take-profit', '90000');
    let tree = t.render();
    expect(byData(tree, 'data-entry-protection')[0].props['data-entry-protection']).toBe('available');

    byClass(tree, 'fo-reduceOnlyRow')[0].props.children[0].props.onChange({ target: { checked: true } });
    tree = t.render();
    expect(byData(tree, 'data-entry-protection')[0].props['data-entry-protection']).toBe('reduce-only');
    expect(byData(tree, 'data-entry-take-profit')).toHaveLength(0);
  });
});

describe('4. TP/SL travels on the order itself', () => {
  it('is carried in the placement payload, not sent as a second request', async () => {
    const t = await ticket({ execution: { entryProtection: true, contract: contractRules } });
    t.type(t.tree, 'data-entry-take-profit', '90000');
    t.type(t.render(), 'data-entry-stop-loss', '70000');
    const tree = t.render();
    byClass(tree, 'buy')[0].props.onClick();
    await tick();

    expect(t.placed).toHaveBeenCalledTimes(1);
    expect(t.placed.mock.calls[0][0].protection).toEqual({ takeProfit: '90000', stopLoss: '70000' });
  });

  it('refuses a level on the wrong side of the price before a round trip', async () => {
    const t = await ticket({ execution: { entryProtection: true, contract: contractRules } });
    // A take profit BELOW the price is right for a short and wrong for a
    // long, which is what `validateProtection` says in the engine. So the
    // long button is refused and the short button is not.
    t.type(t.tree, 'data-entry-take-profit', '70000');
    const tree = t.render();
    expect(byClass(tree, 'buy')[0].props.disabled).toBe(true);
    expect(byClass(tree, 'sell')[0].props.disabled).toBe(false);
  });

  it('sends no protection key at all when neither level is set', async () => {
    const t = await ticket({ execution: { entryProtection: true, contract: contractRules } });
    byClass(t.render(), 'buy')[0].props.onClick();
    await tick();
    expect(t.placed.mock.calls[0][0]).not.toHaveProperty('protection');
  });
});

// ── 5. Close All ─────────────────────────────────────────────────────────

const openPosition = (id: string) => ({
  id, symbol: 'BTC/USDT', side: 'LONG', size: '0.5', entryPrice: '80000', leverage: 10,
  marginType: 'CROSS', initialMargin: '4000', liquidationPrice: '72000', markPrice: '81000',
  unrealizedPnl: '500', realizedPnl: '0', roe: '12.5', openedAt: '2026-01-01T00:00:00Z',
  protection: { takeProfit: null, stopLoss: null },
});

function panel(closePosition: jest.Mock, rows = [openPosition('p1'), openPosition('p2')]) {
  const mounted = mountComponent(PANEL, {
    account: account({ positions: settled(rows) }),
    execution: { closePosition },
  });
  const props = { tab: 'open' as const, refreshKey: 0 };
  mounted.render(props);
  return { mounted, render: () => mounted.render(props) };
}

describe('5. Close All cannot run unconfirmed, and cannot overstate what happened', () => {
  it('the trigger asks; it does not close', () => {
    const closePosition = jest.fn().mockResolvedValue(undefined);
    const p = panel(closePosition);
    byData(p.render(), 'data-close-all')[0].props.onClick();
    const tree = p.render();
    expect(closePosition).not.toHaveBeenCalled();
    expect(byData(tree, 'data-close-all-confirm')).toHaveLength(1);
  });

  it('closes each position through the ordinary close path, one at a time', async () => {
    const closePosition = jest.fn().mockResolvedValue(undefined);
    const p = panel(closePosition);
    byData(p.render(), 'data-close-all')[0].props.onClick();
    byData(p.render(), 'data-close-all-confirmed')[0].props.onClick();
    await tick();
    expect(closePosition.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2']);
  });

  it('a refusal is counted and named, never rounded up to success', async () => {
    const closePosition = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('engine said no'));
    const p = panel(closePosition);
    byData(p.render(), 'data-close-all')[0].props.onClick();
    byData(p.render(), 'data-close-all-confirmed')[0].props.onClick();
    await tick();
    const report = byData(p.render(), 'data-close-all-report')[0];
    // The harness renders `t(key, params)` as `key:<json>`, so the counts
    // travel in the string and can be read back exactly.
    const printed = [report.props.children].flat(3).join('');
    expect(printed).toContain('futures.closeAllPartial');
    expect(printed).toContain('"closed":1');
    expect(printed).toContain('"count":2');
    expect(printed).toContain('"failed":1');
    // And the rest of the run was not abandoned because the second failed.
    expect(closePosition).toHaveBeenCalledTimes(2);
  });

  it('cancelling leaves every position exactly where it was', () => {
    const closePosition = jest.fn();
    const p = panel(closePosition);
    byData(p.render(), 'data-close-all')[0].props.onClick();
    byClass(p.render(), 'futures-close-all-cancel')[0].props.onClick();
    expect(byData(p.render(), 'data-close-all-confirm')).toHaveLength(0);
    expect(closePosition).not.toHaveBeenCalled();
  });

  it('the ids are the ones the trader saw, not whatever arrives later', () => {
    // Captured at the moment of pressing. A position opened while the
    // question was on screen was never agreed to.
    expect(readSource(PANEL)).toContain("setCloseAll({ phase: 'confirm', ids: positions.map(p => p.id) })");
    expect(readSource(PANEL)).toContain('runCloseAll(closeAll.ids)');
  });
});

// ── 6. No control for a capability the engine does not have ──────────────

describe('6. no fake controls', () => {
  it('the ticket offers no order type the engine cannot execute', () => {
    const code = executable(readSource(FORM));
    // Stop Limit, trigger orders and Post Only are all absent from the
    // futures engine. A control for any of them would look actionable and
    // do nothing.
    for (const forbidden of ['STOP_LIMIT', 'STOP_MARKET', 'postOnly', 'PostOnly', 'POST_ONLY', 'timeInForce']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({ forbidden, present: false });
    }
  });

  it('the fee row renders only where a rate is published', async () => {
    const withoutRate = await ticket();
    expect(JSON.stringify(withoutRate.tree)).not.toContain('futures.estFees');
    const withRate = await ticket({ execution: { contract: contractRules } });
    expect(JSON.stringify(withRate.tree)).toContain('futures.estFees');
  });

  it('the status line prints no latency, because none is measured', () => {
    const code = readSource(STATUS);
    for (const forbidden of ['latency', 'Latency', 'ping', 'rtt', 'roundTrip']) {
      // The word appears in the file's own explanation of why there is no
      // such figure; what must not exist is a rendered one.
      expect({ forbidden, rendered: new RegExp(`\\{[^}]*${forbidden}[^}]*\\}`).test(code) })
        .toEqual({ forbidden, rendered: false });
    }
  });

  it('does not expose feed/snapshot implementation state in the customer UI', () => {
    const rendered = (status: 'live' | 'connecting' | 'reconnecting' | 'stale' | 'unavailable') =>
      JSON.stringify(mountComponent(STATUS, { execution: { contract: contractRules } }).render({ status, asOf: Date.now() }));
    for (const state of ['live', 'connecting', 'reconnecting', 'stale', 'unavailable'] as const) {
      const tree = rendered(state);
      for (const technical of ['futures.statusLive', 'catalogue.stale', 'trade.bookUnavailable', 'trade.marketDelayed', 'data-feed-age', 'UTC', 'Snapshot', 'Снимок', 'Знімок']) {
        expect({ state, technical, visible: tree.includes(technical) }).toEqual({ state, technical, visible: false });
      }
    }
  });

  it('the fee pair is absent where the engine publishes no rate', () => {
    const none = JSON.stringify(mountComponent(STATUS, {}).render({ status: 'live', asOf: null }));
    expect(none).not.toContain('futures.feeTaker');
    const published = JSON.stringify(
      mountComponent(STATUS, { execution: { contract: contractRules } }).render({ status: 'live', asOf: null }),
    );
    expect(published).toContain('futures.feeTaker');
  });
});

// ── 7. The order ticket's own words ──────────────────────────────────────

describe('7. margin is never the order value', () => {
  const code = readSource(FORM);

  it('the two figures carry their own labels and are not the same number', () => {
    // `futures.orderValue` is the NOTIONAL — price x quantity — and the
    // dictionary renders it "Position value". `futures.margin` is what the
    // order locks. Labelling the second with the first is the mislabel this
    // terminal is not allowed to ship.
    expect(code).toContain("{t('futures.orderValue')}");
    expect(code).toContain("{t('futures.margin')}");
    const valueRow = code.slice(code.indexOf("{t('futures.orderValue')}"));
    expect(valueRow.slice(0, 220)).toContain('notional.toFixed(2)');
    const marginRow = code.slice(code.indexOf("{t('futures.margin')}"));
    expect(marginRow.slice(0, 220)).toContain('requiredMargin.toFixed(2)');
  });

  it('the maximum position comes from the function the slider sizes with', () => {
    expect(code).toContain('maxAffordableNotional({');
    // Unknown balance or unknown exposure has no ceiling — a dash, never a
    // number derived from a fake zero, which could only ever be too high.
    expect(code).toContain('availableMargin !== null && baseExposure !== null');
  });
});

// ── The chart overlay draws only what the server holds ───────────────────

describe('the position overlay never invents a level', () => {
  const chart = readSource(CHART);
  const page = readSource(PAGE);

  it('a null liquidation price draws no line', () => {
    // `add` returns on null before it touches `createPriceLine`.
    const overlay = chart.slice(chart.indexOf('THE POSITION OVERLAY'));
    expect(overlay).toContain('if (raw === null) return;');
    expect(overlay).toContain("add(position.liquidationPrice, 'LIQ'");
  });

  it('the estimate used by the order form is not consulted', () => {
    const overlay = chart.slice(chart.indexOf('THE POSITION OVERLAY'), chart.indexOf('Native price lines'));
    expect(overlay).not.toContain('previewLiquidationPrice(');
  });

  it('every level comes off the account payload, unparsed', () => {
    const builder = page.slice(page.indexOf('const chartPositionLines'));
    expect(builder).toContain('entryPrice: row.entryPrice');
    expect(builder).toContain('liquidationPrice: row.liquidationPrice');
    expect(builder).toContain('takeProfit: row.protection?.takeProfit?.triggerPrice ?? null');
    expect(builder).toContain('stopLoss: row.protection?.stopLoss?.triggerPrice ?? null');
  });

  it('a position is never given two entry lines', () => {
    // The simulation transcript already draws them; the overlay stands down.
    expect(page).toContain('if (nativeExecution) return undefined;');
  });
});
