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
  };

  test('a position becomes the row the ORIGINAL positions table reads', () => {
    const row = adapter.nativePositionToTerminal(position);
    expect(row).toMatchObject({
      id: 'p1', symbol: 'BTC/USDT', side: 'LONG', size: '0.5', entryPrice: '60000',
      leverage: 20, marginType: 'CROSS', initialMargin: '1500',
      liquidationPrice: '57000', markPrice: '61000', unrealizedPnl: '500', roe: '33.33',
    });
    expect(row.openedAt).toBe(new Date(1_728_000_000_000).toISOString());
    // Cross is what the engine settles in; the row says so rather than
    // labelling itself Изолированная.
    expect(row.marginType).toBe('CROSS');
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
    const order = { id: 'o1', symbol: 'ETHUSDT', side: 'SHORT', type: 'LIMIT', quantity: '2', remaining: '0.5', filled: '1.5', averagePrice: '2500', price: '2500', leverage: '10', status: 'PARTIALLY_FILLED', createdAt: 1_728_000_000_000 };
    expect(adapter.nativeOrderToTerminal(order)).toMatchObject({
      symbol: 'ETH/USDT', side: 'SELL', originalQuantity: '2', remainingQuantity: '0.5', leverage: 10, marginType: 'CROSS',
    });
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
      orders: [{ id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', quantity: '1', remaining: '1', filled: '0', averagePrice: null, price: '59000', leverage: '20', status: 'OPEN', createdAt: 1 }],
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
    expect(draft).toEqual({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', quantity: '0.5', leverage: '20', price: '60000' });
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
