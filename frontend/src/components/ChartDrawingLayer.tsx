import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import {
  DRAWING_PALETTE, DRAWING_POINTS, DRAWING_TEXT_KINDS, DRAWING_WIDTHS, FREEHAND_KINDS,
  drawingStyle, trackDrawingGesture,
  type DrawingDash, type DrawingKind, type DrawingPoint, type DrawingStyle, type StoredDrawing,
} from '../lib/chartDrawings';
import { anchorAt, drawingGeometry, geometryDistance, labelBox, moveAnchor, HIT_RADIUS, type DrawingAnchor, type DrawingGeometry, type DrawingView, type Primitive } from '../lib/drawingGeometry';

/** A drawing on the chart: the stored form plus a session id. */
export type ChartDrawing = StoredDrawing & { id: number };

/** Every tool the rail can select. Cursors and the eraser make nothing. */
export type DrawingTool = 'cursor' | 'dot' | 'arrowcursor' | 'erase' | DrawingKind;
export const CURSOR_TOOLS: readonly DrawingTool[] = ['cursor', 'dot', 'arrowcursor'];

let nextId = 1;
export const newDrawingId = () => nextId++;

export type TextRequest = { kind: DrawingKind; points: DrawingPoint[] } | { edit: ChartDrawing };

export interface ChartDrawingLayerProps {
  drawings: ChartDrawing[];
  setDrawings: (update: (previous: ChartDrawing[]) => ChartDrawing[]) => void;
  tool: DrawingTool;
  /** A drawing was completed. The chart decides what the rail does next. */
  onCommitted: (drawing: ChartDrawing) => void;
  view: DrawingView | null;
  /** Container-local pixels → a chart point. */
  pointAt: (x: number, y: number) => DrawingPoint | null;
  /** A click placed a long or short position tool: its three default anchors. */
  positionPoints: (entry: DrawingPoint, kind: 'long' | 'short') => DrawingPoint[];
  overlayStyle: CSSProperties;
  locked: boolean;
  /** Another interaction owns the pointer (chart trading's candle pick). */
  blocked: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onRequestText: (request: TextRequest) => void;
  /** The chart's hook to abandon a half-placed shape or a drag (Clear, Lock, a pair change). */
  cancelRef?: MutableRefObject<(() => void) | null>;
  t: (key: any) => string;
}

const DASHES: DrawingDash[] = ['solid', 'dashed', 'dotted'];

/**
 * THE DRAWING LAYER. Every user drawing is painted here from its stored
 * (time, price) anchors, through `drawingGeometry` — the same geometry the
 * hit-testing reads, so a stroke that is visible is a stroke that can be
 * selected, dragged and erased, and nothing else can.
 *
 * Creating: fixed-count tools are placed click by click, two-point tools
 * also by one press-drag-release, brush strokes freehand, a polyline until
 * a double click or Enter. Editing: in any cursor mode a click selects,
 * dragging the body moves the whole drawing, dragging a handle moves that
 * anchor, and the floating toolbar sets colour, fill, width and line style,
 * locks, clones or deletes the object. Delete removes the selection.
 */
export function ChartDrawingLayer(props: ChartDrawingLayerProps) {
  const { drawings, setDrawings, tool, view, pointAt, locked, blocked, selectedId, onSelect, t } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [pending, setPending] = useState<{ kind: DrawingKind; points: DrawingPoint[] } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const drawingTool = !CURSOR_TOOLS.includes(tool);
  const capture = drawingTool && !blocked;

  // A tool change, a lock or another interaction abandons whatever was
  // half-placed.
  useEffect(() => {
    setPending(null);
    return () => { cancelRef.current?.(); cancelRef.current = null; };
  }, [tool, locked, blocked]);

  // The chart abandons it too, through the same path: Clear, Lock, collapse,
  // a pair or timeframe change can never leave a gesture to commit later.
  const outerCancel = props.cancelRef;
  useEffect(() => {
    if (!outerCancel) return;
    const abandon = () => { cancelRef.current?.(); cancelRef.current = null; setPending(null); };
    outerCancel.current = abandon;
    return () => { if (outerCancel.current === abandon) outerCancel.current = null; };
  }, [outerCancel]);

  // Hover is read from the chart area itself, so the crosshair and the
  // previews follow the pointer in every mode without re-rendering the chart.
  useEffect(() => {
    const host = svgRef.current?.parentElement;
    if (!host) return;
    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      setHover({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    const leave = () => setHover(null);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); };
  }, []);

  const local = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : null;
  }, []);

  const geometries = useMemo(() => {
    const out = new Map<number, DrawingGeometry>();
    if (!view) return out;
    for (const d of drawings) {
      const g = drawingGeometry(d, view);
      if (g) out.set(d.id, g);
    }
    return out;
  }, [drawings, view]);

  const topmostAt = useCallback((p: { x: number; y: number }) => {
    for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
      const d = drawingsRef.current[i];
      const g = geometries.get(d.id);
      if (g && geometryDistance(g, p) <= HIT_RADIUS) return d;
    }
    return null;
  }, [geometries]);

  const commit = useCallback((kind: DrawingKind, points: DrawingPoint[]) => {
    if (DRAWING_TEXT_KINDS.includes(kind)) { props.onRequestText({ kind, points }); return; }
    const drawing: ChartDrawing = { id: newDrawingId(), kind, points };
    setDrawings((previous) => [...previous, drawing]);
    props.onCommitted(drawing);
  }, [props, setDrawings]);

  /** Pointer down on the capture surface: the active drawing tool acts. */
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !capture) return;
    if (lockedRef.current) return;
    event.preventDefault();
    const at = local(event.clientX, event.clientY);
    if (!at) return;
    if (tool === 'erase') {
      const hit = topmostAt(at);
      if (hit && !hit.locked) { setDrawings((previous) => previous.filter((d) => d.id !== hit.id)); if (selectedId === hit.id) onSelect(null); }
      return;
    }
    const kind = tool as DrawingKind;
    const start = pointAt(at.x, at.y);
    if (!start) return;

    if (FREEHAND_KINDS.includes(kind)) {
      let points = [start];
      setPending({ kind, points });
      cancelRef.current = trackDrawingGesture(window, {
        move: (ev) => { const l = local(ev.clientX, ev.clientY); const p = l && pointAt(l.x, l.y); if (p) { points = [...points, p]; setPending({ kind, points }); } },
        finish: () => { setPending(null); if (points.length > 1) commit(kind, points.slice(0, DRAWING_POINTS[kind].max)); },
        cancel: () => setPending(null),
      }, true);
      return;
    }

    const required = DRAWING_POINTS[kind].min;
    const open = kind === 'polyline';
    const current = pendingRef.current;
    if (current && current.kind === kind) {
      // Click-by-click placement: this click fixes the next anchor.
      const points = [...current.points, start];
      if (!open && points.length >= required) { setPending(null); commit(kind, points); }
      else setPending({ kind, points: points.slice(0, DRAWING_POINTS[kind].max) });
      return;
    }
    // One click places a one-anchor kind, and a whole position tool: its
    // target, stop and width start at TradingView's defaults.
    if (kind === 'long' || kind === 'short') { commit(kind, props.positionPoints(start, kind)); return; }
    if (required === 1) { commit(kind, [start]); return; }
    // First anchor. A press-drag-release places the second anchor at the
    // release; a plain click leaves the shape pending for the next click.
    setPending({ kind, points: [start] });
    const origin = { x: event.clientX, y: event.clientY };
    cancelRef.current = trackDrawingGesture(window, {
      move: () => {},
      finish: (ev) => {
        if (Math.abs(ev.clientX - origin.x) < 3 && Math.abs(ev.clientY - origin.y) < 3) return;
        const l = local(ev.clientX, ev.clientY);
        const end = l && pointAt(l.x, l.y);
        if (!end) return;
        const points = [start, end];
        if (!open && points.length >= required) { setPending(null); commit(kind, points); }
        else setPending({ kind, points });
      },
      cancel: () => setPending(null),
    }, true);
  };

  const finishPolyline = useCallback(() => {
    const current = pendingRef.current;
    if (!current || current.kind !== 'polyline') return;
    setPending(null);
    // A double click also landed a second click on the last point; drop it.
    const points = current.points.filter((p, i, all) => i === 0 || p.time !== all[i - 1].time || p.price !== all[i - 1].price);
    if (points.length >= 2) commit('polyline', points);
  }, [commit]);

  // Keys: Enter finishes a polyline; Delete removes the selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'Enter' && pendingRef.current?.kind === 'polyline') { event.preventDefault(); finishPolyline(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== null && !lockedRef.current) {
        const selected = drawingsRef.current.find((d) => d.id === selectedId);
        if (!selected || selected.locked) return;
        event.preventDefault();
        setDrawings((previous) => previous.filter((d) => d.id !== selectedId));
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, finishPolyline, onSelect, setDrawings]);

  /** Press on a drawing in a cursor mode: select it and drag the body. */
  const startMove = (event: React.PointerEvent, drawing: ChartDrawing) => {
    if (event.button !== 0 || blocked) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect(drawing.id);
    if (lockedRef.current || drawing.locked || !view) return;
    const origin = local(event.clientX, event.clientY);
    if (!origin) return;
    const screen = drawing.points.map((p) => ({ x: drawing.kind === 'horizontal' ? 0 : view.x(p.time), y: drawing.kind === 'vertical' ? 0 : view.y(p.price) }));
    if (screen.some((p) => p.x === null || p.y === null)) return;
    cancelRef.current = trackDrawingGesture(window, {
      move: (ev) => {
        const now = local(ev.clientX, ev.clientY);
        if (!now) return;
        const dx = now.x - origin.x, dy = now.y - origin.y;
        const points: DrawingPoint[] = [];
        for (let i = 0; i < screen.length; i++) {
          const moved = pointAt((screen[i].x as number) + dx, (screen[i].y as number) + dy);
          if (!moved) return;
          points.push(drawing.kind === 'horizontal' ? { time: 0, price: moved.price } : drawing.kind === 'vertical' ? { time: moved.time, price: 0 } : moved);
        }
        setDrawings((previous) => previous.map((d) => (d.id === drawing.id ? { ...d, points } : d)));
      },
      finish: () => {},
      cancel: () => setDrawings((previous) => previous.map((d) => (d.id === drawing.id ? { ...d, points: drawing.points } : d))),
    }, true);
  };

  /** Press on a handle of the selection: move that anchor. */
  const startAnchor = (event: React.PointerEvent, drawing: ChartDrawing, anchor: DrawingAnchor) => {
    if (event.button !== 0 || blocked) return;
    event.stopPropagation();
    event.preventDefault();
    if (lockedRef.current || drawing.locked) return;
    cancelRef.current = trackDrawingGesture(window, {
      move: (ev) => {
        const now = local(ev.clientX, ev.clientY);
        const to = now && pointAt(now.x, now.y);
        if (!to) return;
        setDrawings((previous) => previous.map((d) => (d.id === drawing.id ? { ...moveAnchor(d, anchor.id, to), id: d.id } : d)));
      },
      finish: () => {},
      cancel: () => setDrawings((previous) => previous.map((d) => (d.id === drawing.id ? drawing : d))),
    }, true);
  };

  const selected = selectedId === null ? null : drawings.find((d) => d.id === selectedId) ?? null;
  const selectedGeometry = selected ? geometries.get(selected.id) : undefined;

  // The shape being placed, previewed against the pointer.
  const preview = (() => {
    if (!pending || !view || !hover) return null;
    if (FREEHAND_KINDS.includes(pending.kind)) return drawingGeometry({ kind: pending.kind, points: pending.points }, view);
    const next = pointAt(hover.x, hover.y);
    const points = next ? [...pending.points, next] : pending.points;
    const required = pending.kind === 'polyline' ? points.length : DRAWING_POINTS[pending.kind].min;
    // Kinds that need more anchors than placed so far preview as the path so far.
    if (points.length < required) {
      return drawingGeometry({ kind: 'polyline', points: points.length > 1 ? points : [points[0], points[0]], style: drawingStyle({ kind: pending.kind }) }, view);
    }
    return drawingGeometry({ kind: pending.kind, points: points.slice(0, required), text: DRAWING_TEXT_KINDS.includes(pending.kind) ? '…' : undefined }, view);
  })();

  const cursor = tool === 'erase' ? 'cell' : capture ? 'crosshair' : undefined;

  return <>
    <svg ref={svgRef} className="drawing-overlay drawing-layer" data-drawing-layer
      style={{ ...props.overlayStyle, pointerEvents: capture ? 'auto' : 'none', cursor, touchAction: capture ? 'none' : undefined }}
      onPointerDown={onPointerDown} onDoubleClick={finishPolyline}>
      {capture && <rect x={0} y={0} width="100%" height="100%" fill="transparent" />}
      <g data-chart-drawings="shapes">
        {drawings.map((d) => {
          const g = geometries.get(d.id);
          if (!g) return null;
          return <g key={d.id} data-drawing-kind={d.kind} data-drawing-selected={d.id === selectedId || undefined}>
            <Primitives prims={g.prims} />
            {!capture && !blocked && <HitTargets geometry={g} onPointerDown={(e) => startMove(e, d)} />}
          </g>;
        })}
        {preview && <g opacity={0.85}><Primitives prims={preview.prims} /></g>}
        {capture && hover && tool !== 'erase' && <g pointerEvents="none">
          <line x1={hover.x} y1={0} x2={hover.x} y2="100%" stroke="#9598a1" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
          <line x1={0} y1={hover.y} x2="100%" y2={hover.y} stroke="#9598a1" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
        </g>}
        {tool === 'dot' && hover && !capture && <circle cx={hover.x} cy={hover.y} r={3} fill="#d1d4dc" pointerEvents="none" />}
        {selected && selectedGeometry && !capture && selectedGeometry.anchors.map((a) => (
          <circle key={String(a.id)} data-drawing-anchor={String(a.id)} cx={a.x} cy={a.y} r={5} fill="#131722" stroke={drawingStyle(selected).color} strokeWidth={2}
            style={{ pointerEvents: blocked ? 'none' : 'all', cursor: a.id === 'width' ? 'ew-resize' : a.id === 'target' || a.id === 'stop' ? 'ns-resize' : 'grab' }}
            onPointerDown={(e) => startAnchor(e, selected, a)} />
        ))}
      </g>
    </svg>
    {selected && !blocked && <DrawingObjectToolbar drawing={selected} locked={locked} t={t}
      onStyle={(style) => setDrawings((previous) => previous.map((d) => (d.id === selected.id ? { ...d, style } : d)))}
      onToggleLock={() => setDrawings((previous) => previous.map((d) => (d.id === selected.id ? { ...d, locked: !d.locked || undefined } : d)))}
      onClone={() => {
        const copy: ChartDrawing = { ...selected, id: newDrawingId(), locked: undefined, points: selected.points.map((p) => ({ ...p })) };
        setDrawings((previous) => [...previous, copy]);
        onSelect(copy.id);
      }}
      onDelete={() => { setDrawings((previous) => previous.filter((d) => d.id !== selected.id)); onSelect(null); }}
      onEditText={DRAWING_TEXT_KINDS.includes(selected.kind) ? () => props.onRequestText({ edit: selected }) : undefined}
      onClose={() => onSelect(null)} />}
  </>;
}

/** Paint primitives. Labels carry their own box, placed by `labelBox`. */
function Primitives({ prims }: { prims: Primitive[] }) {
  return <>{prims.map((p, i) => {
    switch (p.t) {
      case 'line':
        return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.color} strokeWidth={p.width} strokeDasharray={p.dash} opacity={p.opacity} strokeLinecap="round" />;
      case 'poly': {
        const points = p.points.map((q) => `${q.x},${q.y}`).join(' ');
        const shared = { points, fill: p.fill ?? 'none', fillOpacity: p.fillOpacity, stroke: p.stroke ?? 'none', strokeWidth: p.width, strokeDasharray: p.dash, opacity: p.opacity, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
        return p.closed ? <polygon key={i} {...shared} /> : <polyline key={i} {...shared} />;
      }
      case 'ellipse':
        return <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} stroke={p.stroke} strokeWidth={p.width} strokeDasharray={p.dash} fill={p.fill ?? 'none'} fillOpacity={p.fillOpacity} />;
      case 'text':
        return <text key={i} x={p.x} y={p.y} fill={p.color} fontSize={p.size} fontWeight={p.weight} textAnchor={p.anchor} style={{ userSelect: 'none' }}>{p.text}</text>;
      case 'label': {
        const box = labelBox(p);
        const size = p.size ?? 11;
        return <g key={i} style={{ userSelect: 'none' }}>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={3} fill={p.bg} />
          {p.lines.map((line, n) => <text key={n} x={box.x + box.w / 2} y={box.y + 4 + (n + 1) * 15 * (size / 11) - 4} fill={p.color} fontSize={size} textAnchor="middle">{line}</text>)}
        </g>;
      }
    }
  })}</>;
}

/** Invisible, wider targets over what is painted, live only in cursor modes. */
function HitTargets({ geometry, onPointerDown }: { geometry: DrawingGeometry; onPointerDown: (e: React.PointerEvent) => void }) {
  const style: CSSProperties = { cursor: 'pointer' };
  return <g onPointerDown={onPointerDown}>
    {geometry.strokes.map((s, i) => <polyline key={`s${i}`} points={s.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="transparent" strokeWidth={HIT_RADIUS * 2} style={{ ...style, pointerEvents: 'stroke' }} />)}
    {geometry.areas.map((a, i) => <polygon key={`a${i}`} points={a.map((q) => `${q.x},${q.y}`).join(' ')} fill="transparent" style={{ ...style, pointerEvents: 'fill' }} />)}
    {geometry.boxes.map((b, i) => <rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" style={{ ...style, pointerEvents: 'fill' }} />)}
  </g>;
}

/**
 * The floating toolbar over a selected drawing, as in TradingView: line
 * colour, fill, width, line style, the object's own lock, clone and
 * delete, plus text for the kinds that carry words.
 */
export function DrawingObjectToolbar({ drawing, locked, t, onStyle, onToggleLock, onClone, onDelete, onEditText, onClose }: {
  drawing: ChartDrawing; locked: boolean; t: (key: any) => string;
  onStyle: (style: DrawingStyle) => void; onToggleLock: () => void; onClone: () => void; onDelete: () => void;
  onEditText?: () => void; onClose: () => void;
}) {
  const [menu, setMenu] = useState<null | 'color' | 'fill' | 'width' | 'dash'>(null);
  const style = drawingStyle(drawing);
  const frozen = locked || !!drawing.locked;
  const set = (patch: Partial<DrawingStyle>) => { onStyle({ ...style, ...patch }); setMenu(null); };
  const canFill = style.fill !== undefined;
  return <div className="drawing-object-toolbar" role="toolbar" aria-label={t('draw.objectToolbar')} data-drawing-object-toolbar
    onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (menu) setMenu(null); else onClose(); } }}>
    <button type="button" data-object-action="color" title={t('draw.lineColor')} aria-label={t('draw.lineColor')} disabled={frozen} aria-expanded={menu === 'color'} onClick={() => setMenu(menu === 'color' ? null : 'color')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16" stroke={style.color} strokeWidth="3" /><path d="m14 4 4 4-9 9H5v-4z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
    </button>
    {canFill && <button type="button" data-object-action="fill" title={t('draw.fillColor')} aria-label={t('draw.fillColor')} disabled={frozen} aria-expanded={menu === 'fill'} onClick={() => setMenu(menu === 'fill' ? null : 'fill')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="16" width="16" height="4" fill={style.fill} /><path d="m6 11 6-6 6 6-6 6z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
    </button>}
    <button type="button" data-object-action="width" title={t('draw.lineWidth')} aria-label={t('draw.lineWidth')} disabled={frozen} aria-expanded={menu === 'width'} onClick={() => setMenu(menu === 'width' ? null : 'width')}>
      <span className="drawing-object-width"><i style={{ height: Math.min(4, style.width) }} />{style.width}px</span>
    </button>
    <button type="button" data-object-action="dash" title={t('draw.lineStyle')} aria-label={t('draw.lineStyle')} disabled={frozen} aria-expanded={menu === 'dash'} onClick={() => setMenu(menu === 'dash' ? null : 'dash')}>
      <svg width="22" height="18" viewBox="0 0 24 18" aria-hidden="true"><line x1="2" y1="9" x2="22" y2="9" stroke="currentColor" strokeWidth="2" strokeDasharray={style.dash === 'dashed' ? '5 3' : style.dash === 'dotted' ? '1 3' : undefined} strokeLinecap="round" /></svg>
    </button>
    {onEditText && <button type="button" data-object-action="text" title={t('draw.editText')} aria-label={t('draw.editText')} disabled={frozen} onClick={onEditText}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </button>}
    <span className="drawing-object-sep" />
    <button type="button" data-object-action="lock" title={drawing.locked ? t('draw.unlockObject') : t('draw.lockObject')} aria-label={drawing.locked ? t('draw.unlockObject') : t('draw.lockObject')} aria-pressed={!!drawing.locked} disabled={locked} onClick={onToggleLock}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d={drawing.locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-2'} fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
    </button>
    <button type="button" data-object-action="clone" title={t('draw.clone')} aria-label={t('draw.clone')} disabled={locked} onClick={onClone}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M16 5H6a2 2 0 0 0-2 2v10" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
    </button>
    <button type="button" data-object-action="delete" title={t('draw.deleteObject')} aria-label={t('draw.deleteObject')} disabled={frozen} onClick={onDelete}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
    </button>
    {menu && <div className="drawing-object-menu" role="menu" data-object-menu={menu}>
      {(menu === 'color' || menu === 'fill') && <div className="drawing-object-palette">
        {DRAWING_PALETTE.map((c) => <button key={c} type="button" role="menuitemradio" aria-checked={(menu === 'color' ? style.color : style.fill) === c} aria-label={c} title={c}
          style={{ background: c }} onClick={() => set(menu === 'color' ? { color: c } : { fill: c })} />)}
      </div>}
      {menu === 'width' && DRAWING_WIDTHS.map((w) => <button key={w} type="button" role="menuitemradio" aria-checked={style.width === w} className="drawing-object-menu-row" onClick={() => set({ width: w })}>
        <i style={{ height: w }} /><span>{w}px</span>
      </button>)}
      {menu === 'dash' && DASHES.map((d) => <button key={d} type="button" role="menuitemradio" aria-checked={style.dash === d} className="drawing-object-menu-row" onClick={() => set({ dash: d })}>
        <svg width="40" height="10" viewBox="0 0 40 10" aria-hidden="true"><line x1="2" y1="5" x2="38" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={d === 'dashed' ? '6 4' : d === 'dotted' ? '1 4' : undefined} strokeLinecap="round" /></svg>
        <span>{t(`draw.dash.${d}`)}</span>
      </button>)}
    </div>}
  </div>;
}

/** The hit-testing a click-to-erase and a click-to-select both use. */
export function drawingAt(drawings: readonly ChartDrawing[], view: DrawingView, p: { x: number; y: number }): ChartDrawing | null {
  for (let i = drawings.length - 1; i >= 0; i--) {
    const g = drawingGeometry(drawings[i], view);
    if (g && geometryDistance(g, p) <= HIT_RADIUS) return drawings[i];
  }
  return null;
}

export { anchorAt };
