/**
 * Screen geometry for every drawing kind — one function per kind, used for
 * BOTH painting and hit-testing, so what a trader sees is exactly what a
 * click selects, drags or erases.
 *
 * Pure: it takes a projection (time/price → pixels) and returns primitives.
 * Nothing here touches the chart, React or the DOM.
 */
import {
  dashArray, distanceToPolyline, drawingExtensions, drawingRange, drawingRangeLines, drawingRetracements,
  drawingStyle, formatDrawingPrice, pointInPolygon, positionMetrics, readableTextOn,
  type DrawingPoint, type DrawingRange, type ScreenPoint, type StoredDrawing,
} from './chartDrawings';

export interface DrawingView {
  /** Time → x. Extrapolates past the loaded bars, so shapes can reach into the future. */
  x(time: number): number | null;
  y(price: number): number | null;
  /** Plot width and height, price scale excluded. */
  width: number;
  height: number;
  lang: string;
  range(a: DrawingPoint, b: DrawingPoint): DrawingRange;
}

export type Primitive =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: string; opacity?: number }
  | { t: 'poly'; points: ScreenPoint[]; closed: boolean; stroke?: string; fill?: string; fillOpacity?: number; width: number; dash?: string; opacity?: number }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; stroke: string; fill?: string; fillOpacity?: number; width: number; dash?: string }
  | { t: 'text'; x: number; y: number; text: string; color: string; size: number; anchor: 'start' | 'middle' | 'end'; weight?: number }
  | { t: 'label'; x: number; y: number; lines: string[]; bg: string; color: string; place: 'above' | 'below' | 'center' | 'right' | 'left'; size?: number };

export interface DrawingAnchor { id: number | 'target' | 'stop' | 'width'; x: number; y: number }

export interface DrawingGeometry {
  prims: Primitive[];
  /** Hit targets: strokes by distance, areas by containment, label boxes. */
  strokes: ScreenPoint[][];
  areas: ScreenPoint[][];
  boxes: { x: number; y: number; w: number; h: number }[];
  anchors: DrawingAnchor[];
}

const LABEL_CHAR = 6.4;
const LABEL_LINE = 15;

/** The rectangle a boxed label occupies, for painting and hit-testing alike. */
export function labelBox(p: Extract<Primitive, { t: 'label' }>) {
  const size = p.size ?? 11;
  const w = Math.max(...p.lines.map((l) => l.length)) * LABEL_CHAR * (size / 11) + 16;
  const h = p.lines.length * LABEL_LINE * (size / 11) + 8;
  const x = p.place === 'right' ? p.x + 8 : p.place === 'left' ? p.x - w - 8 : p.x - w / 2;
  const y = p.place === 'above' ? p.y - h - 6 : p.place === 'below' ? p.y + 6 : p.y - h / 2;
  return { x, y, w, h };
}

function extendLine(a: ScreenPoint, b: ScreenPoint, view: DrawingView, back: boolean, forward: boolean): [ScreenPoint, ScreenPoint] {
  if (a.x === b.x && a.y === b.y) return [a, b];
  const far = (view.width + view.height) * 4;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  return [back ? { x: a.x - ux * far, y: a.y - uy * far } : a, forward ? { x: b.x + ux * far, y: b.y + uy * far } : b];
}

function arrowHead(from: ScreenPoint, to: ScreenPoint, size: number): ScreenPoint[] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const left = { x: to.x - size * Math.cos(angle - Math.PI / 7), y: to.y - size * Math.sin(angle - Math.PI / 7) };
  const right = { x: to.x - size * Math.cos(angle + Math.PI / 7), y: to.y - size * Math.sin(angle + Math.PI / 7) };
  return [left, to, right];
}

const ratio = (a: number, b: number) => (Math.abs(b) > 0 ? Math.abs(a / b).toFixed(3) : '—');
const mid = (a: ScreenPoint, b: ScreenPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Build a drawing's geometry. Returns null when an anchor cannot be placed
 * on screen (a price outside the scale's reach, or no chart yet).
 */
export function drawingGeometry(drawing: StoredDrawing, view: DrawingView): DrawingGeometry | null {
  const style = drawingStyle(drawing);
  const dash = dashArray(style.dash, style.width);
  const { color, width } = style;
  const fill = style.fill;
  const prims: Primitive[] = [];
  const strokes: ScreenPoint[][] = [];
  const areas: ScreenPoint[][] = [];
  const boxes: DrawingGeometry['boxes'] = [];
  const anchors: DrawingAnchor[] = [];
  const pts: ScreenPoint[] = [];
  const kind = drawing.kind;

  const vertical = kind === 'vertical';
  const horizontalOnly = kind === 'horizontal';
  for (const p of drawing.points) {
    const x = horizontalOnly ? view.width / 2 : view.x(p.time);
    const y = vertical ? view.height / 2 : view.y(p.price);
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push({ x, y });
  }
  const pointAnchors = () => pts.forEach((p, i) => anchors.push({ id: i, x: p.x, y: p.y }));
  const line = (a: ScreenPoint, b: ScreenPoint, c = color, w = width, d = dash) => {
    prims.push({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: c, width: w, dash: d });
    strokes.push([a, b]);
  };
  const label = (l: Omit<Extract<Primitive, { t: 'label' }>, 't'>) => {
    const prim = { t: 'label' as const, ...l };
    prims.push(prim);
    boxes.push(labelBox(prim));
  };
  const polyArea = (points: ScreenPoint[], f = fill, opacity = 0.2) => {
    if (!f) return;
    prims.push({ t: 'poly', points, closed: true, fill: f, fillOpacity: opacity, width: 0 });
    areas.push(points);
  };
  const letters = (names: string[], up: boolean[]) => names.forEach((name, i) => {
    if (!pts[i] || !name) return;
    prims.push({ t: 'text', x: pts[i].x, y: pts[i].y + (up[i] ? -10 : 18), text: name, color, size: 12, anchor: 'middle', weight: 600 });
  });
  const peaks = () => pts.map((p, i) => {
    const prev = pts[i - 1] ?? pts[i + 1], next = pts[i + 1] ?? pts[i - 1];
    return p.y <= Math.min(prev?.y ?? p.y, next?.y ?? p.y);
  });

  switch (kind) {
    case 'trendline': case 'rayline': case 'extended': case 'infoline': case 'trendangle': case 'arrow': {
      const [a, b] = pts;
      const [s, e] = extendLine(a, b, view, kind === 'extended', kind === 'rayline' || kind === 'extended');
      line(s, e);
      if (kind === 'arrow') {
        const head = arrowHead(a, b, 8 + width * 2);
        prims.push({ t: 'poly', points: head, closed: false, stroke: color, width, opacity: 1 });
      }
      if (kind === 'infoline') {
        const range = view.range(drawing.points[0], drawing.points[1]);
        const angle = Math.round((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI);
        label({ x: b.x, y: b.y, lines: [...drawingRangeLines(range, view.lang), `${angle}°`], bg: '#1e222d', color: '#d1d4dc', place: 'right' });
      }
      if (kind === 'trendangle') {
        const angle = Math.round((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI);
        line(a, { x: a.x + 60, y: a.y }, color, 1, dashArray('dashed', 1));
        prims.push({ t: 'text', x: a.x + 64, y: a.y + (angle >= 0 ? -6 : 14), text: `${angle}°`, color, size: 12, anchor: 'start', weight: 600 });
      }
      pointAnchors();
      break;
    }
    case 'horizontal': {
      // The line and its axis label are the chart's own price line; this
      // is only its hit target and its handle.
      strokes.push([{ x: 0, y: pts[0].y }, { x: view.width, y: pts[0].y }]);
      anchors.push({ id: 0, x: view.width / 2, y: pts[0].y });
      break;
    }
    case 'ray': {
      line(pts[0], { x: view.width, y: pts[0].y });
      pointAnchors();
      break;
    }
    case 'vertical': {
      line({ x: pts[0].x, y: 0 }, { x: pts[0].x, y: view.height });
      anchors.push({ id: 0, x: pts[0].x, y: view.height / 2 });
      break;
    }
    case 'crossline': {
      line({ x: 0, y: pts[0].y }, { x: view.width, y: pts[0].y });
      line({ x: pts[0].x, y: 0 }, { x: pts[0].x, y: view.height });
      pointAnchors();
      break;
    }
    case 'channel': {
      const [a, b, c] = pts;
      const dy = c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
      const a2 = { x: a.x, y: a.y + dy }, b2 = { x: b.x, y: b.y + dy };
      polyArea([a, b, b2, a2]);
      line(a, b);
      line(a2, b2);
      line(mid(a, a2), mid(b, b2), color, 1, dashArray('dashed', 1));
      pointAnchors();
      break;
    }
    case 'fib': {
      const [a, b] = pts;
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      const inside = x2 + 150 > view.width;
      line(a, b, color, 1, dashArray('dashed', 1));
      for (const { level, price } of drawingRetracements(drawing.points[0].price, drawing.points[1].price)) {
        const y = view.y(price);
        if (y === null) continue;
        const levelColor = FIB_COLORS[level] ?? color;
        line({ x: x1, y }, { x: x2, y }, levelColor, width, dash);
        prims.push({ t: 'text', x: inside ? x2 - 4 : x2 + 6, y: y + 4, text: `${level} (${formatDrawingPrice(price)})`, color: levelColor, size: 11, anchor: inside ? 'end' : 'start' });
      }
      pointAnchors();
      break;
    }
    case 'fibext': {
      const [a, b, c] = pts;
      line(a, b, color, 1, dashArray('dashed', 1));
      line(b, c, color, 1, dashArray('dashed', 1));
      const x1 = c.x, x2 = Math.max(c.x + 120, b.x);
      for (const { level, price } of drawingExtensions(drawing.points[0].price, drawing.points[1].price, drawing.points[2].price)) {
        const y = view.y(price);
        if (y === null) continue;
        const levelColor = FIB_COLORS[level] ?? color;
        line({ x: x1, y }, { x: x2, y }, levelColor, width, dash);
        prims.push({ t: 'text', x: x2 + 6, y: y + 4, text: `${level} (${formatDrawingPrice(price)})`, color: levelColor, size: 11, anchor: 'start' });
      }
      pointAnchors();
      break;
    }
    case 'pitchfork': {
      const [p0, p1, p2] = pts;
      const m = mid(p1, p2);
      const [, far] = extendLine(p0, m, view, false, true);
      line(p0, m);
      line(m, far);
      const dx = far.x - m.x, dy = far.y - m.y;
      line(p1, { x: p1.x + dx, y: p1.y + dy });
      line(p2, { x: p2.x + dx, y: p2.y + dy });
      line(p1, p2, color, 1);
      pointAnchors();
      break;
    }
    case 'xabcd': case 'abcd': {
      const names = kind === 'xabcd' ? ['X', 'A', 'B', 'C', 'D'] : ['A', 'B', 'C', 'D'];
      if (kind === 'xabcd') {
        polyArea([pts[0], pts[1], pts[2]]);
        polyArea([pts[2], pts[3], pts[4]]);
      }
      for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i]);
      const p = drawing.points.map((q) => q.price);
      const dashed = dashArray('dashed', 1);
      const rate = (i: number, j: number, k: number, l: number) => ratio(p[k] - p[l], p[i] - p[j]);
      const links: [number, number, string][] = kind === 'xabcd'
        ? [[0, 2, rate(0, 1, 2, 1)], [1, 3, rate(1, 2, 3, 2)], [2, 4, rate(2, 3, 4, 3)], [0, 4, rate(0, 1, 4, 1)]]
        : [[0, 2, rate(0, 1, 2, 1)], [1, 3, rate(1, 2, 3, 2)]];
      for (const [i, j, text] of links) {
        line(pts[i], pts[j], color, 1, dashed);
        const at = mid(pts[i], pts[j]);
        prims.push({ t: 'text', x: at.x, y: at.y - 4, text, color, size: 11, anchor: 'middle' });
      }
      letters(names, peaks());
      pointAnchors();
      break;
    }
    case 'trianglepattern': {
      polyArea([pts[0], pts[1], pts[3], pts[2]]);
      for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i]);
      line(pts[0], pts[2], color, 1, dashArray('dashed', 1));
      line(pts[1], pts[3], color, 1, dashArray('dashed', 1));
      letters(['A', 'B', 'C', 'D'], peaks());
      pointAnchors();
      break;
    }
    case 'headshoulders': {
      polyArea([pts[0], pts[1], pts[2]]);
      polyArea([pts[2], pts[3], pts[4]]);
      polyArea([pts[4], pts[5], pts[6]]);
      for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i]);
      const [n1, n2] = extendLine(pts[2], pts[4], view, false, false);
      line({ x: pts[0].x, y: n1.y + ((n2.y - n1.y) * (pts[0].x - n1.x)) / (n2.x - n1.x || 1) },
        { x: pts[6].x, y: n1.y + ((n2.y - n1.y) * (pts[6].x - n1.x)) / (n2.x - n1.x || 1) }, color, 1, dashArray('dashed', 1));
      const words = HS_WORDS[view.lang] ?? HS_WORDS.en;
      const up = peaks();
      [1, 3, 5].forEach((i, k) => prims.push({ t: 'text', x: pts[i].x, y: pts[i].y + (up[i] ? -10 : 18), text: words[k], color, size: 11, anchor: 'middle', weight: 600 }));
      pointAnchors();
      break;
    }
    case 'elliott': {
      for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i]);
      letters(['', '(1)', '(2)', '(3)', '(4)', '(5)'], peaks());
      pointAnchors();
      break;
    }
    case 'long': case 'short': {
      const [entry, target, stop] = drawing.points;
      const x0 = pts[0].x, x1 = pts[1].x;
      const ye = pts[0].y, yt = pts[1].y, ys = pts[2].y;
      const left = Math.min(x0, x1), right = Math.max(x0, x1);
      const profit = [{ x: left, y: ye }, { x: right, y: ye }, { x: right, y: yt }, { x: left, y: yt }];
      const loss = [{ x: left, y: ye }, { x: right, y: ye }, { x: right, y: ys }, { x: left, y: ys }];
      polyArea(profit, '#089981', 0.2);
      polyArea(loss, '#f23645', 0.2);
      line({ x: left, y: ye }, { x: right, y: ye }, '#787b86', 1);
      const m = positionMetrics(kind, entry.price, target.price, stop.price);
      const w = POSITION_WORDS[view.lang] ?? POSITION_WORDS.en;
      const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);
      const cx = (left + right) / 2;
      label({ x: cx, y: Math.min(yt, ye), lines: [`${w.target}: ${formatDrawingPrice(target.price)} (${pct(m.targetPct)})`], bg: '#089981', color: '#ffffff', place: 'above' });
      label({ x: cx, y: Math.max(ys, ye), lines: [`${w.stop}: ${formatDrawingPrice(stop.price)} (${pct(m.stopPct)})`], bg: '#f23645', color: '#ffffff', place: 'below' });
      label({ x: cx, y: ye, lines: [`${w.ratio}: ${m.ratio === null ? '—' : m.ratio.toFixed(2)}`], bg: '#434651', color: '#ffffff', place: 'center' });
      anchors.push({ id: 0, x: x0, y: ye }, { id: 'target', x: x0, y: yt }, { id: 'stop', x: x0, y: ys }, { id: 'width', x: x1, y: ye });
      break;
    }
    case 'pricerange': case 'daterange': case 'ruler': {
      const [a, b] = pts;
      const range = view.range(drawing.points[0], drawing.points[1]);
      const down = range.priceDiff < 0;
      const tone = kind === 'daterange' ? color : down ? '#f23645' : color;
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      const box = kind === 'pricerange' ? [{ x: x1, y: a.y }, { x: x2, y: a.y }, { x: x2, y: b.y }, { x: x1, y: b.y }]
        : kind === 'daterange' ? [{ x: a.x, y: y1 }, { x: b.x, y: y1 }, { x: b.x, y: y2 }, { x: a.x, y: y2 }]
        : [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      polyArea(box, tone, 0.2);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      if (kind !== 'daterange') {
        line({ x: cx, y: a.y }, { x: cx, y: b.y }, tone, 1);
        prims.push({ t: 'poly', points: arrowHead({ x: cx, y: a.y }, { x: cx, y: b.y }, 8), closed: false, stroke: tone, width: 1 });
      }
      if (kind !== 'pricerange') {
        line({ x: a.x, y: cy }, { x: b.x, y: cy }, tone, 1);
        prims.push({ t: 'poly', points: arrowHead({ x: a.x, y: cy }, { x: b.x, y: cy }, 8), closed: false, stroke: tone, width: 1 });
      }
      const lines = drawingRangeLines(range, view.lang, { price: kind !== 'daterange', date: kind !== 'pricerange' });
      label({ x: cx, y: down ? y2 : y1, lines, bg: tone, color: readableTextOn(tone), place: down ? 'below' : 'above' });
      pointAnchors();
      break;
    }
    case 'brush': case 'highlighter': {
      prims.push({ t: 'poly', points: pts, closed: false, stroke: color, width, dash, opacity: kind === 'highlighter' ? 0.35 : 1 });
      strokes.push(pts);
      break;
    }
    case 'arrowup': case 'arrowdown': {
      const p = pts[0];
      const s = kind === 'arrowup' ? 1 : -1;
      const shape = [
        { x: p.x, y: p.y }, { x: p.x + 9, y: p.y + 10 * s }, { x: p.x + 4, y: p.y + 10 * s },
        { x: p.x + 4, y: p.y + 22 * s }, { x: p.x - 4, y: p.y + 22 * s }, { x: p.x - 4, y: p.y + 10 * s }, { x: p.x - 9, y: p.y + 10 * s },
      ];
      prims.push({ t: 'poly', points: shape, closed: true, fill: color, fillOpacity: 1, stroke: color, width: 1 });
      areas.push(shape);
      pointAnchors();
      break;
    }
    case 'rectangle': {
      const [a, b] = pts;
      const box = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      polyArea(box);
      prims.push({ t: 'poly', points: box, closed: true, stroke: color, width, dash });
      strokes.push([...box, box[0]]);
      pointAnchors();
      break;
    }
    case 'ellipse': {
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      prims.push({ t: 'ellipse', cx, cy, rx, ry, stroke: color, fill, fillOpacity: 0.2, width, dash });
      const ring = Array.from({ length: 36 }, (_, i) => ({ x: cx + rx * Math.cos((i / 36) * Math.PI * 2), y: cy + ry * Math.sin((i / 36) * Math.PI * 2) }));
      strokes.push([...ring, ring[0]]);
      if (fill) areas.push(ring);
      pointAnchors();
      break;
    }
    case 'triangleshape': {
      polyArea(pts);
      prims.push({ t: 'poly', points: pts, closed: true, stroke: color, width, dash });
      strokes.push([...pts, pts[0]]);
      pointAnchors();
      break;
    }
    case 'polyline': {
      prims.push({ t: 'poly', points: pts, closed: false, stroke: color, width, dash });
      strokes.push(pts);
      pointAnchors();
      break;
    }
    case 'text': {
      const p = pts[0];
      const text = drawing.text ?? '';
      prims.push({ t: 'text', x: p.x, y: p.y, text, color, size: 14, anchor: 'start', weight: 500 });
      boxes.push({ x: p.x - 4, y: p.y - 16, w: text.length * 7.6 + 8, h: 22 });
      pointAnchors();
      break;
    }
    case 'note': case 'pricelabel': {
      const p = pts[0];
      const text = kind === 'note' ? drawing.text ?? '' : formatDrawingPrice(drawing.points[0].price);
      label({ x: p.x, y: p.y - 12, lines: [text], bg: color, color: readableTextOn(color), place: 'above' });
      line(p, { x: p.x, y: p.y - 12 }, color, 1);
      prims.push({ t: 'ellipse', cx: p.x, cy: p.y, rx: 3, ry: 3, stroke: color, fill: color, fillOpacity: 1, width: 1 });
      pointAnchors();
      break;
    }
    case 'callout': {
      const [a, b] = pts;
      line(a, b, color, 1);
      label({ x: b.x, y: b.y, lines: [drawing.text ?? ''], bg: color, color: readableTextOn(color), place: 'center' });
      pointAnchors();
      break;
    }
  }
  return { prims, strokes, areas, boxes, anchors };
}

const FIB_COLORS: Record<number, string> = {
  0: '#787b86', 0.236: '#f23645', 0.382: '#ff9800', 0.5: '#4caf50', 0.618: '#089981',
  0.786: '#00bcd4', 1: '#787b86', 1.618: '#2962ff', 2.618: '#f23645', 3.618: '#9c27b0', 4.236: '#e91e63',
};
const HS_WORDS: Record<string, [string, string, string]> = {
  ru: ['Левое плечо', 'Голова', 'Правое плечо'], en: ['Left Shoulder', 'Head', 'Right Shoulder'],
  es: ['Hombro izq.', 'Cabeza', 'Hombro der.'], zh: ['左肩', '头部', '右肩'], ja: ['左肩', '頭', '右肩'],
  ko: ['왼쪽 어깨', '머리', '오른쪽 어깨'], hi: ['बायाँ कंधा', 'सिर', 'दायाँ कंधा'],
};
const POSITION_WORDS: Record<string, { target: string; stop: string; ratio: string }> = {
  ru: { target: 'Цель', stop: 'Стоп', ratio: 'Соотношение риск/прибыль' },
  en: { target: 'Target', stop: 'Stop', ratio: 'Risk/Reward Ratio' },
  es: { target: 'Objetivo', stop: 'Stop', ratio: 'Riesgo/beneficio' },
  zh: { target: '目标', stop: '止损', ratio: '风险回报比' }, ja: { target: '目標', stop: 'ストップ', ratio: 'リスクリワード' },
  ko: { target: '목표', stop: '손절', ratio: '위험/보상 비율' }, hi: { target: 'लक्ष्य', stop: 'स्टॉप', ratio: 'जोखिम/लाभ' },
};

export const HIT_RADIUS = 6;

/** How close the pointer is to this drawing: 0 inside an area or label, else the stroke distance. */
export function geometryDistance(geometry: DrawingGeometry, p: ScreenPoint): number {
  for (const box of geometry.boxes) if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return 0;
  for (const area of geometry.areas) if (pointInPolygon(p, area)) return 0;
  let best = Infinity;
  for (const stroke of geometry.strokes) best = Math.min(best, distanceToPolyline(p, stroke));
  return best;
}

/** The anchor under the pointer, if any. */
export function anchorAt(geometry: DrawingGeometry, p: ScreenPoint, radius = 7): DrawingAnchor | null {
  for (const anchor of geometry.anchors) if (Math.hypot(anchor.x - p.x, anchor.y - p.y) <= radius) return anchor;
  return null;
}

/**
 * Move one anchor of a drawing to a new chart point. The position tools'
 * special handles move only the level they own: the target and stop keep
 * their own price, the width handle only the right edge.
 */
export function moveAnchor(drawing: StoredDrawing, anchor: DrawingAnchor['id'], to: DrawingPoint): StoredDrawing {
  const points = drawing.points.map((p) => ({ ...p }));
  if (anchor === 'target') points[1] = { ...points[1], price: to.price };
  else if (anchor === 'stop') points[2] = { ...points[2], price: to.price };
  else if (anchor === 'width') { points[1] = { ...points[1], time: to.time }; points[2] = { ...points[2], time: to.time }; }
  else if (drawing.kind === 'long' || drawing.kind === 'short') points[0] = { time: to.time, price: to.price };
  else if (drawing.kind === 'horizontal') points[anchor] = { time: 0, price: to.price };
  else if (drawing.kind === 'vertical') points[anchor] = { time: to.time, price: 0 };
  else points[anchor] = to;
  return { ...drawing, points };
}
