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

describe('Spot-only toolbar presentation and chart integration', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../components/PriceChart.tsx'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../../components/SpotDrawingTools.css'), 'utf8');
  const localRequire = createRequire(path.resolve(__dirname, '../../../package.json'));
  const React = localRequire('react');
  const { renderToStaticMarkup } = localRequire('react-dom/server');
  const compiled = ts.transpileModule(`${source}\nexport { DrawToolbar, RulerLabel, SpotDrawingDialog };`, {
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
    drawingsHidden: false, onToggleHidden: () => {}, stayInDrawMode: true, onToggleStay: () => {} };

  test('actual compact rail has working callback buttons, grouped lines, titles, active state and real tools only', () => {
    const html = renderToStaticMarkup(React.createElement(exports.DrawToolbar, { ...props, spotTools: true }));
    expect(html).toContain('spot-drawing-rail');
    expect(html).toContain('role="toolbar"');
    for (const id of ['cursor', 'trendline', 'fib', 'rectangle', 'brush', 'text', 'ruler', 'fit', 'stay', 'hide', 'clear']) {
      expect(html).toContain(`data-drawing-tool="${id}"`);
    }
    expect(html.match(/class="tool-divider"/g)).toHaveLength(4);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="draw.measure"');
    expect(html).not.toMatch(/magnet|data-drawing-tool="lock"/);
    for (const id of ['ray', 'horizontal', 'vertical']) expect(source).toContain(`{ id: '${id}', icon:`);
  });
  test('Futures/CFD keep the original rail unless Spot is explicitly opted in', () => {
    const old = renderToStaticMarkup(React.createElement(exports.DrawToolbar, props));
    const embedded = renderToStaticMarkup(React.createElement(exports.DrawToolbar, { ...props, terminal: false }));
    expect(old).not.toContain('spot-drawing-rail');
    expect(embedded).not.toContain('spot-drawing-rail');
    expect(source).toContain("spotTools = false");
    expect(source).toContain('const spotDrawingTools = terminal && spotTools');
    expect(css).toContain('.trade-terminal .spot-drawing-tools');
    expect(css).toContain('overflow-y: auto; overflow-x: hidden');
    expect(css).toContain('overflow-x: auto; overflow-y: hidden');
    expect(css).toContain('@media (max-width: 767px)');
  });
  test('actual ruler label preserves a tiny negative price difference', () => {
    const html = renderToStaticMarkup(React.createElement('svg', {}, React.createElement(exports.RulerLabel,
      { x: 100, y: 100, pct: -20, priceDiff: -0.0000002, bars: 3, spotTools: true, locale: 'en' })));
    expect(html).toContain('-20.00%');
    expect(html).toContain('-0.0000002');
    expect(html).toContain('3 bars');
    expect(html).not.toContain('Infinity');
  });
  test('Spot text dialog has an accessible label, safe plain input, real actions and no native modal', () => {
    const html = renderToStaticMarkup(React.createElement(exports.SpotDrawingDialog,
      { kind: 'text', t: (key: string) => key, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('<label');
    expect(html).toContain('type="text"');
    expect(html).toContain('maxLength="280"');
    expect(html).toContain('type="submit" class="primary" disabled=""');
    expect(html).toContain('draw.addText');
    expect(html).toContain('trade.cancel');
    expect(source).toContain("setSpotDialog({ kind: 'text', at: p });\n          return;");
    expect(source).toContain('at: spotDialog.at, text: value');
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
  test('Spot Clear requires an explicit in-app confirmation and leaves native Futures behavior intact', () => {
    const html = renderToStaticMarkup(React.createElement(exports.SpotDrawingDialog,
      { kind: 'clear', t: (key: string) => key, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain('draw.deleteAllConfirm');
    expect(html).toContain('type="submit" class="danger"');
    expect(html).not.toContain('<input');
    expect(source).toContain("setSpotDialog({ kind: 'clear' });\n      return;");
    expect(source).toContain('if (window.confirm(confirmClearRef.current)) clearDrawings()');
    expect(source).toContain('const text = window.prompt(textPromptRef.current)');
    const clearBody = source.split('const clearDrawings = useCallback(() => {')[1].split('const clearAll =')[0];
    expect(clearBody).not.toMatch(/api\.|conditionalOrders|cancelOrder|updateOrderTrigger/);
    expect(clearBody).toContain('seriesRef.current?.removePriceLine(line)');
    expect(source).toContain('spotDrawingTools && spotDialog && createPortal');
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
      const tree = bindings.SpotDrawingDialog({ kind, t: (key: string) => key, onConfirm, onCancel });
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
    expect(source).toContain("display: drawingsHidden && !spotDrawingTools ? 'none' : undefined");
    expect(source).toContain("data-chart-drawings={spotDrawingTools ? 'shapes' : undefined} display={spotDrawingTools && drawingsHidden ? 'none' : undefined}");
    expect(source).toContain('(!spotDrawingTools || !drawingsHidden) && labels.map');
    // Normalize only whitespace: the conditional lines remain outside the hidden drawing group.
    expect(source.replace(/\s+/g, ' ')).toContain('</g> {conditionalOrders.map');
    expect(source).toContain('if (spotDrawingTools && hiddenRef.current) return');
    expect(source).toContain('return () => cancelGestureRef.current?.()');
    expect(source).toContain("...(spotDrawingTools ? { zIndex: 4 } : {})");
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
