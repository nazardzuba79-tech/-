/**
 * TradingView's object toolbar, «…» menu and settings dialog for a drawing
 * (owner, 2026-10-18: «при нажатті на неї відкривалось таке меню, де можна і
 * настроїти, і видалити»): the style a dialog edits, the label it paints, the
 * timeframes a drawing shows on, templates, and where the toolbar docks.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as browserActivity from '../browserActivity';
import * as drawings from '../chartDrawings';
import * as geometry from '../drawingGeometry';
import {
  DEFAULT_MEASURE_INFO, drawingIntervalUnit, drawingRange, drawingRangeLines, drawingVisibleOn, parseStoredDrawings,
  sanitizeDrawingStyle, serializeDrawings, type DrawingRange, type MeasureInfo, type StoredDrawing,
} from '../chartDrawings';
import { drawingGeometry, drawingToolbarPlacement, labelBox, HIT_RADIUS, type DrawingView, type Primitive } from '../drawingGeometry';

type Label = Extract<Primitive, { t: 'label' }>;
const HOUR = 3600;
const range: DrawingRange = { priceDiff: 10, pct: 10, ticks: 1000, bars: 6, seconds: 6 * HOUR, volume: 1_234_567 };
const info = (patch: Partial<MeasureInfo>): MeasureInfo => ({ ...DEFAULT_MEASURE_INFO, ...patch });

describe('«Информация»: the lines a measurement reports', () => {
  test('the default set is the label traders already know', () => {
    const lines = drawingRangeLines(range, 'en');
    expect(drawingRangeLines(range, 'en', { price: true, date: true }, DEFAULT_MEASURE_INFO)).toEqual(lines);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\+10.*\(\+10\.00%\)$/);
    expect(lines[1]).toBe('6 bars, 6h');
    expect(lines[2]).toMatch(/1\.23M$/);
    // Ticks stay off until asked for (owner, 2026-09-26).
    expect(lines[0]).not.toContain('1,000');
  });
  test('each switch takes out only its own part', () => {
    expect(drawingRangeLines(range, 'en', undefined, info({ ticks: true }))[0]).toMatch(/\(\+10\.00%\) 1,000$/);
    expect(drawingRangeLines(range, 'en', undefined, info({ price: false }))[0]).toBe('+10.00%');
    expect(drawingRangeLines(range, 'en', undefined, info({ percent: false }))[0]).not.toContain('%');
    expect(drawingRangeLines(range, 'en', undefined, info({ bars: false }))[1]).toBe('6h');
    expect(drawingRangeLines(range, 'en', undefined, info({ time: false }))[1]).toBe('6 bars');
    expect(drawingRangeLines(range, 'en', undefined, info({ volume: false }))).toHaveLength(2);
    const none = { price: false, percent: false, ticks: false, bars: false, time: false, volume: false };
    expect(drawingRangeLines(range, 'en', undefined, none)).toEqual([]);
  });
});

describe('a drawing style survives storage only as valid values', () => {
  test('label, background and info settings are kept and clamped', () => {
    const style = sanitizeDrawingStyle({
      color: '#2962ff', width: 2, dash: 'solid', fill: '#ff9800', fillOff: true, fillOpacity: 1.7,
      textColor: '#131722', fontSize: 99, labelBg: '#ffffff', labelBgOff: true, bold: true, italic: true,
      info: { price: true, percent: 'yes', ticks: true, bars: false, time: true, volume: false, extra: true },
    });
    expect(style).toEqual({
      color: '#2962ff', width: 2, dash: 'solid', fill: '#ff9800', fillOff: true, fillOpacity: 1,
      textColor: '#131722', fontSize: 32, labelBg: '#ffffff', labelBgOff: true, bold: true, italic: true,
      info: { price: true, percent: false, ticks: true, bars: false, time: true, volume: false },
    });
  });
  test('junk in the new fields is dropped, never painted', () => {
    const style = sanitizeDrawingStyle({ color: '#2962ff', width: 1, dash: 'solid', textColor: 'red', labelBg: 'url(x)', fontSize: 'big', fillOpacity: NaN, fillOff: 1, bold: 'true' });
    expect(style).toEqual({ color: '#2962ff', width: 1, dash: 'solid' });
  });
});

describe('«Видимость»: the timeframes a drawing shows on', () => {
  test.each([[60, 'minutes'], [1800, 'minutes'], [3600, 'hours'], [4 * HOUR, 'hours'], [86400, 'days'], [604800, 'weeks'], [2592000, 'months']] as const)(
    '%d s is %s', (seconds, unit) => expect(drawingIntervalUnit(seconds)).toBe(unit));
  test('a drawing hidden on hours is hidden on 1h and 4h and shown on 15m and 1D', () => {
    const d = { intervals: { minutes: true, hours: false, days: true, weeks: true, months: true } };
    expect([900, 3600, 4 * HOUR, 86400].map((s) => drawingVisibleOn(d, s))).toEqual([true, false, false, true]);
    expect(drawingVisibleOn({}, 3600)).toBe(true);
    expect(drawingVisibleOn(d, undefined)).toBe(true);
  });
  test('storage keeps only a real restriction', () => {
    const points = [{ time: 10, price: 1 }, { time: 20, price: 2 }];
    const all = { minutes: true, hours: true, days: true, weeks: true, months: true };
    const saved = serializeDrawings({ hidden: false, locked: false, drawings: [
      { kind: 'ruler', points, intervals: { ...all, days: false } },
      { kind: 'ruler', points, intervals: all },
    ] as StoredDrawing[] });
    const restored = parseStoredDrawings(saved).drawings;
    expect(restored[0].intervals).toEqual({ ...all, days: false });
    expect(restored[1].intervals).toBeUndefined();
  });
});

/** One pixel per hour, one pixel per price unit, 600 × 400 plot. */
const view = (width = 600): DrawingView => ({
  x: (time) => time / HOUR, y: (price) => 400 - price, width, height: 400, lang: 'en',
  range: (a, b) => drawingRange(a, b, [], HOUR),
});
const rulerUp = (extra: Partial<StoredDrawing> = {}): StoredDrawing => ({
  kind: 'ruler', points: [{ time: 100 * HOUR, price: 150 }, { time: 200 * HOUR, price: 250 }], ...extra,
});
const labelOf = (d: StoredDrawing, width?: number) => drawingGeometry(d, view(width))!.prims.find((p) => p.t === 'label') as Label | undefined;

describe('the measurement as TradingView paints it', () => {
  test('a rise is a blue card with white text; a fall turns red', () => {
    expect(labelOf(rulerUp())).toMatchObject({ bg: '#2962ff', color: '#ffffff' });
    const down = rulerUp({ points: [{ time: 100 * HOUR, price: 250 }, { time: 200 * HOUR, price: 150 }] });
    expect(labelOf(down)).toMatchObject({ bg: '#f23645', color: '#ffffff' });
  });
  test('a colour the trader picked stays theirs on a fall', () => {
    const style = { ...drawings.drawingStyle({ kind: 'ruler' }), color: '#ff9800' };
    const down = rulerUp({ points: [{ time: 100 * HOUR, price: 250 }, { time: 200 * HOUR, price: 150 }], style });
    expect(labelOf(down)).toMatchObject({ bg: '#ff9800' });
  });
  test('«Фон» off keeps the area clickable but paints nothing; its opacity is the trader\'s', () => {
    const base = drawings.drawingStyle({ kind: 'ruler' });
    const off = drawingGeometry(rulerUp({ style: { ...base, fillOff: true } }), view())!;
    expect(off.prims.some((p) => p.t === 'poly' && p.fill)).toBe(false);
    expect(off.areas).toHaveLength(1);
    const half = drawingGeometry(rulerUp({ style: { ...base, fillOpacity: 0.5 } }), view())!;
    expect(half.prims.find((p) => p.t === 'poly' && p.fill)).toMatchObject({ fillOpacity: 0.5 });
  });
  test('the label\'s colour, size, background and the trader\'s own line', () => {
    const base = drawings.drawingStyle({ kind: 'ruler' });
    const custom = labelOf(rulerUp({ text: 'Target 1', style: { ...base, textColor: '#ffeb3b', fontSize: 16, labelBg: '#131722', bold: true, italic: true } }))!;
    expect(custom).toMatchObject({ bg: '#131722', color: '#ffeb3b', size: 16 });
    expect(custom.lines[custom.lines.length - 1]).toBe('Target 1');
    expect(custom.note).toEqual({ line: custom.lines.length - 1, bold: true, italic: true });
    // A bigger font is a taller card: every line keeps its pitch.
    expect(labelBox(custom).h).toBe(custom.lines.length * geometry.measurementLine(16) + 16);
    const bare = labelOf(rulerUp({ style: { ...base, labelBgOff: true } }))!;
    expect(bare.bg).toBe('none');
    expect(bare.color).toBe('#2962ff');
  });
  test('every line switched off and no text: no label at all', () => {
    const none = { price: false, percent: false, ticks: false, bars: false, time: false, volume: false };
    expect(labelOf(rulerUp({ style: { ...drawings.drawingStyle({ kind: 'ruler' }), info: none } }))).toBeUndefined();
    expect(labelOf(rulerUp({ text: 'Only me', style: { ...drawings.drawingStyle({ kind: 'ruler' }), info: none } }))!.lines).toEqual(['Only me']);
  });
});

describe('where the toolbar docks', () => {
  const size = { w: 360, h: 40 };
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const covers = (g: geometry.DrawingGeometry, at: { left: number; top: number }) => {
    const bar = { x: at.left, y: at.top, w: size.w, h: size.h };
    return g.boxes.some((b) => overlaps(bar, b)) || g.anchors.some((a) => overlaps(bar, { x: a.x - HIT_RADIUS, y: a.y - HIT_RADIUS, w: HIT_RADIUS * 2, h: HIT_RADIUS * 2 }));
  };
  test('the plot\'s top band, centred, when nothing is there', () => {
    const g = drawingGeometry(rulerUp({ points: [{ time: 100 * HOUR, price: 50 }, { time: 200 * HOUR, price: 150 }] }), view(1000))!;
    expect(drawingToolbarPlacement(g, { width: 1000, height: 400 }, size)).toEqual({ left: 320, top: 8 });
  });
  test('beside the label when the label is in the centre of the band', () => {
    const g = drawingGeometry(rulerUp({ points: [{ time: 450 * HOUR, price: 300 }, { time: 550 * HOUR, price: 380 }] }), view(1000))!;
    const at = drawingToolbarPlacement(g, { width: 1000, height: 400 }, size);
    expect(at.top).toBe(8);
    expect(at.left).not.toBe(320);
    expect(covers(g, at)).toBe(false);
  });
  test('below the label and handles when the whole band is taken', () => {
    const g = drawingGeometry(rulerUp({ points: [{ time: 100 * HOUR, price: 120 }, { time: 380 * HOUR, price: 392 }] }), view(400))!;
    const at = drawingToolbarPlacement(g, { width: 400, height: 400 }, size);
    expect(at.top).toBeGreaterThan(8);
    expect(covers(g, at)).toBe(false);
  });
});

describe('templates', () => {
  const store = new Map<string, string>();
  let failWrites = false;
  beforeAll(() => {
    (globalThis as any).window = { localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { if (failWrites) throw new Error('quota'); store.set(k, v); },
    } };
  });
  afterAll(() => { delete (globalThis as any).window; });
  beforeEach(() => { store.clear(); failWrites = false; });
  const templates = () => require('../drawingTemplates') as typeof import('../drawingTemplates');
  const style = { color: '#ff9800', width: 2, dash: 'solid' as const, labelBgOff: true as const };

  test('save, list newest first, replace by name, remove', () => {
    const t = templates();
    expect(t.listDrawingTemplates('ruler')).toEqual([]);
    t.saveDrawingTemplate('ruler', ' Orange ', style);
    t.saveDrawingTemplate('ruler', 'Blue', { ...style, color: '#2962ff' });
    expect(t.listDrawingTemplates('ruler').map((x) => x.name)).toEqual(['Blue', 'Orange']);
    t.saveDrawingTemplate('ruler', 'Orange', { ...style, width: 4 });
    expect(t.listDrawingTemplates('ruler')).toEqual([{ name: 'Orange', style: { ...style, width: 4 } }, { name: 'Blue', style: { ...style, color: '#2962ff' } }]);
    // Each kind keeps its own.
    expect(t.listDrawingTemplates('trendline')).toEqual([]);
    expect(t.removeDrawingTemplate('ruler', 'Orange').map((x) => x.name)).toEqual(['Blue']);
  });
  test('at most 20 a kind; a blank name or a refused write saves nothing', () => {
    const t = templates();
    for (let i = 0; i < 25; i++) t.saveDrawingTemplate('ruler', `T${i}`, style);
    expect(t.listDrawingTemplates('ruler')).toHaveLength(t.MAX_TEMPLATES_PER_KIND);
    expect(t.saveDrawingTemplate('ruler', '   ', style)).toBeNull();
    failWrites = true;
    expect(t.saveDrawingTemplate('ruler', 'Late', style)).toBeNull();
  });
  test('a tampered store yields only valid templates', () => {
    store.set('voltex.drawing-templates.v1', JSON.stringify({ ruler: [{ name: 'ok', style }, { name: 'bad', style: { color: 'red' } }, { style }, 7], trendline: 'x' }));
    expect(templates().listDrawingTemplates('ruler')).toEqual([{ name: 'ok', style }]);
    store.set('voltex.drawing-templates.v1', '{not json');
    expect(templates().listDrawingTemplates('ruler')).toEqual([]);
  });
});

describe('the toolbar, «…» menu and dialog as rendered', () => {
  const localRequire = createRequire(path.resolve(__dirname, '../../../package.json'));
  const React = localRequire('react');
  const { renderToStaticMarkup } = localRequire('react-dom/server');
  const component = (file: string): Record<string, any> => {
    const code = fs.readFileSync(path.resolve(__dirname, `../../components/${file}.tsx`), 'utf8');
    const out: Record<string, any> = {};
    const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'exports', compiled)((id: string) => {
      if (id.endsWith('/browserActivity')) return browserActivity;
      if (id === '../lib/chartDrawings') return drawings;
      if (id === '../lib/drawingGeometry') return geometry;
      if (id === '../lib/drawingTemplates') return require('../drawingTemplates');
      if (id === './DrawingObjectToolbar' || id === './DrawingSettingsDialog') return component(id.slice(2));
      return localRequire(id);
    }, out);
    return out;
  };
  const toolbar = component('DrawingObjectToolbar');
  const dialog = component('DrawingSettingsDialog');
  const layer = component('ChartDrawingLayer');
  const t = (k: string) => k;
  const noop = () => {};
  const ruler = { ...rulerUp(), id: 1 };
  const actionsOf = (html: string) => [...html.matchAll(/data-object-action="([^"]+)"/g)].map((m) => m[1]);
  const settingsTabs = (html: string) => [...html.matchAll(/data-settings-tab="([^"]+)"/g)].map((m) => m[1]);

  test('a ruler\'s toolbar: templates, line, background and text colours, width, settings, lock, delete, «…»', () => {
    const html = renderToStaticMarkup(React.createElement(toolbar.DrawingObjectToolbar, {
      drawing: ruler, locked: false, t, onStyle: noop, onToggleLock: noop, onClone: noop, onDelete: noop, onClose: noop, onSettings: noop,
    }));
    expect(actionsOf(html)).toEqual(['drag', 'templates', 'color', 'fill', 'text-color', 'width', 'settings', 'lock', 'delete', 'more']);
    expect(html).toContain('aria-label="draw.deleteObject"');
    expect(html).toContain('aria-label="draw.settings"');
  });
  test('a locked object can still be unlocked, opened and closed, not restyled or deleted', () => {
    const html = renderToStaticMarkup(React.createElement(toolbar.DrawingObjectToolbar, {
      drawing: { ...ruler, locked: true }, locked: false, t, onStyle: noop, onToggleLock: noop, onClone: noop, onDelete: noop, onClose: noop, onSettings: noop,
    }));
    const disabled = [...html.matchAll(/<button[^>]*data-object-action="([^"]+)"[^>]*disabled=""/g)].map((m) => m[1]);
    expect(disabled).toEqual(['templates', 'color', 'fill', 'text-color', 'width', 'delete']);
    expect(html).toMatch(/data-object-action="lock"[^>]*aria-pressed="true"/);
  });
  test('«…» and the right-click menu: settings, clone, order, lock, delete', () => {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, React.createElement(toolbar.DrawingActions, {
      t, drawing: ruler, locked: false, onSettings: noop, onClone: noop, onOrder: noop, onToggleLock: noop, onDelete: noop, onDone: noop,
    })));
    expect(actionsOf(html)).toEqual(['settings', 'clone', 'front', 'back', 'lock', 'delete']);
  });
  test('the dialog: TradingView\'s tabs for each kind, and its footer', () => {
    const render = (drawing: object) => renderToStaticMarkup(React.createElement(dialog.DrawingSettingsDialog, { drawing, locked: false, live: null, t, onPreview: noop, onClose: noop }));
    const html = render(ruler);
    expect(settingsTabs(html)).toEqual(['style', 'text', 'coordinates', 'visibility']);
    expect(html).toContain('aria-label="draw.datepricerange"');
    for (const key of ['price', 'percent', 'ticks', 'bars', 'time', 'volume']) expect(html).toContain(`name="info-${key}"`);
    expect(html).toContain('data-settings-action="cancel"');
    expect(html).toContain('data-settings-action="ok"');
    const priceRange = render({ id: 2, kind: 'pricerange', points: ruler.points });
    expect([...priceRange.matchAll(/name="info-([a-z]+)"/g)].map((m) => m[1])).toEqual(['price', 'percent', 'ticks']);
    const trend = render({ id: 3, kind: 'trendline', points: ruler.points });
    expect(settingsTabs(trend)).toEqual(['style', 'coordinates', 'visibility']);
    expect(trend).toContain('aria-label="draw.trendline"');
    expect(trend).toContain('data-field="dash"');
  });
  test('selecting a drawing shows its toolbar in the plot\'s top band', () => {
    const html = renderToStaticMarkup(React.createElement(layer.ChartDrawingLayer, {
      drawings: [ruler], setDrawings: noop, tool: 'cursor', onCommitted: noop, view: view(1000), pointAt: () => null,
      positionPoints: () => [], overlayStyle: {}, locked: false, blocked: false, selectedId: 1, onSelect: noop, onRequestText: noop, t,
    }));
    expect(html).toContain('data-drawing-object-toolbar');
    expect(html).toMatch(/data-drawing-object-toolbar[^>]*style="left:\d+(\.\d+)?px;top:8px;transform:none"/);
    // Hidden on this timeframe: neither painted nor given a toolbar.
    const hidden = renderToStaticMarkup(React.createElement(layer.ChartDrawingLayer, {
      drawings: [{ ...ruler, intervals: { minutes: true, hours: false, days: true, weeks: true, months: true } }], setDrawings: noop, tool: 'cursor', onCommitted: noop,
      view: view(1000), pointAt: () => null, positionPoints: () => [], overlayStyle: {}, locked: false, blocked: false, selectedId: 1, onSelect: noop, onRequestText: noop,
      intervalSeconds: 4 * HOUR, t,
    }));
    expect(hidden).not.toContain('data-drawing-object-toolbar');
    expect(hidden).not.toContain('data-drawing-kind="ruler"');
  });
});
