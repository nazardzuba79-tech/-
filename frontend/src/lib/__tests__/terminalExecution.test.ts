import { readFileSync } from 'fs';
import { resolve } from 'path';
import { aggregateTerminalBook, createTerminalOrderDraft, defaultTerminalGroupStep,
  formatTerminalLevelPrice, formatTerminalQuote, formatTerminalSpreadPercent, hasTerminalUsdApproximation,
  positiveTerminalNumber, terminalDraftGuides, terminalGroupSteps,
  TerminalOrderType } from '../terminalExecution';

const fields = {
  pair: 'BTC/USDT', side: 'BUY' as const, price: '60000', triggerPrice: '61000',
  ocoTakeProfitPrice: '65000', ocoStopTriggerPrice: '58000', quantity: '0.5',
};
const readComponent = (file: string) => readFileSync(resolve(__dirname, '../../components', file), 'utf8');

describe('unsaved terminal order guides', () => {
  test.each([
    ['LIMIT', 60000, null, null],
    ['MARKET', null, null, null],
    ['STOP_LIMIT', 60000, 61000, null],
    ['STOP_MARKET', null, 61000, null],
    ['TAKE_PROFIT_LIMIT', 60000, null, 61000],
    ['TAKE_PROFIT_MARKET', null, null, 61000],
    ['OCO', null, 58000, 65000],
  ] as [TerminalOrderType, number | null, number | null, number | null][])
  ('%s maps only its actual form fields', (type, entryPrice, stopPrice, takeProfitPrice) => {
    expect(createTerminalOrderDraft({ ...fields, type })).toEqual({
      pair: fields.pair, side: 'BUY', type, entryPrice, stopPrice, takeProfitPrice, quantity: 0.5,
    });
  });

  test.each(['', ' ', '0', '-1', '12oops', 'Infinity', 'NaN'])('invalid/nonpositive input %p never becomes a chart price', value => {
    expect(positiveTerminalNumber(value)).toBeNull();
    expect(createTerminalOrderDraft({ ...fields, type: 'LIMIT', price: value, quantity: '' })).toBeNull();
  });

  test('small prices retain precision and quantity is independent of chart levels', () => {
    expect(createTerminalOrderDraft({ ...fields, type: 'LIMIT', price: '0.00001345', quantity: '250000' }))
      .toMatchObject({ entryPrice: 0.00001345, quantity: 250000 });
    const market = createTerminalOrderDraft({ ...fields, type: 'MARKET' });
    expect(market!.quantity).toBe(0.5);
    expect(terminalDraftGuides(market, fields.pair)).toEqual([]);
  });

  test('conditional execution limits are not presented as attached bracket entries', () => {
    const stop = createTerminalOrderDraft({ ...fields, type: 'STOP_LIMIT' });
    expect(terminalDraftGuides(stop, fields.pair).map(guide => guide.kind)).toEqual(['EXECUTION_LIMIT', 'STOP']);
    expect(terminalDraftGuides(stop, fields.pair)[0].title).toBe('LIMIT EXECUTION · DRAFT');
    const oco = createTerminalOrderDraft({ ...fields, side: 'SELL', type: 'OCO' });
    expect(terminalDraftGuides(oco, fields.pair).map(guide => guide.kind)).toEqual(['STOP', 'TAKE_PROFIT']);
    expect(oco!.entryPrice).toBeNull();
    expect(terminalDraftGuides(oco, fields.pair).every(guide => guide.title.includes('DRAFT'))).toBe(true);
  });

  test('OCO optionally previews the real stop-limit execution input without adding a third order', () => {
    const oco = createTerminalOrderDraft({ ...fields, type: 'OCO', ocoStopLimitPrice: '57500' });
    expect(oco!.entryPrice).toBeNull();
    expect(oco!.stopLimitPrice).toBe(57500);
    const guides = terminalDraftGuides(oco, fields.pair);
    expect(guides.map(guide => guide.kind)).toEqual(['STOP', 'TAKE_PROFIT', 'STOP_LIMIT']);
    expect(guides[2]).toMatchObject({ price: 57500, title: 'STOP LIMIT · DRAFT' });
    expect(terminalDraftGuides({ ...oco!, stopLimitPrice: null }, fields.pair)).toHaveLength(2);
    expect(terminalDraftGuides({ ...oco!, type: 'MARKET' }, fields.pair)).toEqual([]);
    expect(createTerminalOrderDraft({ ...fields, type: 'LIMIT', ocoStopLimitPrice: '57500' }))
      .not.toHaveProperty('stopLimitPrice');
  });

  test('guides reject a previous pair and revalidate externally supplied values', () => {
    const draft = createTerminalOrderDraft({ ...fields, type: 'LIMIT' })!;
    expect(terminalDraftGuides(draft, 'ETH/USDT')).toEqual([]);
    expect(terminalDraftGuides({ ...draft, entryPrice: Infinity, stopPrice: 50000 }, fields.pair)).toEqual([]);
    expect(terminalDraftGuides({ ...draft, type: 'MARKET', entryPrice: 60000 }, fields.pair)).toEqual([]);
    expect(terminalDraftGuides(null, fields.pair)).toEqual([]);
  });
});

describe('real order-book grouping and row precision', () => {
  test('grouped bids floor, asks ceil, quantity accumulates and depth runs away from the spread', () => {
    const bids = [{ price: '100.05', quantity: '1' }, { price: '100.09', quantity: '2' }, { price: '99.99', quantity: '3' }];
    const asks = [{ price: '100.11', quantity: '4' }, { price: '100.19', quantity: '5' }, { price: '100.21', quantity: '6' }];
    expect(aggregateTerminalBook(bids, 0.1, 'BUY')).toEqual([
      { price: 100, quantity: 3, cumulative: 3 }, { price: 99.9, quantity: 3, cumulative: 6 },
    ]);
    expect(aggregateTerminalBook(asks, 0.1, 'SELL')).toEqual([
      { price: 100.2, quantity: 9, cumulative: 9 }, { price: 100.3, quantity: 6, cumulative: 15 },
    ]);
    expect(bids[0].price).toBe('100.05'); // Raw inputs are not rewritten.
    expect(asks[0].price).toBe('100.11');
  });

  test('machine rounding at an exact decimal grid boundary does not move a level a full bucket', () => {
    for (const side of ['BUY', 'SELL'] as const) {
      expect(aggregateTerminalBook([{ price: '0.3', quantity: '2' }], 0.1, side)[0].price).toBe(0.3);
      expect(aggregateTerminalBook([{ price: '0.00001345', quantity: '2' }], 1e-8, side)[0].price).toBe(0.00001345);
    }
  });

  test.each([60000, 3000, 100, 0.55, 0.00001345, 0.000000001])
  ('%p reference supplies a valid default and significant low-price rows', reference => {
    const steps = terminalGroupSteps(reference);
    const step = defaultTerminalGroupStep(reference);
    expect(steps).toContain(step);
    expect(steps.every(value => value > 0 && Number.isFinite(value))).toBe(true);
    expect(new Set(steps).size).toBe(steps.length);
    const raw = [0.001, 0.002, 0.003].map(offset => ({ price: String(reference * (1 - offset)), quantity: '10' }));
    const grouped = aggregateTerminalBook(raw, step, 'BUY');
    expect(grouped.length).toBeGreaterThan(1);
    expect(grouped.every(level => level.price > 0)).toBe(true);
    expect(grouped.reduce((sum, level) => sum + level.quantity, 0)).toBe(30);
    for (const level of grouped) expect(Number(formatTerminalLevelPrice(level.price, step))).toBe(level.price);
  });

  test('clickable low-price values are not rounded into 0.00', () => {
    expect(formatTerminalLevelPrice(0.00001345, 1e-8)).toBe('0.00001345');
    expect(formatTerminalLevelPrice(0.000000001, 1e-12)).toBe('0.000000001000');
    expect(formatTerminalLevelPrice(100.5, 0.5)).toBe('100.5');
    expect(formatTerminalQuote(0.00000001)).toBe('0.00000001');
    expect(formatTerminalQuote(0.000013455)).toBe('0.000013455');
    expect(formatTerminalQuote(60000.25)).toBe('60,000.25');
    expect(formatTerminalQuote(NaN)).toBe('—');
  });

  test('tiny nonzero spread percentages remain visible instead of becoming 0.000%', () => {
    expect(formatTerminalSpreadPercent(0.000125)).toBe('0.000125%');
    expect(formatTerminalSpreadPercent(0.000000017)).toBe('0.000000017%');
    expect(formatTerminalSpreadPercent(0.012345)).toBe('0.012%');
    expect(formatTerminalSpreadPercent(0)).toBe('0%');
    expect(formatTerminalSpreadPercent(Infinity)).toBe('—');
  });

  test('USD approximation is absent on EUR/BTC/ETH and unsupported quote assets', () => {
    for (const pair of ['BTC/USD', 'BTC/USDT', 'ETH/USDC']) expect(hasTerminalUsdApproximation(pair)).toBe(true);
    for (const pair of ['BTC/EUR', 'ETH/BTC', 'SOL/ETH', 'BTC/GBP', 'USDT/EUR', 'BTC', undefined]) {
      expect(hasTerminalUsdApproximation(pair)).toBe(false);
    }
  });

  test('empty and invalid liquidity never fabricate volume or a price', () => {
    expect(aggregateTerminalBook([], 1, 'BUY')).toEqual([]);
    expect(aggregateTerminalBook([{ price: '12oops', quantity: '4' }, { price: '5', quantity: '-2' },
      { price: '0', quantity: '1' }, { price: '5', quantity: '0' }], 1, 'SELL')).toEqual([]);
    expect(aggregateTerminalBook([{ price: '5', quantity: '2' }], 0, 'BUY')).toEqual([]);
    expect(terminalGroupSteps(null)).toContain(defaultTerminalGroupStep(null));
    expect(terminalGroupSteps(null)).toContain(0.5);
  });
});

describe('terminal integration preservation boundaries', () => {
  test('pair-list precision is an opt-in display formatter, not a data/sorting change', () => {
    const pairs = readComponent('PairListSidebar.tsx');
    expect(pairs).toContain('priceFormatter?: (price: number) => string');
    expect(pairs).toContain('priceFormatter = formatPrice');
    expect(pairs).toContain('<span className="p-price">{priceFormatter(parseFloat(tk.lastPrice))}</span>');
    expect(pairs.match(/priceFormatter\(/g)).toHaveLength(1);
    expect(pairs).toContain('filterAndSortPairs(');
    expect(pairs).toContain('sortSnapshotRef');
    expect(pairs).toContain('toggleFavorite(tk.pair, e)');
    expect(formatTerminalQuote(0.000000012)).toBe('0.000000012');
    expect(formatTerminalQuote(0.0000000875)).toBe('0.0000000875');
  });

  test('OrderForm keeps the real submit payloads, OCO leg inputs and unavailable-account distinction', () => {
    const form = readComponent('OrderForm.tsx');
    expect(form).toContain('await api.placeOcoOrder({');
    expect(form).toContain('takeProfitPrice: ocoTakeProfitPrice');
    expect(form).toContain('stopTriggerPrice: ocoStopTriggerPrice');
    expect(form).toContain('stopLimitPrice: ocoStopLimitPrice');
    expect(form).toContain('await api.placeOrder({');
    expect(form).toContain('triggerPrice: isConditional ? triggerPrice : undefined');
    expect(form).toContain('useState<{ base: number; quote: number } | null>(null)');
    expect(form).toContain('disabled={!available}');
    expect(form).toContain("import.meta.env.MODE === 'review'");
    expect(form).toContain("{reviewOnly ? '—' : `${feeAmount} ${quoteAsset} (0%)`}");
    expect(form).toContain('compact = false');
    expect(form).toContain('{!compact && <>');
    expect(form).toContain('fieldsPair === pair ? createTerminalOrderDraft');
    expect(form).toContain('draftCallback.current?.(null)');
  });

  test('PriceChart separates removable read-only guides from persisted conditional orders and drawings', () => {
    const chart = readComponent('PriceChart.tsx');
    expect(chart).toContain('previewPriceLinesRef');
    expect(chart).toContain('series.removePriceLine(line)');
    expect(chart).toContain('return clearPreviewPriceLines;');
    expect(chart).toContain('terminalDraftGuides(draft, pair)');
    expect(chart).toContain('if (!terminal) return;');
    expect(chart).toContain('guidePrice, pair, interval, chartType, terminal');
    expect(chart).toContain("appearance = 'default'");
    expect(chart).toContain("const premium = terminal && appearance === 'premium'");
    expect(chart).toContain("getMyOrders('PENDING_TRIGGER')");
    expect(chart).toContain('await api.updateOrderTrigger(drag.id, payload)');
    expect(chart).toContain('const gap = drag.startExecPrice - drag.startTriggerPrice');
    expect(chart).toContain('priceLinesRef.current.push(line)');
    expect(chart).toContain('api.getExternalCandles(pair, interval, CANDLE_FETCH_LIMIT)');
  });

  test('book prices/spread share raw-metrics authority; hover/focus never submit or change the draft', () => {
    const book = readComponent('OrderBookPanel.tsx');
    expect(book).toContain('terminalBookMetrics(bids, asks)');
    expect(book).toContain('hasTerminalUsdApproximation(pair)');
    expect(book).toContain('showUsd && midPrice !== null');
    expect(book).toContain('formatTerminalSpreadPercent(spreadPct)');
    expect(book).not.toContain('bestAsk - bestBid');
    expect(book).toContain('onPick?.(priceText)');
    expect(book).not.toContain('onPick?.(level.price.toFixed(2))');
    expect(book).toContain('onMouseEnter={() => onHover?.(level.price)}');
    expect(book).toContain('onMouseLeave={() => onHover?.(null)}');
    expect(book).toContain('onFocus={() => onHover?.(level.price)}');
    expect(book).toContain('onBlur={() => onHover?.(null)}');
    expect(book).not.toMatch(/placeOrder|updateOrderTrigger|onDraftChange/);
  });

  test('ascending ask DOM is reversed visually so the best ask is next to the mid-price', () => {
    const css = readFileSync(resolve(__dirname, '../../pages/trade-terminal/TradeTerminal.css'), 'utf8');
    expect(css.match(/\.trade-terminal \.orderbook-asks\s*\{([^}]+)\}/)?.[1]).toContain('flex-direction: column-reverse');
    const asks = aggregateTerminalBook([{ price: '101', quantity: '1' }, { price: '103', quantity: '2' },
      { price: '102', quantity: '3' }], 1, 'SELL');
    expect(asks.map(ask => ask.price)).toEqual([101, 102, 103]);
    const book = readComponent('OrderBookPanel.tsx');
    expect(book).toContain('asksDepth.map((level)');
    expect(book).not.toContain('asksDepth.reverse(');
  });
});
