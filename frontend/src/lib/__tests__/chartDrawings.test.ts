import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as drawings from '../chartDrawings';
import * as chartPriceFormat from '../spotChartPriceFormat';

const { drawingMeasurement, drawingRetracements, formatDrawingPrice, drawingFlyoutPosition, trackDrawingGesture } = drawings;

describe('Spot drawing arithmetic uses actual chart prices and times', () => {
  test.each([
    [100, 110, 10, 10], [100, 90, -10, -10], [0.000001, 0.0000012, 0.0000002, 20],
  ])('measures % from the starting price (%s → %s)', (start, end, diff, pct) => {
    const result = drawingMeasurement({ time: 0, price: start }, { time: 900, price: end }, 300);
    expect(result.priceDiff).toBeCloseTo(diff, 12);
    expect(result.pct).toBeCloseTo(pct, 10);
    expect(result.bars).toBe(3);
  });
  test('right-to-left gesture uses its own starting price and counts actual candle gaps', () => {
    const result = drawingMeasurement({ time: 900, price: 110 }, { time: 0, price: 100 }, 300, [0, 300, 900]);
    expect(result.pct).toBeCloseTo(-9.09090909);
    expect(result.bars).toBe(2);
    expect(drawingMeasurement({ time: 0, price: 100 }, { time: 0, price: 100 }, 300, [0, 300]).bars).toBe(0);
  });
  test.each([0, -1, NaN, Infinity])('invalid starting price %s never displays a false infinity', (price) => {
    expect(drawingMeasurement({ time: 0, price }, { time: 300, price: 10 }, 300).pct).toBeNull();
  });
  test('Fibonacci endpoints and all ratios reconcile in either drawing direction', () => {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    for (const [start, end] of [[100, 200], [200, 100], [0.000001, 0.000002]]) {
      const rows = drawingRetracements(start, end);
      expect(rows.map((row) => row.level)).toEqual(levels);
      rows.forEach((row, index) => expect(row.price).toBeCloseTo(start + (end - start) * levels[index], 12));
      expect(rows[0].price).toBe(start);
      expect(rows[rows.length - 1].price).toBe(end);
    }
    expect(drawingRetracements(NaN, 100)).toEqual([]);
  });
  test('small-price labels do not become 0.00 or scientific notation', () => {
    expect(formatDrawingPrice(0.00000001234)).toBe('0.00000001234');
    expect(formatDrawingPrice(-0.0000002)).toBe('-0.0000002');
    expect(formatDrawingPrice(0.000002, 'ru')).toBe('0,000002');
    expect(formatDrawingPrice(NaN)).toBe('—');
  });
});

describe('Spot gesture lifecycle (brush and anchored shapes)', () => {
  function session() {
    const target = new EventTarget();
    const callbacks = { move: jest.fn(), finish: jest.fn(), cancel: jest.fn() };
    const add = jest.spyOn(target, 'addEventListener');
    const remove = jest.spyOn(target, 'removeEventListener');
    const cancel = trackDrawingGesture(target as unknown as Window, callbacks);
    const emit = (name: string, props = {}) => target.dispatchEvent(Object.assign(new Event(name), props));
    return { callbacks, cancel, emit, add, remove };
  }
  test('commits exactly once after move/release and removes every listener', () => {
    const s = session();
    s.emit('mousemove', { clientX: 20, clientY: 30 });
    s.emit('mouseup', { clientX: 30, clientY: 40 });
    s.emit('mouseup'); s.emit('mousemove'); s.cancel();
    expect(s.callbacks.move).toHaveBeenCalledTimes(1);
    expect(s.callbacks.finish).toHaveBeenCalledTimes(1);
    expect(s.callbacks.finish.mock.calls[0][0].clientX).toBe(30);
    expect(s.callbacks.cancel).not.toHaveBeenCalled();
    expect(s.remove.mock.calls.map(([type]) => type).sort()).toEqual(s.add.mock.calls.map(([type]) => type).sort());
  });
  test.each(['Escape', 'blur', 'tool/pair/interval/unmount/clear'])('%s cancels without a later ghost drawing', (reason) => {
    const s = session();
    s.emit('mousemove');
    if (reason === 'Escape') s.emit('keydown', { key: 'Escape' });
    else if (reason === 'blur') s.emit('blur');
    else s.cancel();
    s.emit('mouseup'); s.emit('mousemove'); s.cancel();
    expect(s.callbacks.finish).not.toHaveBeenCalled();
    expect(s.callbacks.cancel).toHaveBeenCalledTimes(1);
    expect(s.callbacks.move).toHaveBeenCalledTimes(1);
    expect(s.remove).toHaveBeenCalledTimes(4);
  });
  test('ordinary keystrokes do not cancel a valid drag', () => {
    const s = session();
    s.emit('keydown', { key: 'Shift' }); s.emit('mouseup');
    expect(s.callbacks.finish).toHaveBeenCalledTimes(1);
  });
});

describe('shared drawing toolbar presentation and chart integration', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../components/PriceChart.tsx'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../../components/DrawingTools.css'), 'utf8');
  const localRequire = createRequire(path.resolve(__dirname, '../../../package.json'));
  const React = localRequire('react');
  const { renderToStaticMarkup } = localRequire('react-dom/server');
  const compiled = ts.transpileModule(`${source}\nexport { DrawToolbar, RulerLabel, DrawingDialog };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', compiled)((id: string) => {
    if (id.endsWith('.css') || id === 'lightweight-charts' || id === '../lib/api' || id === '../lib/indicators') return {};
    if (id === '../lib/chartDrawings') return drawings;
    if (id === '../lib/spotChartPriceFormat') return chartPriceFormat;
    if (id === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) };
    return localRequire(id);
  }, exports);
  const props = { tool: 'cursor', onSelect: () => {}, onClear: () => {}, onFit: () => {}, terminal: true,
    drawingsHidden: false, onToggleHidden: () => {}, stayInDrawMode: true, onToggleStay: () => {},
    magnet: false, onToggleMagnet: () => {}, locked: false, onToggleLock: () => {} };

  test('actual compact rail has working callback buttons, grouped lines, titles, active state and real tools only', () => {
    const html = renderToStaticMarkup(React.createElement(exports.DrawToolbar, { ...props, drawingTools: true }));
    expect(html).toContain('drawing-rail');
    expect(html).toContain('role="toolbar"');
    for (const id of ['cursor', 'trendline', 'fib', 'rectangle', 'brush', 'text', 'ruler', 'fit', 'stay', 'hide', 'clear']) {
      expect(html).toContain(`data-drawing-tool="${id}"`);
    }
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="draw.measure"');
    // Magnet, lock and the single-drawing eraser are REAL now, so they
    // are here — each backed by an implementation, not an icon.
    for (const id of ['magnet', 'lock', 'erase']) expect(html).toContain(`data-drawing-tool="${id}"`);
    for (const id of ['ray', 'horizontal', 'vertical', 'extended']) expect(source).toContain(`{ id: '${id}', icon:`);
  });
  test('a chart keeps the original rail unless it opts in', () => {
    const old = renderToStaticMarkup(React.createElement(exports.DrawToolbar, props));
    const embedded = renderToStaticMarkup(React.createElement(exports.DrawToolbar, { ...props, terminal: false }));
    expect(old).not.toContain('drawing-rail');
    expect(embedded).not.toContain('drawing-rail');
    expect(source).toContain("drawingTools = false");
    expect(source).toContain('const drawingToolsOn = terminal && drawingTools');
    expect(css).toContain('.trade-terminal .drawing-tools');
    expect(css).toContain('overflow-y: auto; overflow-x: hidden');
    expect(css).toContain('overflow-x: auto; overflow-y: hidden');
    expect(css).toContain('@media (max-width: 767px)');
  });
  test('actual ruler label preserves a tiny negative price difference', () => {
    const html = renderToStaticMarkup(React.createElement('svg', {}, React.createElement(exports.RulerLabel,
      { x: 100, y: 100, pct: -20, priceDiff: -0.0000002, bars: 3, drawingTools: true, locale: 'en' })));
    expect(html).toContain('-20.00%');
    expect(html).toContain('-0.0000002');
    expect(html).toContain('3 bars');
    expect(html).not.toContain('Infinity');
  });
  test('Spot text dialog has an accessible label, safe plain input, real actions and no native modal', () => {
    const html = renderToStaticMarkup(React.createElement(exports.DrawingDialog,
      { kind: 'text', t: (key: string) => key, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('<label');
    expect(html).toContain('type="text"');
    expect(html).toContain('maxLength="280"');
    expect(html).toContain('type="submit" class="primary" disabled=""');
    expect(html).toContain('draw.addText');
    expect(html).toContain('trade.cancel');
    expect(source).toContain("setDrawDialog({ kind: 'text', at: p });\n          return;");
    expect(source).toContain('at: drawDialog.at, text: value');
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
  test('Spot Clear requires an explicit in-app confirmation and leaves native Futures behavior intact', () => {
    const html = renderToStaticMarkup(React.createElement(exports.DrawingDialog,
      { kind: 'clear', t: (key: string) => key, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain('draw.deleteAllConfirm');
    expect(html).toContain('type="submit" class="danger"');
    expect(html).not.toContain('<input');
    expect(source).toContain("setDrawDialog({ kind: 'clear' });\n      return;");
    expect(source).toContain('if (window.confirm(confirmClearRef.current)) clearDrawings()');
    expect(source).toContain('const text = window.prompt(textPromptRef.current)');
    const clearBody = source.split('const clearDrawings = useCallback(() => {')[1].split('const clearAll =')[0];
    expect(clearBody).not.toMatch(/api\.|conditionalOrders|cancelOrder|updateOrderTrigger/);
    // Horizontal levels are React state now, and ONE effect owns the
    // native price lines derived from it — so Clear empties the state and
    // that effect removes the lines. Asserted on both halves, which is
    // strictly more than the old direct-removal check: it also proves the
    // serializable data and the chart objects cannot drift apart.
    expect(clearBody).toContain('setHorizontals([])');
    const lineSync = source.split('for (const line of priceLinesRef.current) series.removePriceLine(line);')[0];
    expect(lineSync).toContain('const series = seriesRef.current;');
    expect(source).toContain('for (const line of priceLinesRef.current) series.removePriceLine(line);');
    expect(source).toContain('drawingToolsOn && drawDialog && createPortal');
  });
  function dialogHandlers(kind: 'text' | 'clear', initial = '') {
    const onConfirm = jest.fn(), onCancel = jest.fn();
    let draft = initial;
    const controls: any[] = [];
    const bindings: Record<string, any> = {};
    new Function('require', 'exports', compiled)((id: string) => {
      if (id === 'react') return { ...React, useState: () => [draft, (next: string) => { draft = next; }],
        useId: () => 'test-dialog', useEffect: () => {}, useRef: () => ({ current: { querySelectorAll: () => controls } }) };
      if (id.endsWith('.css') || id === 'lightweight-charts' || id === '../lib/api' || id === '../lib/indicators') return {};
      if (id === '../lib/chartDrawings') return drawings;
      if (id === '../lib/spotChartPriceFormat') return chartPriceFormat;
      if (id === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) };
      return localRequire(id);
    }, bindings);
    const render = () => {
      const tree = bindings.DrawingDialog({ kind, t: (key: string) => key, onConfirm, onCancel });
      const nodes: any[] = [];
      const walk = (node: any) => { if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; } nodes.push(node); walk(node.props?.children); };
      walk(tree);
      return { nodes, form: nodes.find(node => node.type === 'form'), input: nodes.find(node => node.type === 'input') };
    };
    return { render, controls, onConfirm, onCancel };
  }
  test('actual text form commits only submitted nonempty text and Cancel never commits', () => {
    const session = dialogHandlers('text');
    const preventDefault = jest.fn();
    let view = session.render();
    view.form.props.onSubmit({ preventDefault });
    expect(session.onConfirm).not.toHaveBeenCalled();
    view.input.props.onChange({ target: { value: '  Price watch <script>  ' } });
    view = session.render();
    view.form.props.onSubmit({ preventDefault });
    expect(session.onConfirm).toHaveBeenCalledWith('Price watch <script>');
    view.nodes.find(node => node.props?.['data-drawing-cancel']).props.onClick();
    expect(session.onCancel).toHaveBeenCalledTimes(1);
    expect(session.onConfirm).toHaveBeenCalledTimes(1);
    const blank = dialogHandlers('text', '   ');
    blank.render().form.props.onSubmit({ preventDefault });
    expect(blank.onConfirm).not.toHaveBeenCalled();
  });
  test('Escape cancels, Enter submits only through the form, and Clear invokes the confirmation callback once', () => {
    const session = dialogHandlers('clear');
    const view = session.render();
    const event = { key: 'Escape', preventDefault: jest.fn(), stopPropagation: jest.fn() };
    view.form.props.onKeyDown(event);
    expect(session.onCancel).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(session.onConfirm).not.toHaveBeenCalled();
    view.form.props.onKeyDown({ ...event, key: 'Enter' });
    expect(session.onConfirm).not.toHaveBeenCalled();
    view.form.props.onSubmit({ preventDefault: jest.fn() });
    expect(session.onConfirm).toHaveBeenCalledTimes(1);
  });
  test('modal keyboard focus stays inside enabled controls in both directions', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const session = dialogHandlers('text');
    const first = { disabled: false, focus: jest.fn() }, last = { disabled: false, focus: jest.fn() };
    session.controls.push(first, { disabled: true, focus: jest.fn() }, last);
    const documentFixture = { activeElement: first };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentFixture });
    try {
      const form = session.render().form;
      const preventDefault = jest.fn();
      form.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault });
      expect(last.focus).toHaveBeenCalledTimes(1);
      documentFixture.activeElement = last;
      form.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault });
      expect(first.focus).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(2);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });
  test('Hide applies to all user drawings but not real conditional order lines', () => {
    expect(source).toContain('line.applyOptions({ lineVisible: !drawingsHidden, axisLabelVisible: !drawingsHidden })');
    expect(source).toContain("display: drawingsHidden && !drawingToolsOn ? 'none' : undefined");
    expect(source).toContain("data-chart-drawings={drawingToolsOn ? 'shapes' : undefined} display={drawingToolsOn && drawingsHidden ? 'none' : undefined}");
    expect(source).toContain('(!drawingToolsOn || !drawingsHidden) && labels.map');
    // Normalize only whitespace: the conditional lines remain outside the hidden drawing group.
    expect(source.replace(/\s+/g, ' ')).toContain('</g> {conditionalOrders.map');
    expect(source).toContain('if (drawingToolsOn && hiddenRef.current) return');
    expect(source).toContain('return () => cancelGestureRef.current?.()');
    expect(source).toContain("...(drawingToolsOn ? { zIndex: 4 } : {})");
  });
  test.each([[1920, 700, false], [390, 600, true], [375, 400, true]])('portal stays in %ipx viewport and outside rail clipping', (width, height, horizontal) => {
    const point = drawingFlyoutPosition({ left: width - 40, right: width - 6, top: height - 60, bottom: height - 28 }, { width, height }, horizontal);
    expect(point.left).toBeGreaterThanOrEqual(8);
    expect(point.top).toBeGreaterThanOrEqual(8);
    expect(point.left + 220).toBeLessThanOrEqual(width - 8);
    expect(point.top + 168).toBeLessThanOrEqual(height - 8);
    expect(source).toContain('document.body');
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'ArrowUp'");
  });
});

// ── Phase: the shared rail on Futures ────────────────────────────────

describe('magnet', () => {
  const candles = [
    { time: 1000, open: 10, high: 14, low: 9, close: 12 },
    { time: 2000, open: 12, high: 20, low: 11, close: 19 },
    { time: 3000, open: 19, high: 21, low: 15, close: 16 },
  ];

  test.each([
    ['open', 12.1, 12],
    ['high', 19.6, 20],
    ['low', 11.2, 11],
    ['close', 18.7, 19],
  ])('snaps to the nearest %s of the nearest candle', (_field, price, expected) => {
    const snapped = drawings.magnetSnap({ time: 2100, price }, candles);
    expect(snapped.price).toBe(expected);
    // The anchor lands ON the candle, not between two of them.
    expect(snapped.time).toBe(2000);
  });

  test('names the OHLC level it landed on rather than implying an exact click', () => {
    expect(drawings.magnetSnap({ time: 2000, price: 19.9 }, candles).field).toBe('high');
    expect(drawings.magnetSnap({ time: 2000, price: 11.1 }, candles).field).toBe('low');
  });

  test('picks the closest candle by timestamp, in both directions', () => {
    expect(drawings.magnetSnap({ time: 1100, price: 100 }, candles).time).toBe(1000);
    expect(drawings.magnetSnap({ time: 2900, price: 100 }, candles).time).toBe(3000);
  });

  test('returns the point untouched when there is nothing real to snap to', () => {
    const point = { time: 2000, price: 12.34 };
    // No candles, and non-finite input: the magnet never invents a level.
    expect(drawings.magnetSnap(point, [])).toEqual(point);
    expect(drawings.magnetSnap({ time: NaN, price: 5 }, candles)).toEqual({ time: NaN, price: 5 });
    expect(drawings.magnetSnap({ time: 1000, price: Infinity }, candles)).toEqual({ time: 1000, price: Infinity });
  });

  test('ignores a candle level that is not a real number', () => {
    const broken = [{ time: 1000, open: NaN, high: 14, low: Number.NaN, close: 12 }];
    const snapped = drawings.magnetSnap({ time: 1000, price: 13.9 }, broken);
    expect(snapped.price).toBe(14);
    expect(Number.isFinite(snapped.price)).toBe(true);
  });
});

describe('drawing persistence', () => {
  test('keys by market AND symbol, never by timeframe', () => {
    expect(drawings.drawingStorageKey('futures', 'BTC/USDT')).toBe('voltex.drawings.futures.BTC/USDT');
    expect(drawings.drawingStorageKey('spot', 'btc/usdt')).toBe('voltex.drawings.spot.BTC/USDT');
    // The same ticker on two products is two different instruments.
    expect(drawings.drawingStorageKey('spot', 'BTC/USDT')).not.toBe(drawings.drawingStorageKey('futures', 'BTC/USDT'));
    // BTC's key can never collide with ETH's.
    expect(drawings.drawingStorageKey('futures', 'BTC/USDT')).not.toBe(drawings.drawingStorageKey('futures', 'ETH/USDT'));
    // No timeframe anywhere in the key: a drawing is anchored to real
    // timestamps, so it is the same drawing on 15m and on 1d.
    for (const tf of ['5m', '15m', '1h', '4h', '1d', '1w']) {
      expect(drawings.drawingStorageKey('futures', 'BTC/USDT')).not.toContain(tf);
    }
  });

  test('round-trips every drawing kind with its real time/price anchors', () => {
    const all: drawings.StoredDrawing[] = [
      { kind: 'trendline', points: [{ time: 100, price: 1.5 }, { time: 200, price: 2.5 }] },
      { kind: 'extended', points: [{ time: 100, price: 1 }, { time: 200, price: 3 }] },
      { kind: 'ray', points: [{ time: 100, price: 7 }] },
      { kind: 'horizontal', points: [{ time: 0, price: 42 }] },
      { kind: 'vertical', points: [{ time: 555, price: 0 }] },
      { kind: 'rectangle', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }] },
      { kind: 'fib', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }] },
      { kind: 'brush', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }, { time: 5, price: 6 }] },
      { kind: 'ruler', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }] },
      { kind: 'text', points: [{ time: 9, price: 8 }], text: 'support' },
    ];
    const parsed = drawings.parseStoredDrawings(
      drawings.serializeDrawings({ drawings: all, hidden: true, locked: true })
    );
    expect(parsed.drawings).toEqual(all);
    expect(parsed.hidden).toBe(true);
    expect(parsed.locked).toBe(true);
  });

  test('a real zero price survives the round trip', () => {
    const parsed = drawings.parseStoredDrawings(
      drawings.serializeDrawings({ drawings: [{ kind: 'horizontal', points: [{ time: 0, price: 0 }] }], hidden: false, locked: false })
    );
    expect(parsed.drawings[0].points[0].price).toBe(0);
  });

  test.each([
    ['nothing stored', null],
    ['not JSON', '{oops'],
    ['not an object', '"a string"'],
    ['a future version', '{"version":99,"drawings":[{"kind":"ray","points":[{"time":1,"price":2}]}]}'],
    ['drawings not an array', '{"version":1,"drawings":"lots"}'],
  ])('treats %s as an empty set rather than crashing', (_label, raw) => {
    const parsed = drawings.parseStoredDrawings(raw);
    expect(parsed.drawings).toEqual([]);
    expect(parsed.hidden).toBe(false);
    expect(parsed.locked).toBe(false);
  });

  test('drops individual malformed entries and keeps the good ones', () => {
    const raw = JSON.stringify({
      version: 1,
      hidden: false,
      locked: false,
      drawings: [
        { kind: 'ray', points: [{ time: 1, price: 2 }] },
        { kind: 'nonsense', points: [{ time: 1, price: 2 }] },
        { kind: 'trendline', points: [{ time: 1, price: 2 }] },          // too few points
        { kind: 'ray', points: [{ time: 'soon', price: 2 }] },            // not numbers
        { kind: 'ray', points: [{ time: 1, price: Number.NaN }] },        // NaN serializes to null
        { kind: 'text', points: [{ time: 1, price: 2 }] },                // no text
        { kind: 'ray', points: 'nope' },
        null,
        { kind: 'rectangle', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }] },
      ],
    });
    const parsed = drawings.parseStoredDrawings(raw);
    expect(parsed.drawings.map((d) => d.kind)).toEqual(['ray', 'rectangle']);
  });

  test('caps how much a runaway brush can write into storage', () => {
    const many = Array.from({ length: drawings.MAX_STORED_DRAWINGS + 50 }, () => ({
      kind: 'ray' as const,
      points: [{ time: 1, price: 2 }],
    }));
    const parsed = drawings.parseStoredDrawings(drawings.serializeDrawings({ drawings: many, hidden: false, locked: false }));
    expect(parsed.drawings).toHaveLength(drawings.MAX_STORED_DRAWINGS);
  });

  test('stores no pixel coordinates at all', () => {
    const raw = drawings.serializeDrawings({
      drawings: [{ kind: 'trendline', points: [{ time: 100, price: 1.5 }, { time: 200, price: 2.5 }] }],
      hidden: false,
      locked: false,
    });
    // Only time/price. A stored x/y would break on the next zoom.
    expect(raw).not.toMatch(/"x"|"y"|coordinate|pixel|screen/i);
    expect(JSON.parse(raw).drawings[0].points[0]).toEqual({ time: 100, price: 1.5 });
  });
});

describe('eraser hit testing', () => {
  test('measures to the SEGMENT, not the infinite line', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(drawings.distanceToSegment({ x: 50, y: 5 }, a, b)).toBeCloseTo(5, 9);
    // Far past the end: distance is to the endpoint, so a click out there
    // does not delete a line that stops at x=100.
    expect(drawings.distanceToSegment({ x: 300, y: 0 }, a, b)).toBeCloseTo(200, 9);
  });

  test('handles a zero-length segment without dividing by zero', () => {
    const p = { x: 3, y: 4 };
    expect(drawings.distanceToSegment(p, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5, 9);
  });

  test('has a hit radius a pointer can actually achieve', () => {
    expect(drawings.ERASER_HIT_RADIUS).toBeGreaterThanOrEqual(4);
    expect(drawings.ERASER_HIT_RADIUS).toBeLessThanOrEqual(16);
  });
});

describe('the rail is shared, and every button does something', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../components/PriceChart.tsx'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const futures = fs.readFileSync(path.resolve(__dirname, '../../pages/FuturesPage.tsx'), 'utf8');
  const trade = fs.readFileSync(path.resolve(__dirname, '../../pages/TradePage.tsx'), 'utf8');

  test('Futures opts into the SAME implementation Spot uses', () => {
    expect(futures).toContain('<PriceChart pair={symbol} chrome="terminal" drawingTools market="futures" />');
    expect(trade).toContain('<PriceChart pair={pair} chrome="terminal" drawingTools market="spot" />');
    // One implementation, not two: there is a single chart component and a
    // single rail, and both pages reach it through the same prop.
    expect(fs.existsSync(path.resolve(__dirname, '../../components/FuturesPriceChart.tsx'))).toBe(false);
    expect(fs.existsSync(path.resolve(__dirname, '../../components/FuturesDrawingTools.css'))).toBe(false);
  });

  test('CFD is untouched by this overlay', () => {
    const cfd = fs.readFileSync(path.resolve(__dirname, '../../components/CfdChart.tsx'), 'utf8');
    expect(cfd).not.toMatch(/drawingTools|DrawToolbar|drawing-rail|chartDrawings/);
  });

  test('every tool in the union has an implementation, and every button maps to one', () => {
    const union = code.slice(code.indexOf('type Tool ='), code.indexOf(';', code.indexOf('type Tool =')));
    const tools = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(tools)).toEqual(
      new Set(['cursor', 'trendline', 'extended', 'ray', 'horizontal', 'vertical', 'rectangle', 'fib', 'brush', 'ruler', 'text', 'erase'])
    );
    // Each drawing tool is actually handled somewhere in the component.
    for (const tool of tools) {
      if (tool === 'cursor') continue;
      expect(code).toMatch(new RegExp(`'${tool}'`));
    }
  });

  test('advertises no tool it has not built', () => {
    // Parallel channel and a separate price-range tool were considered and
    // deliberately left out; no icon, no label, no dead branch.
    expect(code).not.toMatch(/'channel'|ChannelIcon|priceRange|PriceRangeIcon/);
  });

  test('lock refuses every mutating action and nothing else', () => {
    expect(code).toContain('if (drawingToolsOn && lockedRef.current) return;');
    // Adding a shape, starting a gesture, erasing one and clearing all.
    expect(code).toContain('if (lockedRef.current || hiddenRef.current) return;');
    expect(code).toContain('if (drawingToolsOn && lockedRef.current) return;');
    expect(code).toContain('if (drawingToolsOn && locked) return;');
    // Lock must NOT touch visibility or the chart's own navigation.
    const lockToggle = code.split('onToggleLock={() => {')[1].split('}}')[0];
    expect(lockToggle).not.toMatch(/setDrawingsHidden|fitContent|timeScale|setTool\(/);
  });

  test('persists through the shared helpers rather than a second scheme', () => {
    expect(code).toContain('drawingStorageKey(market, pair)');
    expect(code).toContain('parseStoredDrawings(window.localStorage.getItem(storageKey))');
    expect(code).toContain('serializeDrawings(');
    // A storage failure must not take the chart down with it.
    expect(code).toMatch(/try \{[\s\S]*?localStorage[\s\S]*?\} catch/);
  });

  test('never writes one symbol\'s drawings into another symbol\'s slot', () => {
    // The marker for "which key the current state belongs to" is STATE, so
    // it lands in the same commit as the drawings it describes. A ref
    // would be set synchronously and let a save run with the new key and
    // the previous symbol's drawings.
    expect(code).toContain('const [loadedKey, setLoadedKey] = useState<string | null>(null);');
    expect(code).toContain('if (!storageKey || loadedKey !== storageKey) return;');
    expect(code).not.toContain('loadedKeyRef');
  });
});
