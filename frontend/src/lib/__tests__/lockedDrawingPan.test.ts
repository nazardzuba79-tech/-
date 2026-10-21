/**
 * A locked drawing must not swallow the chart's drag (owner, 2026-10-21:
 * «коли затискаю ліву кнопку мишки на графіку та рухаю курсор ліворуч або
 * праворуч, графік не переміщується»).
 *
 * The drawing layer's SVG passes the pointer through to the chart except
 * for the invisible hit shapes it draws over each drawing. A filled body
 * (a rectangle, a ruler's box) used to be one of them for every drawing, so
 * a press inside a locked shape went to the shape, which then did nothing:
 * Lightweight Charts never saw the mousedown and the chart stayed put.
 * Now a locked drawing — its own lock or «Заблокировать рисунки» — keeps
 * only its outline and labels for selection; its body is the chart's.
 */
import fs from 'fs';
import path from 'path';
import * as drawings from '../chartDrawings';
import * as geometry from '../drawingGeometry';

function view(): geometry.DrawingView {
  return {
    x: (time) => time / 30,
    y: (price) => 500 - price * 2,
    width: 1000,
    height: 600,
    lang: 'en',
    range: (a, b) => drawings.drawingRange(a, b, [], 300, 0.01),
  };
}
const box: drawings.StoredDrawing = { kind: 'rectangle', points: [{ time: 3000, price: 100 }, { time: 12000, price: 200 }] };
const ruler: drawings.StoredDrawing = { kind: 'ruler', points: [{ time: 3000, price: 100 }, { time: 12000, price: 200 }] };

describe('hitGeometry: what a press on a drawing can reach', () => {
  test('a free drawing is grabbed by its outline, its body and its labels', () => {
    const g = geometry.drawingGeometry(box, view())!;
    expect(g.areas.length).toBeGreaterThan(0);
    const hit = geometry.hitGeometry(g, false);
    expect(hit.strokes).toBe(g.strokes);
    expect(hit.areas).toBe(g.areas);
    expect(hit.boxes).toBe(g.boxes);
  });

  test.each([['rectangle', box], ['ruler', ruler]] as const)('a locked %s gives up its body and keeps its outline', (_kind, drawing) => {
    const g = geometry.drawingGeometry(drawing, view())!;
    expect(g.areas.length).toBeGreaterThan(0);
    const hit = geometry.hitGeometry(g, true);
    expect(hit.areas).toEqual([]);
    expect(hit.strokes).toBe(g.strokes);
    expect(hit.strokes.length).toBeGreaterThan(0);
    expect(hit.boxes).toBe(g.boxes);
  });

  test('the layer passes the lock — the object\'s own or the global one — into its hit targets', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../components/ChartDrawingLayer.tsx'), 'utf8');
    // The rendered hit targets of every drawing carry the frozen flag …
    expect(source).toMatch(/<HitTargets geometry=\{g\} frozen=\{locked \|\| !!d\.locked\}/);
    // … and HitTargets paints only what hitGeometry allows for that flag.
    const component = source.slice(source.indexOf('function HitTargets('));
    expect(component).toMatch(/const hit = hitGeometry\(geometry, frozen\);/);
    expect(component).toMatch(/hit\.areas\.map\(/);
    expect(component).not.toMatch(/geometry\.areas\.map\(/);
    expect(component).toMatch(/data-drawing-hit=\{frozen \? 'outline' : 'body'\}/);
  });
});
