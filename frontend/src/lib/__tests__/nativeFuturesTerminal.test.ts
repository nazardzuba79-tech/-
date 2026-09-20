import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as adapter from '../nativeFuturesAdapter';
import * as futuresMath from '../futuresMath';

/**
 * The owner trades their own account IN THE ORDINARY FUTURES TERMINAL.
 *
 * The page used to swap the whole right-hand ticket and the whole bottom
 * panel for a second set of components (`NativeDemoTicket`,
 * `NativeDemoPanel`). That is the integration these tests pin shut: there
 * is ONE order form and ONE set of account tables on `/futures`, and what
 * differs for the owner is the SOURCE of the account state and the
 * DESTINATION of an order — the account/execution adapter — not the
 * interface.
 */

const frontend = resolve(__dirname, '../../..');
const source = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const PAGE = 'pages/FuturesPage.tsx';

describe('the terminal is the terminal, for every account', () => {
  const page = source(PAGE);

  test('the alternative ticket and panel are gone from the page', () => {
    // The two components that replaced the real ones.
    expect(page).not.toContain('NativeDemoTicket');
    expect(page).not.toContain('NativeDemoPanel');
    // And PrivateTradingPage is not smuggled inside /futures instead.
    expect(page).not.toContain('PrivateTradingPage');
  });

  test('the original order form is rendered unconditionally', () => {
    // Exactly one, and not on either arm of a ternary: the only branch left
    // on the form is which symbol universe it may execute.
    expect(page.match(/<FuturesOrderForm/g)).toHaveLength(1);
    expect(page).not.toMatch(/[?:]\s*<FuturesOrderForm/);
    // And no component on this page is chosen by the old mode flag.
    expect(page).not.toContain('native.requested?');
    expect(page).not.toContain('native.requested&&');
  });

  test('the original bottom panel components are rendered unconditionally', () => {
    for (const component of ['FuturesPositionsPanel', 'FuturesOrdersPanel', 'AssetsPanel']) {
      expect(page).toContain(`<${component}`);
    }
    expect(page).toContain('BOTTOM_TABS.map');
  });

  test('existing-position leverage opens the existing native dialog only for a ready native account', () => {
    expect(page).toContain('onEditLeverage={nativeExecution?.ready ?');
    expect(page).toContain("native.getState()?.positions.find(p => p.id === positionId && p.status === 'OPEN')");
    expect(page).toContain("if (position && !native.busy) native.setDialog({ kind: 'leverage', position })");
  });

  test('the page supplies the engine and the account source through the adapter', () => {
    expect(page).toContain('useNativeFuturesExecution(native, nativeContract)');
    expect(page).toContain('<FuturesExecutionProvider value={execution}>');
    expect(page).toContain('<FuturesAccountSourceContext.Provider value={execution.account}>');
    // An ordinary account gets the real execution, by construction.
    expect(page).toContain('nativeExecution ?? REAL_FUTURES_EXECUTION');
  });

  test('the real account store is not polled for the adapter-backed account', () => {
    expect(page).toContain('useFuturesAccount(nativeExecution?{}:{ orders: 5000, positions: 4000 })');
  });

  test('"Торговля с графика" switches chart TOOLS, and drops only an unsent pick', () => {
    // The permanent checkbox above the chart is gone; the same switch now
    // lives in a menu that only exists while it is open.
    expect(page).toContain('<ChartTradingMenu');
    expect(page).not.toContain('<ChartTradingToggle');
    // Off -> the chart's trading interaction is not passed at all.
    expect(page).toContain('privateTrading={nativeExecution&&chartTrading?native.interaction:undefined}');
    // Off -> an unsent selection is cancelled...
    expect(page).toContain('native.interaction.onCancelSelection()');
    // ...and nothing about the account is reset with it.
    expect(page).not.toMatch(/setChartTrading[\s\S]{0,400}?(setPositions|refreshFuturesAccount|initialize)\(/);
  });

  test('the chart menu opens on a double click and nothing else acts on one', () => {
    expect(page).toContain('onDoubleClick');
    expect(page).toContain('setChartMenu({ x: event.clientX, y: event.clientY })');
    // A double click opens a menu. It must not also reach a drawing tool,
    // and it must not pick, place or price anything by itself.
    expect(page).toContain('event.preventDefault()');
    expect(page).toContain('event.stopPropagation()');
    expect(page).not.toMatch(/onDoubleClick[\s\S]{0,600}?(placeOrder|pickEntry|onCandleSelect)\(/);
    // A menu anchored to a point on one contract means nothing on another.
    expect(page).toContain('useEffect(() => { setChartMenu(null); }, [symbol]);');
  });

  test('the double click is decided by the state the gesture STARTED in', () => {
    // The guard exists: with the picker armed, the chart owns the gesture
    // and the menu does not open over it.
    expect(page).toContain('if (pickingAtGestureStart.current) return;');
    // And it is read from a ref recorded on the first press, NOT from
    // `selecting` as it stands when the second click is handled. By then
    // the gesture's own first click has already picked a bar and disarmed
    // the picker, so reading the live value decided the same double click
    // differently depending on whether React had re-rendered in between —
    // under load it had not, and the gesture silently did nothing.
    expect(page).toContain('onPointerDownCapture');
    expect(page).toContain('pickingAtGestureStart.current = native.interaction.selecting !== null;');
    expect(page).not.toMatch(/onDoubleClick[\s\S]{0,900}?if \(native\.interaction\.selecting !== null\) return;/);
    // A ref, not state: a state update scheduled by the first click is not
    // guaranteed to have rendered before the second click is handled.
    expect(page).toContain('const pickingAtGestureStart = useRef(false);');
    // Only the first press of a gesture records it; the second must not
    // overwrite it with the value its own first click just produced.
    expect(page).toMatch(/onPointerDownCapture[\s\S]{0,200}?if \(event\.detail > 1\) return;/);
  });

  test('the account card, not a second terminal, opens the simulation account', () => {
    // The old NativeDemoTicket/NativePanel are not coming back: the one
    // ordinary account panel carries the balance and the one action.
    expect(page).not.toContain('NativeDemoTicket');
    expect(page).not.toContain('NativeDemoPanel');
    const execution = source('lib/useNativeFuturesExecution.ts');
    expect(execution).toContain('native.initialize()');
    // Offered only while the server says there is something to open the
    // account WITH — never as a button that would move nothing.
    expect(execution).toContain("state && !state.initialized ? state.demoAvailable ?? null : null");
    expect(execution).toContain('Number(waiting) > 0');
  });

  test('a legacy private-mode link lands on the ordinary terminal', () => {
    // `?privateTrading=1` is inert: the route selector keys off `?card=`
    // alone, so the old link renders FuturesPage with nothing dropped.
    const route = source('pages/FuturesRoute.tsx');
    expect(route).toContain("params.get('card')");
    expect(route).not.toContain('privateTrading');
    expect(route).not.toContain("params.get('demo')");
  });
});

describe('the adapter projects native state into the terminal shapes', () => {
  const position = {
    id: 'p1', symbol: 'BTCUSDT', side: 'LONG' as const, quantity: '0.5', entryPrice: '60000',
    markPrice: '61000', lastPrice: '61000', leverage: '20', status: 'OPEN' as const,
    openedAt: 1_728_000_000_000, closedAt: null, historical: false,
    unrealizedPnl: '500', realizedPnl: '0', netPnl: '500', roiPercent: '33.33',
    roiBasis: '1500', closedRoiBasis: '0', fundingNet: '-1.2',
    protection: { takeProfit: '65000', stopLoss: null, quantity: null, triggerBy: 'MARK' as const },
    liquidationPrice: '57000', liquidationStatus: 'OK',
    marginMode: 'CROSS' as const, isolatedMargin: '0',
  };

  test('a position becomes the row the ORIGINAL positions table reads', () => {
    const row = adapter.nativePositionToTerminal(position);
    expect(row).toMatchObject({
      id: 'p1', symbol: 'BTC/USDT', side: 'LONG', size: '0.5', entryPrice: '60000',
      leverage: 20, marginType: 'CROSS', initialMargin: '1500',
      liquidationPrice: '57000', markPrice: '61000', unrealizedPnl: '500', roe: '33.33',
    });
    expect(row.openedAt).toBe(new Date(1_728_000_000_000).toISOString());
    // The row reports the bucket the ENGINE settled this position in. It is
    // read off the position, not assumed — the engine settles both now.
    expect(row.marginType).toBe('CROSS');
  });

  test('an isolated position reports its own posted margin, not its cross basis', () => {
    const row = adapter.nativePositionToTerminal({
      ...position, marginMode: 'ISOLATED' as const, isolatedMargin: '900', roiBasis: '1500',
      liquidationStatus: 'ISOLATED_POSITION_ESTIMATE',
    });
    expect(row.marginType).toBe('ISOLATED');
    // What actually backs it is what was posted against it, which is the
    // only figure an isolated position can be liquidated on.
    expect(row.initialMargin).toBe('900');
  });

  test('a partially filled protective exit remains visible as triggering', () => {
    const row = adapter.nativePositionToTerminal({ ...position,
      protection: { ...position.protection, takeProfit: null },
      pendingClose: { reason: 'TAKE_PROFIT', quantity: '0.2', triggerPrice: '65010', triggeredAt: position.openedAt + 1000, actionId: 'exit-1' },
    });
    expect(row.protection?.takeProfit).toMatchObject({ id: 'exit-1', status: 'TRIGGERING', triggerPrice: '65010' });
    expect(row.protection?.stopLoss).toBeNull();
    expect(row.size).toBe(position.quantity);
  });

  test('TP/SL becomes a trigger row without inventing retry bookkeeping', () => {
    const row = adapter.nativePositionToTerminal(position);
    expect(row.protection.takeProfit).toMatchObject({ kind: 'TAKE_PROFIT', triggerPrice: '65000', attempts: 0, lastError: null });
    // Not armed means null, never a zero-priced trigger.
    expect(row.protection.stopLoss).toBeNull();
  });

  test('a liquidation price the engine cannot reach stays null, not a fake number', () => {
    const row = adapter.nativePositionToTerminal({ ...position, liquidationPrice: null });
    expect(row.liquidationPrice).toBeNull();
  });

  test('an order is renamed by DIRECTION, which is how the terminal names it', () => {
    const order = { id: 'o1', symbol: 'ETHUSDT', side: 'SHORT', type: 'LIMIT', quantity: '2', remaining: '0.5', filled: '1.5', averagePrice: '2500', price: '2500', leverage: '10', status: 'PARTIALLY_FILLED', createdAt: 1_728_000_000_000, marginType: 'CROSS' as const };
    expect(adapter.nativeOrderToTerminal(order)).toMatchObject({
      symbol: 'ETH/USDT', side: 'SELL', originalQuantity: '2', remainingQuantity: '0.5', leverage: 10, marginType: 'CROSS',
    });
    expect(adapter.nativeOrderToTerminal(order).reduceOnly).toBe(false);
    expect(adapter.nativeOrderToTerminal({ ...order, reduceOnly: true, positionId: 'p1' }).reduceOnly).toBe(true);
  });

  test('locked margin is used margin plus the order reserve, summed exactly', () => {
    expect(adapter.addDecimalStrings('1500.25', '499.75')).toBe('2000');
    expect(adapter.addDecimalStrings('0.1', '0.2')).toBe('0.3');
    expect(adapter.addDecimalStrings('1', '2')).toBe('3');
  });

  test('an unanswered native state is UNKNOWN everywhere, never an empty account', () => {
    const state = adapter.nativeAccountState(null, { loading: true, failed: false, fetchedAt: 0 });
    for (const key of ['balances', 'positions', 'orders', 'orderHistory', 'positionHistory'] as const) {
      expect(state[key].data).toBeNull();
      expect(state[key].loaded).toBe(false);
    }
  });

  test('an initialised account projects all four resources from one payload', () => {
    const state = adapter.nativeAccountState({
      initialized: true, revision: 3, source: 'DEMO_BALANCE', asOf: 1_728_000_000_000,
      ledger: null,
      model: { version: 'v', funding: { longCashflow: '-0.001', shortCashflow: '0.004', unit: 'FRACTION', intervalMs: 28800000 } },
      account: { settleBalance: '10000', walletCollateral: '0', collateral: '10000', unrealizedPnl: '500', equity: '10500', initialMargin: '1500', orderReserve: '200', available: '8300', maintenanceMargin: '150', initialMarginRatio: null, maintenanceRatio: null, liquidatable: false, collateralComplete: true, unpricedAssets: [], collateralAsOf: null },
      positions: [position], history: [{ ...position, status: 'CLOSED' as const, closedAt: 1_728_000_100_000 }],
      orders: [{ id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', quantity: '1', remaining: '1', filled: '0', averagePrice: null, price: '59000', leverage: '20', status: 'OPEN', createdAt: 1, marginType: 'CROSS' as const }],
      events: [],
    }, { loading: false, failed: false, fetchedAt: 5 });

    expect(state.balances.data).toEqual([{ asset: 'USDT', available: '8300', locked: '1700' }]);
    expect(state.positions.data).toHaveLength(1);
    expect(state.positionHistory.data).toHaveLength(1);
    // Working orders only in `orders`; the full list in `orderHistory`.
    expect(state.orders.data).toHaveLength(1);
    expect(state.orderHistory.data).toHaveLength(1);
    expect(state.positions.data![0].symbol).toBe('BTC/USDT');
  });

  test('the order the terminal submits becomes a native OPEN command', () => {
    const draft = adapter.terminalOrderToNativeDraft({
      symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: '60000', quantity: '0.5', leverage: 20,
    });
    // The bucket travels with the order. Omitting it from the call means
    // Cross, and the draft says so explicitly rather than leaving the
    // server to assume it.
    expect(draft).toEqual({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', quantity: '0.5', leverage: '20', price: '60000', marginType: 'CROSS' });
  });

  test('an isolated order asks for the isolated bucket, not a relabelled cross one', () => {
    const draft = adapter.terminalOrderToNativeDraft({
      symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '0.5', leverage: 10, marginType: 'ISOLATED',
    });
    expect(draft).toMatchObject({ kind: 'OPEN', marginType: 'ISOLATED' });
  });

  test('a picked historical bar travels as the bar IDENTITY, never as a price', () => {
    const draft = adapter.terminalOrderToNativeDraft({
      symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '0.5', leverage: 10,
      candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime: 1_728_000_000_000, pricePoint: 'CLOSE' },
    });
    expect(draft).toMatchObject({ candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime: 1_728_000_000_000 } });
    // The client names the bar; the SERVER prices it.
    expect(JSON.stringify(draft)).not.toContain('"price"');
  });

  test('the chart marker and the table row are the SAME position', () => {
    // The adapter keeps the engine's own position id, and the chart overlay
    // is built from the same id (useNativeDemo -> interaction.trades), so a
    // marker on the chart and a row in the table cannot refer to different
    // positions. The card button is keyed by that id too.
    expect(adapter.nativePositionToTerminal(position).id).toBe(position.id);
    const hook = readFileSync(resolve(frontend, 'src/pages/private-trading/useNativeDemo.tsx'), 'utf8');
    expect(hook).toContain('trades:ChartTradeOverlay[]');
    expect(hook).toMatch(/\.map\(p=>\{[\s\S]{0,400}id:p\.id,/);
    const exec = readFileSync(resolve(frontend, 'src/lib/useNativeFuturesExecution.ts'), 'utf8');
    expect(exec).toContain('showPnlCard: (positionId: string) => { void native.showCard(positionId); }');
  });

  test('symbols round-trip between the two namings', () => {
    for (const pair of ['BTC/USDT', 'ETH/USDT', '1000PEPE/USDT', 'SOL/USDT']) {
      expect(adapter.nativeSymbolToPair(adapter.pairToNativeSymbol(pair))).toBe(pair);
    }
  });
});

describe('the terminal sizes to the contract it is trading', () => {
  const rules = { qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1190', maxMarketOrderQty: '120', minNotionalValue: '5' };

  test('a slider quantity is floored onto the contract step, never rounded onto it', () => {
    const fitted = futuresMath.fitQuantityToContract(1.66666667, 60000, rules, { market: false });
    expect(fitted.quantity).toBe(1.666);
    expect(fitted.quantity).toBeLessThan(1.66666667);
    expect(fitted.rejectedBy).toBeNull();
  });

  test('a MARKET order is capped by the contract market ceiling, and says so', () => {
    const fitted = futuresMath.fitQuantityToContract(500, 60000, rules, { market: true });
    expect(fitted.quantity).toBe(120);
    expect(fitted.cappedBy).toBe('maxMarketOrderQty');
    // A LIMIT order of the same size is not: it has its own, higher ceiling.
    expect(futuresMath.fitQuantityToContract(500, 60000, rules, { market: false }).cappedBy).toBeNull();
  });

  test('below the floor it refuses and NAMES the rule rather than sizing up', () => {
    const tiny = futuresMath.fitQuantityToContract(0.0005, 60000, rules, { market: false });
    expect(tiny.quantity).toBe(0);
    expect(tiny.rejectedBy).toBe('minOrderQty');
    expect(tiny.limit).toBe('0.001');

    const cheap = futuresMath.fitQuantityToContract(0.001, 1, rules, { market: false });
    expect(cheap.rejectedBy).toBe('minNotionalValue');
    expect(cheap.limit).toBe('5');
  });

  test('a whole-number step is honoured exactly', () => {
    const meme = { qtyStep: '10', minOrderQty: '10', maxOrderQty: '50000000', maxMarketOrderQty: '10000000', minNotionalValue: '5' };
    const fitted = futuresMath.fitQuantityToContract(121951219.512, 0.0082, meme, { market: false });
    expect(fitted.quantity % 10).toBe(0);
    expect(fitted.quantity).toBeLessThanOrEqual(121951219.512);
    expect(futuresMath.stepDecimals('10')).toBe(0);
    expect(futuresMath.stepDecimals('0.001')).toBe(3);
  });

  test('no rules published means the terminal enforces none of its own', () => {
    // Every real account: the real engine has no contract step, so nothing
    // here may invent one.
    expect(futuresMath.fitQuantityToContract(1.66666667, 60000, { ...rules, qtyStep: '0' }, { market: false }).quantity).toBe(0);
  });
});
