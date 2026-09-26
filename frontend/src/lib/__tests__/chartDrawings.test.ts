import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as drawings from '../chartDrawings';
import * as geometry from '../drawingGeometry';
import * as chartPriceFormat from '../spotChartPriceFormat';
import * as chartTrading from '../chartTrading';

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
  const layerSource = fs.readFileSync(path.resolve(__dirname, '../../components/ChartDrawingLayer.tsx'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../../components/DrawingTools.css'), 'utf8');
  const localRequire = createRequire(path.resolve(__dirname, '../../../package.json'));
  const React = localRequire('react');
  const { renderToStaticMarkup } = localRequire('react-dom/server');
  const tsx = (code: string) => ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  // The drawing layer is its own module, compiled against the same real helpers.
  const layer: Record<string, any> = {};
  new Function('require', 'exports', tsx(layerSource))((id: string) => {
    if (id === '../lib/chartDrawings') return drawings;
    if (id === '../lib/drawingGeometry') return geometry;
    return localRequire(id);
  }, layer);
  const compiled = tsx(`${source}\nexport { DrawToolbar, DrawingDialog, drawingToolGroups };`);
  const exports: Record<string, any> = {};
  new Function('require', 'exports', compiled)((id: string) => {
    if (id.endsWith('.css') || id === 'lightweight-charts' || id === '../lib/api' || id === '../lib/indicators') return {};
    if (id === '../lib/chartDrawings') return drawings;
    if (id === '../lib/spotChartPriceFormat') return chartPriceFormat;
    if (id === '../lib/chartTrading') return chartTrading;
    if (id === './PrivatePositionLines') return { PrivatePositionLines: () => null };
    if (id === './ChartDrawingLayer') return layer;
    if (id === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) };
    return localRequire(id);
  }, exports);
  const props = { tool: 'cursor', onSelect: () => {}, onClear: () => {}, onFit: () => {}, terminal: true,
    drawingsHidden: false, onToggleHidden: () => {}, stayInDrawMode: true, onToggleStay: () => {},
    magnet: false, onToggleMagnet: () => {}, locked: false, onToggleLock: () => {} };

  test('the rail carries TradingView\'s tool groups and toggles, each a real button', () => {
    const html = renderToStaticMarkup(React.createElement(exports.DrawToolbar, { ...props, drawingTools: true, compactTools: true }));
    expect(html).toContain('drawing-rail');
    expect(html).toContain('role="toolbar"');
    for (const group of ['cursors', 'lines', 'fibs', 'patterns', 'forecast', 'shapes', 'annotations', 'magnet']) {
      expect(html).toContain(`data-tool-group="${group}"`);
    }
    // Until another is picked, each group's button offers its first tool.
    for (const id of ['cursor', 'trendline', 'fib', 'xabcd', 'long', 'brush', 'text']) expect(html).toContain(`data-drawing-tool="${id}"`);
    for (const id of ['ruler', 'zoom', 'fit', 'magnet', 'stay', 'lock', 'hide', 'clear']) expect(html).toContain(`data-drawing-tool="${id}"`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="draw.measure"');
  });
  test('every tool the flyouts offer is one the chart implements, listed once', () => {
    const groups = exports.drawingToolGroups((key: string) => key);
    const ids: string[] = groups.flatMap((g: any) => g.sections.flatMap((section: any) => section.tools.map((tool: any) => tool.id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 4)).toEqual(['cursor', 'dot', 'arrowcursor', 'erase']);
    expect(new Set(ids.slice(4))).toEqual(new Set(drawings.DRAWING_KINDS));
    // TradingView's shortcuts are real bindings, not decoration.
    const shortcuts = groups.flatMap((g: any) => g.sections.flatMap((section: any) => section.tools)).filter((tool: any) => tool.shortcut);
    expect(shortcuts.map((tool: any) => `${tool.id}=${tool.shortcut}`)).toEqual([
      'trendline=Alt + T', 'horizontal=Alt + H', 'ray=Alt + J', 'vertical=Alt + V', 'crossline=Alt + C', 'fib=Alt + F', 'rectangle=Alt + Shift + R',
    ]);
    expect(source).toContain("const keys: Record<string, Tool> = { KeyT: 'trendline', KeyH: 'horizontal', KeyJ: 'ray', KeyV: 'vertical', KeyC: 'crossline', KeyF: 'fib' };");
    expect(source).toContain("event.code === 'KeyR' ? 'rectangle'");
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
  test('the compact rail is icon-only with accessible labels, and Clear names how many it removes', () => {
    const html = renderToStaticMarkup(React.createElement(exports.DrawToolbar, { ...props, drawingTools: true, compactTools: true, drawingCount: 3 }));
    for (const id of ['cursor', 'trendline', 'fib', 'brush', 'text', 'ruler', 'magnet', 'lock', 'stay', 'hide', 'clear']) {
      expect(html).toContain(`data-drawing-tool="${id}"`);
    }
    expect(html).toContain('aria-label="draw.measure"');
    // The single-object eraser sits in the cursors group, as in TradingView; every chevron is labelled.
    for (const group of ['draw.cursors', 'draw.trendTools', 'draw.fibGroup', 'draw.patterns', 'draw.forecast', 'draw.shapesGroup', 'draw.annotations']) {
      expect(html).toContain(`aria-label="${group}" aria-haspopup="menu"`);
    }
    expect(html).not.toContain('>draw.measure<');
    expect(html).toContain('title="draw.deleteAll (3)"');
  });
  test('drawing rail opens by default and its accessible toggle preserves tools across collapse and reopen', () => {
    const state: any[] = [];
    let index = 0;
    const output: Record<string, any> = {};
    new Function('require', 'exports', compiled)((id: string) => {
      if (id === 'react') return { ...React,
        useState: (initial: any) => { const i = index++; if (!(i in state)) state[i] = initial;
          return [state[i], (next: any) => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
        useId: () => `rail-${index++}`, useEffect: () => {}, useRef: () => ({ current: null }),
      };
      if (id.endsWith('.css') || id === 'lightweight-charts' || id === '../lib/api' || id === '../lib/indicators') return {};
      if (id === '../lib/chartDrawings') return drawings;
      if (id === '../lib/spotChartPriceFormat') return chartPriceFormat;
      if (id === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key, lang: 'en' }) };
      if (id === '../lib/chartTrading') return chartTrading;
    if (id === './PrivatePositionLines') return { PrivatePositionLines: () => null };
      if (id === './ChartDrawingLayer') return layer;
      return localRequire(id);
    }, output);
    const callbacks = { onCollapse: jest.fn(), onClear: jest.fn(), onToggleHidden: jest.fn(), onSelect: jest.fn() };
    const render = () => {
      index = 0;
      const tree = output.DrawToolbar({ ...props, ...callbacks, drawingTools: true, compactTools: true });
      const nodes: any[] = [];
      const walk = (node: any) => { if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; } nodes.push(node); walk(node.props?.children); };
      walk(tree);
      return { toggle: nodes.find(node => node.props?.['data-drawing-toolbar-toggle'] !== undefined),
        rail: nodes.find(node => node.props?.role === 'toolbar'),
        tools: nodes.filter(node => node.props?.['data-drawing-tool']).map(node => node.props['data-drawing-tool']) };
    };
    let view = render();
    const tools = view.tools;
    expect(view.toggle.props['aria-expanded']).toBe(true);
    expect(view.toggle.props['aria-controls']).toBe(view.rail.props.id);
    expect(view.toggle.props['aria-label']).toBe('draw.collapseToolbar');
    expect(view.rail.props.hidden).toBe(false);
    view.toggle.props.onClick();
    view = render();
    expect(view.toggle.props['aria-expanded']).toBe(false);
    expect(view.toggle.props['aria-label']).toBe('draw.expandToolbar');
    expect(view.rail.props.hidden).toBe(true);
    expect(view.tools).toEqual(tools);
    view.toggle.props.onClick();
    view = render();
    expect(view.rail.props.hidden).toBe(false);
    expect(view.toggle.props['aria-expanded']).toBe(true);
    expect(view.tools).toEqual(tools);
    expect(callbacks.onCollapse).toHaveBeenCalledTimes(1);
    expect(callbacks.onClear).not.toHaveBeenCalled();
    expect(callbacks.onToggleHidden).not.toHaveBeenCalled();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });
  test('the measure label reads as TradingView\'s and keeps a tiny negative difference', () => {
    const candles = [{ time: 0, volume: 1500 }, { time: 300, volume: 2500 }, { time: 600, volume: 1000 }, { time: 900, volume: 5 }];
    const range = drawings.drawingRange({ time: 0, price: 0.000001 }, { time: 900, price: 0.0000008 }, candles, 300, 0.0000001);
    const lines = drawings.drawingRangeLines(range, 'en');
    expect(lines[0]).toContain('-0.0000002');
    expect(lines[0]).toContain('(-20.00%)');
    expect(lines[0]).toMatch(/ -2$/);
    expect(lines[1]).toBe('3 bars, 15m');
    // Volume of the bars inside the span only; the closing bar is not in it.
    expect(lines[2]).toBe('Vol 5.00K');
    expect(lines.join(' ')).not.toContain('Infinity');
    expect(drawings.drawingRangeLines(range, 'ru')[1]).toBe('3 столбцы, 15мин');
    expect(drawings.drawingRangeLines(range, 'en', { price: true, date: false })).toHaveLength(1);
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
    // A text kind never becomes a drawing without the trader's own words.
    expect(layerSource).toContain('if (DRAWING_TEXT_KINDS.includes(kind)) { props.onRequestText({ kind, points }); return; }');
    expect(source).toContain("setDrawDialog({ kind: 'text', request })");
    expect(source).toContain('const drawing: ChartDrawing = { id: newDrawingId(), kind: request.kind, points: request.points, text: value };');
    for (const code of [source, layerSource]) expect(code).not.toContain('dangerouslySetInnerHTML');
  });
  test('Spot Clear requires an explicit in-app confirmation and leaves native Futures behavior intact', () => {
    const html = renderToStaticMarkup(React.createElement(exports.DrawingDialog,
      { kind: 'clear', t: (key: string) => key, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain('draw.deleteAllConfirm');
    expect(html).toContain('type="submit" class="danger"');
    expect(html).not.toContain('<input');
    expect(source).toContain("setDrawDialog({ kind: 'clear' });\n      return;");
    expect(source).toContain('if (window.confirm(confirmClearRef.current)) clearDrawings()');
    for (const code of [source, layerSource]) expect(code).not.toContain('window.prompt');
    const clearBody = source.split('const clearDrawings = useCallback(() => {')[1].split('const clearAll =')[0];
    expect(clearBody).not.toMatch(/api\.|conditionalOrders|cancelOrder|updateOrderTrigger/);
    // Horizontal levels are drawings like any other, and ONE effect owns
    // the native price lines derived from them — so Clear empties the
    // state and that effect removes the lines. Asserted on both halves: the
    // serializable data and the chart objects cannot drift apart.
    expect(clearBody).toContain('setDrawings([])');
    expect(source).toContain("const horizontals = drawings.filter((d) => d.kind === 'horizontal');");
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
      if (id === '../lib/chartTrading') return chartTrading;
    if (id === './PrivatePositionLines') return { PrivatePositionLines: () => null };
      if (id === './ChartDrawingLayer') return layer;
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
    expect(source).toContain('hidden={drawingsHidden}');
    expect(layerSource).toContain('<g data-chart-drawings="shapes" display={hidden ? \'none\' : undefined}>');
    // Conditional orders are a SPOT-ONLY feature (see
    // priceChartMarketOrders.test.ts) and live in their own overlay, after
    // the drawing layer and outside it, so Hide, Lock and Clear never reach
    // them.
    const flat = source.replace(/\s+/g, ' ');
    expect(flat).toContain("<svg className=\"order-overlay\" style={{ ...styles.overlay, pointerEvents: 'none' }}> {spotConditionalOrders && conditionalOrders.map");
    expect(flat.indexOf('<ChartDrawingLayer')).toBeLessThan(flat.indexOf('className="order-overlay"'));
    const orders = flat.split('className="order-overlay"')[1].split('</svg>')[0];
    expect(orders).not.toMatch(/drawingsHidden|locked|clearDrawings/);
    // Nothing is placed while drawings are hidden or locked.
    expect(layerSource).toContain('if (lockedRef.current || hiddenRef.current) return;');
    expect(source).toContain('return () => cancelGestureRef.current?.()');
    // The chart's cancel hook reaches the layer's gestures.
    expect(source).toContain('cancelRef={cancelGestureRef}');
    expect(layerSource).toContain('outerCancel.current = abandon;');
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
    // The owner-only native demo may pass its private overlay/loader props to the
    // very same chart; the shared drawing rail props must stay unchanged.
    // The futures page mounts the SAME shared chart the spot terminal does,
    // with the same drawing-tool props. The two optional props after them are
    // the owner's chart-trading tools, which are absent for every other
    // account; nothing about the rail itself is forked.
    expect(futures).toMatch(/<PriceChart pair=\{symbol\} chrome="terminal" drawingTools market="futures" compactTools=\{studio\}/);
    expect(futures).not.toContain('DrawToolbar');
    expect(futures.match(/<PriceChart\b/g)).toHaveLength(1);
    expect(trade).toContain('<PriceChart pair={pair} chrome="terminal" drawingTools market="spot" compactTools />');
    // One implementation, not two: there is a single chart component and a
    // single rail, and both pages reach it through the same prop.
    expect(fs.existsSync(path.resolve(__dirname, '../../components/FuturesPriceChart.tsx'))).toBe(false);
    expect(fs.existsSync(path.resolve(__dirname, '../../components/FuturesDrawingTools.css'))).toBe(false);
  });

  test('CFD is untouched by this overlay', () => {
    const cfd = fs.readFileSync(path.resolve(__dirname, '../../components/CfdChart.tsx'), 'utf8');
    expect(cfd).not.toMatch(/drawingTools|DrawToolbar|drawing-rail|chartDrawings/);
  });

  const layerCode = fs.readFileSync(path.resolve(__dirname, '../../components/ChartDrawingLayer.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const geometryCode = fs.readFileSync(path.resolve(__dirname, '../drawingGeometry.ts'), 'utf8');

  test('every tool in the union has an implementation, and every button maps to one', () => {
    expect(code).toContain('type Tool = DrawingTool;');
    const union = layerCode.slice(layerCode.indexOf('export type DrawingTool ='), layerCode.indexOf(';', layerCode.indexOf('export type DrawingTool =')));
    const tools = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(tools)).toEqual(new Set(['cursor', 'dot', 'arrowcursor', 'erase', 'zoom']));
    expect(union).toContain('| DrawingKind');
    expect(layerCode).toContain("tool === 'erase'");
    expect(layerCode).toContain("tool === 'zoom'");
    // Each drawing kind has its own geometry case — painted and hit-tested by the same code.
    for (const kind of drawings.DRAWING_KINDS) expect(geometryCode).toMatch(new RegExp(`case '${kind}'`));
  });

  test('lock refuses every mutating action and nothing else', () => {
    expect(code).toContain('if (drawingToolsOn && lockedRef.current) return;');
    expect(code).toContain('if (drawingToolsOn && locked) return;');
    // Adding a shape, moving one, moving an anchor, and Delete.
    expect(layerCode).toContain('if (lockedRef.current || hiddenRef.current) return;');
    expect(layerCode).toContain('if (lockedRef.current || drawing.locked || !view) return;');
    expect(layerCode).toContain('if (lockedRef.current || drawing.locked) return;');
    expect(layerCode).toContain("selectedId !== null && !lockedRef.current");
    // A lock abandons whatever was half-placed.
    expect(layerCode).toContain('}, [tool, hidden, locked, blocked]);');
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

// ── The TradingView set: model, geometry, editing ────────────────────

/** A linear projection: one bar of 300s is 10px, one price unit is 2px. */
function linearView(lang = 'en'): geometry.DrawingView {
  return {
    x: (time) => time / 30,
    y: (price) => 500 - price * 2,
    width: 1000,
    height: 600,
    lang,
    range: (a, b) => drawings.drawingRange(a, b, [], 300, 0.01),
  };
}

/** A valid drawing of each kind: its minimum anchors, spread out, with words where needed. */
function sample(kind: drawings.DrawingKind): drawings.StoredDrawing {
  const count = drawings.DRAWING_POINTS[kind].min;
  const points = Array.from({ length: count }, (_, i) => ({ time: 3000 + i * 1500, price: 100 + (i % 2 ? 40 : 0) + i * 5 }));
  return drawings.DRAWING_TEXT_KINDS.includes(kind) ? { kind, points, text: 'level' } : { kind, points };
}

describe('every drawing kind paints and can be picked', () => {
  test.each([...drawings.DRAWING_KINDS])('%s has a geometry with a hit target', (kind) => {
    const g = geometry.drawingGeometry(sample(kind), linearView());
    expect(g).not.toBeNull();
    // Horizontal levels are painted by the chart's native price line; the
    // layer only makes them selectable.
    if (kind !== 'horizontal') expect(g!.prims.length).toBeGreaterThan(0);
    expect(g!.strokes.length + g!.areas.length + g!.boxes.length).toBeGreaterThan(0);
  });

  test('a drawing whose anchor cannot be placed on screen is not painted at all', () => {
    const view = { ...linearView(), y: () => null };
    expect(geometry.drawingGeometry(sample('trendline'), view)).toBeNull();
  });

  test('what is visible is what a click selects: a trend line is hit on its stroke only', () => {
    const g = geometry.drawingGeometry({ kind: 'trendline', points: [{ time: 3000, price: 100 }, { time: 6000, price: 100 }] }, linearView())!;
    // x 100 → 200 at y 300.
    expect(geometry.geometryDistance(g, { x: 150, y: 303 })).toBeLessThanOrEqual(geometry.HIT_RADIUS);
    expect(geometry.geometryDistance(g, { x: 150, y: 320 })).toBeGreaterThan(geometry.HIT_RADIUS);
    // A trend line stops at its anchors; an extended line does not.
    expect(geometry.geometryDistance(g, { x: 400, y: 300 })).toBeGreaterThan(geometry.HIT_RADIUS);
    const extended = geometry.drawingGeometry({ kind: 'extended', points: [{ time: 3000, price: 100 }, { time: 6000, price: 100 }] }, linearView())!;
    expect(geometry.geometryDistance(extended, { x: 400, y: 300 })).toBeLessThanOrEqual(geometry.HIT_RADIUS);
    expect(geometry.anchorAt(g, { x: 101, y: 301 })?.id).toBe(0);
    expect(geometry.anchorAt(g, { x: 199, y: 299 })?.id).toBe(1);
  });

  test('the Fibonacci retracement prints every level with its real price', () => {
    const g = geometry.drawingGeometry({ kind: 'fib', points: [{ time: 3000, price: 100 }, { time: 6000, price: 200 }] }, linearView())!;
    const text = JSON.stringify(g.prims);
    for (const level of drawings.RETRACEMENT_LEVELS) expect(text).toContain(String(level));
    expect(text).toContain('150');
    expect(text).toContain('161.8');
  });

  test('the price range label is the TradingView three-part reading', () => {
    const g = geometry.drawingGeometry({ kind: 'ruler', points: [{ time: 0, price: 100 }, { time: 900, price: 110 }] }, linearView())!;
    const label = g.prims.find((p) => p.t === 'label') as Extract<geometry.Primitive, { t: 'label' }>;
    expect(label.lines[0]).toBe('10 (10.00%) 1,000');
    expect(label.lines[1]).toBe('3 bars, 15m');
  });
});

describe('long and short position tools', () => {
  test('risk/reward is reward over risk, in both directions', () => {
    expect(drawings.positionMetrics('long', 100, 120, 90).ratio).toBeCloseTo(2, 12);
    expect(drawings.positionMetrics('short', 100, 80, 110).ratio).toBeCloseTo(2, 12);
    expect(drawings.positionMetrics('long', 100, 110, 95).targetPct).toBeCloseTo(10, 12);
    expect(drawings.positionMetrics('long', 100, 110, 95).stopPct).toBeCloseTo(-5, 12);
    // A stop on the wrong side has no meaningful ratio.
    expect(drawings.positionMetrics('long', 100, 120, 105).ratio).toBeNull();
    expect(drawings.positionMetrics('long', 0, 120, 90).targetPct).toBeNull();
  });

  test('the box is labelled with target, stop and ratio, in the reader\'s language', () => {
    const drawing: drawings.StoredDrawing = { kind: 'long', points: [{ time: 3000, price: 100 }, { time: 9000, price: 120 }, { time: 9000, price: 90 }] };
    const text = (lang: string) => JSON.stringify(geometry.drawingGeometry(drawing, linearView(lang))!.prims);
    expect(text('en')).toContain('Target: 120 (20.00%)');
    expect(text('en')).toContain('Stop: 90 (-10.00%)');
    expect(text('en')).toContain('Risk/Reward Ratio: 2.00');
    expect(text('ru')).toContain('Соотношение риск/прибыль: 2.00');
  });

  test('each handle moves only the level it owns', () => {
    const drawing: drawings.StoredDrawing = { kind: 'long', points: [{ time: 3000, price: 100 }, { time: 9000, price: 120 }, { time: 9000, price: 90 }] };
    expect(geometry.moveAnchor(drawing, 'target', { time: 1, price: 130 }).points).toEqual([{ time: 3000, price: 100 }, { time: 9000, price: 130 }, { time: 9000, price: 90 }]);
    expect(geometry.moveAnchor(drawing, 'stop', { time: 1, price: 95 }).points).toEqual([{ time: 3000, price: 100 }, { time: 9000, price: 120 }, { time: 9000, price: 95 }]);
    expect(geometry.moveAnchor(drawing, 'width', { time: 12000, price: 1 }).points).toEqual([{ time: 3000, price: 100 }, { time: 12000, price: 120 }, { time: 12000, price: 90 }]);
    // The original is never mutated.
    expect(drawing.points[1].price).toBe(120);
  });

  test('a horizontal level keeps no time and a vertical line keeps no price', () => {
    expect(geometry.moveAnchor({ kind: 'horizontal', points: [{ time: 0, price: 5 }] }, 0, { time: 777, price: 9 }).points).toEqual([{ time: 0, price: 9 }]);
    expect(geometry.moveAnchor({ kind: 'vertical', points: [{ time: 5, price: 0 }] }, 0, { time: 777, price: 9 }).points).toEqual([{ time: 777, price: 0 }]);
    expect(geometry.moveAnchor({ kind: 'trendline', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }] }, 1, { time: 3, price: 3 }).points)
      .toEqual([{ time: 1, price: 1 }, { time: 3, price: 3 }]);
  });
});

describe('style, lock and the new kinds survive storage', () => {
  test('round-trips a styled, locked drawing of each new family', () => {
    const all: drawings.StoredDrawing[] = [
      { kind: 'channel', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }, { time: 5, price: 1 }], style: { color: '#f23645', width: 3, dash: 'dashed', fill: '#f23645' } },
      { kind: 'xabcd', points: [1, 2, 3, 4, 5].map((i) => ({ time: i, price: i * 2 })), locked: true },
      { kind: 'short', points: [{ time: 1, price: 100 }, { time: 9, price: 80 }, { time: 9, price: 110 }] },
      { kind: 'polyline', points: [{ time: 1, price: 1 }, { time: 2, price: 3 }, { time: 3, price: 2 }] },
      { kind: 'callout', points: [{ time: 1, price: 1 }, { time: 2, price: 3 }], text: 'breakout' },
    ];
    const parsed = drawings.parseStoredDrawings(drawings.serializeDrawings({ drawings: all, hidden: false, locked: false }));
    expect(parsed.drawings).toEqual(all);
  });

  test('an unusable style is dropped, not trusted; the drawing keeps its default', () => {
    const raw = JSON.stringify({ version: 1, hidden: false, locked: false, drawings: [
      { kind: 'trendline', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }], style: { color: 'red; background:url(x)', width: 2 } },
      { kind: 'trendline', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }], style: { color: '#2962ff', width: 900, dash: 'wavy' }, locked: 'yes' },
    ] });
    const [first, second] = drawings.parseStoredDrawings(raw).drawings;
    expect(first.style).toBeUndefined();
    expect(drawings.drawingStyle(first)).toEqual(drawings.DEFAULT_DRAWING_STYLES.trendline);
    expect(second.style).toEqual({ color: '#2962ff', width: 24, dash: 'solid' });
    expect(second.locked).toBeUndefined();
  });

  test('caps anchors and words per drawing, and a text kind needs its words', () => {
    const raw = JSON.stringify({ version: 1, hidden: false, locked: false, drawings: [
      { kind: 'polyline', points: Array.from({ length: 100 }, (_, i) => ({ time: i, price: i })) },
      { kind: 'note', points: [{ time: 1, price: 1 }], text: 'x'.repeat(1000) },
      { kind: 'callout', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }], text: '' },
    ] });
    const parsed = drawings.parseStoredDrawings(raw).drawings;
    expect(parsed.map((d) => d.kind)).toEqual(['polyline', 'note']);
    expect(parsed[0].points).toHaveLength(drawings.DRAWING_POINTS.polyline.max);
    expect(parsed[1].text).toHaveLength(280);
  });

  test.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])('an inherited name (%s) is not a drawing kind', (kind) => {
    const raw = `{"version":1,"hidden":false,"locked":false,"drawings":[{"kind":"${kind}","points":[{"time":1,"price":2},{"time":3,"price":4}]}]}`;
    expect(drawings.parseStoredDrawings(raw).drawings).toEqual([]);
  });

  test('TradingView-style duration and volume wording', () => {
    expect(drawings.formatDrawingDuration(405 * 60, 'ru')).toBe('6ч 45мин');
    expect(drawings.formatDrawingDuration(2 * 86400 + 3 * 3600 + 60, 'ru')).toBe('2д 3ч');
    expect(drawings.formatDrawingDuration(0, 'en')).toBe('0m');
    expect(drawings.formatDrawingVolume(435_060_000)).toBe('435.06M');
    expect(drawings.formatDrawingVolume(1200)).toBe('1.20K');
    expect(drawings.formatDrawingVolume(NaN)).toBe('—');
  });
});
