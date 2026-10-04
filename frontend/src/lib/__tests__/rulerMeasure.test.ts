/**
 * The ruler's exact prices and its live end (owner, 2026-10-04: «вписую ціну
 * 0.81 … і ленійка сама розгортається до поточної ціни»), and its drag
 * handles («тут немає за що тягнути»).
 */
import fs from 'fs';
import path from 'path';
import {
  applyRulerPrices, drawingPriceInput, livePoints, parseDrawingPrice, parseStoredDrawings, serializeDrawings, settleLiveEnd,
  type StoredDrawing,
} from '../chartDrawings';
import { drawingGeometry, moveAnchor, type DrawingView } from '../drawingGeometry';

const HOUR = 3600;
const ruler = (extra: Partial<StoredDrawing> = {}): StoredDrawing => ({
  kind: 'ruler', points: [{ time: 10 * HOUR, price: 0.81 }, { time: 20 * HOUR, price: 5 }], ...extra,
});
const live = { time: 30 * HOUR, price: 21.53 };
/** One pixel per hour, ten pixels per price unit, 400 px plot. */
const view = (latest = live): DrawingView => ({
  x: (time) => time / HOUR, y: (price) => 400 - price * 10, width: 600, height: 400, lang: 'en',
  range: (a, b) => ({ priceDiff: b.price - a.price, pct: ((b.price - a.price) / a.price) * 100, ticks: null, bars: (b.time - a.time) / HOUR, seconds: b.time - a.time, volume: null }),
  live: latest,
});

describe('typed prices', () => {
  test('a dot or a comma, above zero; anything else is refused', () => {
    expect(['0.81', '0,81', ' 21.53 ', '.5', '100'].map(parseDrawingPrice)).toEqual([0.81, 0.81, 21.53, 0.5, 100]);
    expect(['', '0', '-1', '1e3', 'abc', '1.2.3', '1,2,3', '0.0'].map(parseDrawingPrice)).toEqual([null, null, null, null, null, null, null, null]);
  });
  test('the settings field shows a price exactly, without float noise', () => {
    expect(drawingPriceInput(0.1 + 0.2)).toBe('0.3');
    expect(drawingPriceInput(0.81000516)).toBe('0.81000516');
  });
});

describe('a live end follows the latest candle', () => {
  test('painted, measured and hit-tested at the latest price', () => {
    const d = ruler({ followLast: true });
    expect(livePoints(d, live)).toEqual([d.points[0], live]);
    const g = drawingGeometry(d, view())!;
    expect(g.anchors.find((a) => a.id === 1)).toEqual({ id: 1, x: 30, y: 400 - 215.3 });
    // The label measures to the latest price: (21.53 − 0.81) / 0.81.
    const label = g.prims.find((p) => p.t === 'label') as { lines: string[] };
    expect(label.lines[0]).toBe('+2,558.02%');
    // A later candle moves it without any edit.
    const moved = drawingGeometry(d, view({ time: 31 * HOUR, price: 30 }))!;
    expect(moved.anchors.find((a) => a.id === 1)).toEqual({ id: 1, x: 31, y: 100 });
  });
  test('without a latest candle yet, the stored end is used', () => {
    expect(livePoints(ruler({ followLast: true }), null)).toEqual(ruler().points);
    expect(livePoints(ruler(), live)).toEqual(ruler().points);
  });
  test('only a ruler may carry it, and it survives storage', () => {
    const saved = serializeDrawings({ drawings: [ruler({ followLast: true }), { kind: 'trendline', points: ruler().points, followLast: true } as StoredDrawing], hidden: false, locked: false });
    const restored = parseStoredDrawings(saved).drawings;
    expect(restored[0].followLast).toBe(true);
    expect(restored[1].followLast).toBeUndefined();
  });
});

describe('exact prices from the settings', () => {
  test('start and a fixed end price; times stay where the trader put them', () => {
    const d = applyRulerPrices(ruler(), { from: 0.8, to: 22, followLast: false }, live);
    expect(d.points).toEqual([{ time: 10 * HOUR, price: 0.8 }, { time: 20 * HOUR, price: 22 }]);
    expect(d.followLast).toBeUndefined();
  });
  test('«До текущей цены» turns the end live; unticking it fixes the end where it is', () => {
    const following = applyRulerPrices(ruler(), { from: 0.81, to: 5, followLast: true }, live);
    expect(following.followLast).toBe(true);
    expect(following.points[0].price).toBe(0.81);
    const fixed = applyRulerPrices(following, { from: 0.81, to: 21.53, followLast: false }, live);
    expect(fixed.followLast).toBeUndefined();
    expect(fixed.points[1]).toEqual({ time: 30 * HOUR, price: 21.53 });
  });
  test('grabbing a live end by hand writes it down first', () => {
    const settled = settleLiveEnd(ruler({ followLast: true }), live);
    expect(settled.followLast).toBeUndefined();
    expect(settled.points[1]).toEqual(live);
  });
});

describe('handles to grab', () => {
  test('a ruler has a price-only handle mid-edge on its top and bottom', () => {
    const g = drawingGeometry(ruler(), view())!;
    expect(g.anchors.map((a) => a.id)).toEqual([0, 1, 'edge0', 'edge1']);
    expect(g.anchors.find((a) => a.id === 'edge1')).toEqual({ id: 'edge1', x: 15, y: 350 });
    // Other measuring kinds keep their two corners only.
    expect(drawingGeometry({ ...ruler(), kind: 'pricerange' }, view())!.anchors.map((a) => a.id)).toEqual([0, 1]);
  });
  test('an edge handle moves only that edge’s price', () => {
    const moved = moveAnchor(ruler(), 'edge1', { time: 99 * HOUR, price: 21.53 });
    expect(moved.points).toEqual([{ time: 10 * HOUR, price: 0.81 }, { time: 20 * HOUR, price: 21.53 }]);
    expect(moveAnchor(ruler(), 'edge0', { time: 0, price: 0.9 }).points[0]).toEqual({ time: 10 * HOUR, price: 0.9 });
  });
});

describe('the drawing layer wires it in', () => {
  const layer = fs.readFileSync(path.resolve(__dirname, '../../components/ChartDrawingLayer.tsx'), 'utf8');
  const chart = fs.readFileSync(path.resolve(__dirname, '../../components/PriceChart.tsx'), 'utf8');
  test('dragging a ruler edge shows a price guide, hides the label and snaps to the latest price', () => {
    expect(layer).toMatch(/LIVE_SNAP_PX\) \{ to = \{ \.\.\.to, price: live\.price \}; snapped = true; \}/);
    expect(layer).toMatch(/guided \? g\.prims\.filter\(\(p\) => p\.t !== 'label'\)/);
    expect(layer).toMatch(/<DragGuide /);
  });
  test('the chart hands the layer the latest candle and its own price format', () => {
    expect(chart).toMatch(/live: \(\(\) => \{ const last = candlesRef\.current\[candlesRef\.current\.length - 1\]; return last \? \{ time: last\.time, price: last\.close \} : null; \}\)\(\)/);
    expect(chart).toMatch(/formatPrice: \(value\) => series\.priceFormatter\(\)\.format\(value\)/);
  });
});
