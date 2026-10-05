import { drawingRange, type StoredDrawing } from '../chartDrawings';
import { drawingGeometry, geometryDistance, labelBox, rulerToolbarTop, type DrawingView, type Primitive } from '../drawingGeometry';

const view = (width = 300): DrawingView => ({
  x: time => time,
  y: price => 300 - price,
  width, height: 300, lang: 'ru',
  range: (a, b) => drawingRange(a, b, [], 3600),
});
type Label = Extract<Primitive, { t: 'label' }>;

describe('compact ruler card', () => {
  test.each([240, 300, 600, 1200])('fits a %dpx plot at either edge without moving the anchors', width => {
    for (const x of [0, width - 10]) {
      const drawing: StoredDrawing = { kind: 'ruler', points: [{ time: x, price: 0.81 }, { time: x + 9, price: 247.58 }] };
      const before = JSON.stringify(drawing);
      const geometry = drawingGeometry(drawing, view(width))!;
      const label = geometry.prims.find(p => p.t === 'label') as Label;
      const bounds = labelBox(label);
      expect(bounds.x).toBeGreaterThanOrEqual(4);
      expect(bounds.x + bounds.w).toBeLessThanOrEqual(width - 4);
      expect(bounds.y).toBeGreaterThanOrEqual(4);
      expect(bounds.y + bounds.h).toBeLessThanOrEqual(296);
      expect(label.variant).toBe('measurement');
      expect(label.bg).toBe('#161e2c');
      expect(label.size).toBe(12);
      expect(label.lines.join(' ')).toContain('+246,77');
      expect(label.lines.join(' ')).not.toContain('NaN');
      expect(JSON.stringify(drawing)).toBe(before);
      expect(geometry.anchors[0]).toEqual({ id: 0, x, y: 299.19 });
      expect(geometryDistance(geometry, { x: bounds.x + bounds.w - 1, y: bounds.y + 1 })).toBe(0);
      expect(rulerToolbarTop(geometry)).toBeGreaterThanOrEqual(bounds.y + bounds.h + 8);
    }
  });

  test('long numeric measurements split at the percentage boundary, without losing digits', () => {
    const drawing: StoredDrawing = { kind: 'ruler', points: [{ time: 1, price: 0.00000001 }, { time: 20, price: 247.58 }] };
    const wide = drawingGeometry(drawing, view(1200))!.prims.find(p => p.t === 'label') as Label;
    const narrow = drawingGeometry(drawing, view(240))!.prims.find(p => p.t === 'label') as Label;
    expect(narrow.lines.length).toBe(wide.lines.length + 1);
    expect(narrow.lines.slice(0, 2).join(' ')).toBe(wide.lines[0]);
    expect(labelBox(narrow).w).toBeLessThanOrEqual(232);
  });

  test('downward ranges retain their negative change, red accent and exact handles', () => {
    const geometry = drawingGeometry({ kind: 'ruler', points: [{ time: 4, price: 247.58 }, { time: 30, price: 0.81 }] }, view())!;
    const label = geometry.prims.find(p => p.t === 'label') as Label;
    expect(label.lines[0]).toContain('-246,77');
    expect(label.accent).toBe('#f23645');
    expect(rulerToolbarTop(geometry)).toBe(8);
    expect(geometry.anchors.map(p => p.id)).toEqual([0, 1, 'edge0', 'edge1']);
    expect(geometry.prims.find(p => p.t === 'poly' && p.fill)).toMatchObject({ fillOpacity: 0.12 });
  });

  test.each(['pricerange', 'daterange'] as const)('%s keeps its existing appearance', kind => {
    const geometry = drawingGeometry({ kind, points: [{ time: 4, price: 100 }, { time: 30, price: 120 }] }, view())!;
    const label = geometry.prims.find(p => p.t === 'label') as Label;
    expect(label.variant).toBeUndefined();
    expect(label.size).toBe(14);
    expect(label.bg).toBe('#2962ff');
    expect(rulerToolbarTop(geometry)).toBe(8);
    expect(geometry.prims.find(p => p.t === 'poly' && p.fill)).toMatchObject({ fillOpacity: 0.2 });
  });
});
