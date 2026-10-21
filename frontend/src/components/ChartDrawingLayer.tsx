import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import {
  DRAWING_POINTS, DRAWING_TEXT_KINDS, FREEHAND_KINDS, LIVE_SNAP_PX,
  drawingStyle, drawingVisibleOn, readableTextOn, settleLiveEnd, trackDrawingGesture,
  type DrawingKind, type DrawingPoint, type StoredDrawing,
} from '../lib/chartDrawings';
import { anchorAt, drawingGeometry, drawingToolbarPlacement, geometryDistance, hitGeometry, labelBox, measurementLine, moveAnchor, HIT_RADIUS, type DrawingAnchor, type DrawingGeometry, type DrawingView, type Primitive } from '../lib/drawingGeometry';
import { DrawingActions, DrawingObjectToolbar, TOOLBAR_HEIGHT } from './DrawingObjectToolbar';
import { DrawingSettingsDialog } from './DrawingSettingsDialog';

export { DrawingObjectToolbar };

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
  /** The chart's interval: a drawing set to other timeframes («Видимость») is not shown on it. */
  intervalSeconds?: number;
  t: (key: any) => string;
}

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
  const { drawings: everyDrawing, setDrawings, tool, view, pointAt, locked, blocked, selectedId, onSelect, t } = props;
  // A drawing set to other timeframes («Видимость») is neither painted nor hit on this one.
  const drawings = useMemo(() => everyDrawing.filter((d) => drawingVisibleOn(d, props.intervalSeconds)), [everyDrawing, props.intervalSeconds]);
  const svgRef = useRef<SVGSVGElement>(null);
  // TradingView's settings dialog (gear, double click, «…» → Настройки) and the right-click menu.
  const [settingsId, setSettingsId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [pending, setPending] = useState<{ kind: DrawingKind; points: DrawingPoint[] } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // The ruler under the pointer shows its handles before it is selected, so
  // there is something to grab (owner, 2026-10-04: «тут немає за що тягнути»).
  const [hoverRuler, setHoverRuler] = useState<number | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRulerOn = (id: number) => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setHoverRuler(id); };
  // Leaving the body for a handle is not leaving the ruler: let the handle claim it first.
  const hoverRulerOff = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHoverRuler(null), 250); };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  // While a ruler edge is dragged: its price across the whole plot, its label
  // out of the way, so the line it is being lined up with stays visible.
  const [guide, setGuide] = useState<{ id: number; price: number; snapped: boolean } | null>(null);

  const drawingTool = !CURSOR_TOOLS.includes(tool);
  // The eraser is not a drawing tool for the plot: it acts on a drawing's
  // own hit target (startMove) and leaves the bare chart to pan, as on
  // TradingView. Taking the whole plot left the chart dead while the eraser
  // stayed selected (owner, 2026-10-21: «графік не переміщується»).
  const erasing = tool === 'erase';
  const capture = drawingTool && !erasing && !blocked;

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
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== null && !lockedRef.current && settingsId === null) {
        const selected = drawingsRef.current.find((d) => d.id === selectedId);
        if (!selected || selected.locked) return;
        event.preventDefault();
        setDrawings((previous) => previous.filter((d) => d.id !== selectedId));
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, settingsId, finishPolyline, onSelect, setDrawings]);

  // A selection that goes away takes its menu with it.
  useEffect(() => { if (selectedId === null) setContextMenu(null); }, [selectedId]);
  useEffect(() => {
    if (!contextMenu) return;
    const away = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.('[data-drawing-context-menu]')) setContextMenu(null); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc); };
  }, [contextMenu]);

  const openSettings = (drawing: ChartDrawing) => { if (blocked) return; onSelect(drawing.id); setContextMenu(null); setSettingsId(drawing.id); };
  const openContextMenu = (event: React.MouseEvent, drawing: ChartDrawing) => {
    if (blocked) return;
    event.preventDefault();
    event.stopPropagation();
    const at = local(event.clientX, event.clientY);
    onSelect(drawing.id);
    if (at) setContextMenu({ id: drawing.id, x: at.x, y: at.y });
  };
  const replace = (next: ChartDrawing) => setDrawings((previous) => previous.map((d) => (d.id === next.id ? next : d)));
  const remove = (id: number) => { setDrawings((previous) => previous.filter((d) => d.id !== id)); onSelect(null); setSettingsId(null); setContextMenu(null); };
  const clone = (source: ChartDrawing) => {
    const copy: ChartDrawing = { ...source, id: newDrawingId(), locked: undefined, points: source.points.map((p) => ({ ...p })) };
    setDrawings((previous) => [...previous, copy]);
    onSelect(copy.id);
  };
  // Visual order: TradingView's «На передний план» / «На задний план» — the paint order is the list order.
  const reorder = (id: number, to: 'front' | 'back') => setDrawings((previous) => {
    const item = previous.find((d) => d.id === id);
    if (!item) return previous;
    const rest = previous.filter((d) => d.id !== id);
    return to === 'front' ? [...rest, item] : [item, ...rest];
  });
  const toggleLock = (id: number) => setDrawings((previous) => previous.map((d) => (d.id === id ? { ...d, locked: !d.locked || undefined } : d)));

  /** Press on a drawing in a cursor mode: select it and drag the body. With the eraser: remove it (a locked one stays). */
  const startMove = (event: React.PointerEvent, drawing: ChartDrawing) => {
    if (event.button !== 0 || blocked) return;
    event.stopPropagation();
    event.preventDefault();
    if (erasing) {
      if (!lockedRef.current && !drawing.locked) { setDrawings((previous) => previous.filter((d) => d.id !== drawing.id)); if (selectedId === drawing.id) onSelect(null); }
      return;
    }
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
          // A live end stays on the latest price; only the start moves.
          if (drawing.followLast && i === 1) { points.push(drawing.points[1]); continue; }
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
    if (selectedId !== drawing.id) onSelect(drawing.id);
    if (lockedRef.current || drawing.locked) return;
    const ruler = drawing.kind === 'ruler';
    // Grabbing a live end by hand fixes it where it is now.
    const endAnchor = anchor.id === 1 || anchor.id === 'edge1';
    const live = view?.live;
    cancelRef.current = trackDrawingGesture(window, {
      move: (ev) => {
        const now = local(ev.clientX, ev.clientY);
        let to = now && pointAt(now.x, now.y);
        if (!to) return;
        let snapped = false;
        if (ruler && live && view) {
          // Near the latest price, land exactly on it.
          const liveY = view.y(live.price), toY = view.y(to.price);
          if (liveY !== null && toY !== null && Math.abs(liveY - toY) <= LIVE_SNAP_PX) { to = { ...to, price: live.price }; snapped = true; }
        }
        const target = to;
        if (ruler) setGuide({ id: drawing.id, price: target.price, snapped });
        setDrawings((previous) => previous.map((d) => (d.id === drawing.id
          ? { ...moveAnchor(endAnchor ? settleLiveEnd(d, live) : d, anchor.id, target), id: d.id } : d)));
      },
      finish: () => setGuide(null),
      cancel: () => { setGuide(null); setDrawings((previous) => previous.map((d) => (d.id === drawing.id ? drawing : d))); },
    }, true);
  };

  const selected = selectedId === null ? null : drawings.find((d) => d.id === selectedId) ?? null;
  // Handles: the selection's, or a hovered ruler's before it is selected.
  const handled = selected ?? (hoverRuler === null ? null : drawings.find((d) => d.id === hoverRuler) ?? null);
  const handledGeometry = handled ? geometries.get(handled.id) : undefined;

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

  const cursor = erasing ? 'cell' : capture ? 'crosshair' : undefined;

  return <>
    <svg ref={svgRef} className="drawing-overlay drawing-layer" data-drawing-layer
      style={{ ...props.overlayStyle, pointerEvents: capture ? 'auto' : 'none', cursor, touchAction: capture ? 'none' : undefined }}
      onPointerDown={onPointerDown} onDoubleClick={finishPolyline}>
      {capture && <rect x={0} y={0} width="100%" height="100%" fill="transparent" />}
      <g data-chart-drawings="shapes">
        {drawings.map((d) => {
          const g = geometries.get(d.id);
          if (!g) return null;
          const guided = guide?.id === d.id;
          return <g key={d.id} data-drawing-kind={d.kind} data-drawing-selected={d.id === selectedId || undefined} data-drawing-live={d.followLast || undefined}
            onPointerEnter={d.kind === 'ruler' ? () => hoverRulerOn(d.id) : undefined} onPointerLeave={d.kind === 'ruler' ? hoverRulerOff : undefined}>
            <Primitives prims={guided ? g.prims.filter((p) => p.t !== 'label') : g.prims} />
            {!capture && !blocked && <HitTargets geometry={g} frozen={locked || !!d.locked} cursor={erasing ? 'cell' : 'pointer'} onPointerDown={(e) => startMove(e, d)} onDoubleClick={() => openSettings(d)} onContextMenu={(e) => openContextMenu(e, d)} />}
          </g>;
        })}
        {preview && <g opacity={0.85}><Primitives prims={preview.prims} /></g>}
        {capture && hover && <g pointerEvents="none">
          <line x1={hover.x} y1={0} x2={hover.x} y2="100%" stroke="#9598a1" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
          <line x1={0} y1={hover.y} x2="100%" y2={hover.y} stroke="#9598a1" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
        </g>}
        {tool === 'dot' && hover && !capture && <circle cx={hover.x} cy={hover.y} r={3} fill="#d1d4dc" pointerEvents="none" />}
        {handled && handledGeometry && !capture && handledGeometry.anchors.map((a) => (
          <g key={String(a.id)} data-drawing-anchor={String(a.id)} opacity={handled === selected ? 1 : 0.85}
            style={{ pointerEvents: blocked ? 'none' : 'all', cursor: a.id === 'width' ? 'ew-resize' : a.id === 'target' || a.id === 'stop' || a.id === 'edge0' || a.id === 'edge1' ? 'ns-resize' : 'grab' }}
            onPointerEnter={handled.kind === 'ruler' ? () => hoverRulerOn(handled.id) : undefined} onPointerLeave={handled.kind === 'ruler' ? hoverRulerOff : undefined}
            onPointerDown={(e) => startAnchor(e, handled, a)}>
            {/* A larger invisible ring around the visible handle: easy to catch on a busy chart. */}
            <circle cx={a.x} cy={a.y} r={11} fill="transparent" />
            <circle cx={a.x} cy={a.y} r={5} fill="#131722" stroke={drawingStyle(handled).color} strokeWidth={2} />
          </g>
        ))}
        {guide && view && <DragGuide view={view} price={guide.price} snapped={guide.snapped}
          color={drawingStyle(drawings.find((d) => d.id === guide.id) ?? { kind: 'ruler' }).color} t={t} />}
      </g>
    </svg>
    {selected && !blocked && settingsId === null && <DrawingObjectToolbar key={selected.id} drawing={selected} locked={locked} t={t}
      placement={view ? drawingToolbarPlacement(geometries.get(selected.id), { width: view.width, height: view.height }, { w: toolbarWidth(selected), h: TOOLBAR_HEIGHT }) : undefined}
      onStyle={(style) => setDrawings((previous) => previous.map((d) => (d.id === selected.id ? { ...d, style } : d)))}
      onToggleLock={() => toggleLock(selected.id)}
      onClone={() => clone(selected)}
      onDelete={() => remove(selected.id)}
      onEditText={DRAWING_TEXT_KINDS.includes(selected.kind) ? () => props.onRequestText({ edit: selected }) : undefined}
      onSettings={() => openSettings(selected)}
      onOrder={(to) => reorder(selected.id, to)}
      onClose={() => onSelect(null)} />}
    {contextMenu && (() => {
      const target = drawings.find((d) => d.id === contextMenu.id);
      if (!target) return null;
      return <ContextMenu key={`${contextMenu.id}:${contextMenu.x}:${contextMenu.y}`} x={contextMenu.x} y={contextMenu.y}>
        <DrawingActions t={t} drawing={target} locked={locked} onSettings={() => openSettings(target)} onClone={() => clone(target)}
          onOrder={(to) => reorder(target.id, to)} onToggleLock={() => toggleLock(target.id)} onDelete={() => remove(target.id)} onDone={() => setContextMenu(null)} />
      </ContextMenu>;
    })()}
    {settingsId !== null && (() => {
      const target = everyDrawing.find((d) => d.id === settingsId);
      return target ? <DrawingSettingsDialog key={target.id} drawing={target} locked={locked} live={view?.live ?? null} t={t}
        onPreview={replace} onClose={() => setSettingsId(null)} /> : null;
    })()}
  </>;
}

/** The right-click menu at the pointer, kept inside the chart: it opens upward or leftward where there is no room. */
function ContextMenu({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const node = ref.current, parent = node?.offsetParent as HTMLElement | null;
    if (!node || !parent) return;
    const w = node.offsetWidth, h = node.offsetHeight;
    setAt({
      left: x + w + 4 > parent.clientWidth ? Math.max(4, x - w) : x,
      top: y + h + 4 > parent.clientHeight ? Math.max(4, Math.min(y - h, parent.clientHeight - h - 4)) : y,
    });
  }, [x, y]);
  return <div ref={ref} className="drawing-object-menu drawing-context-menu" role="menu" data-drawing-context-menu
    style={{ left: at.left, top: at.top }} onPointerDown={(e) => e.stopPropagation()}>{children}</div>;
}

/**
 * While a ruler edge is dragged: a thin line at its price across the whole
 * plot and the exact price in a tag at the right edge — «Текущая цена» when
 * it has landed on the latest price. The ruler's own label is hidden
 * meanwhile, so it never covers the line being lined up with.
 */
function DragGuide({ view, price, snapped, color, t }: { view: DrawingView; price: number; snapped: boolean; color: string; t: (key: any) => string }) {
  const y = view.y(price);
  if (y === null || !Number.isFinite(y)) return null;
  const tone = snapped ? '#f0b90b' : color;
  const value = view.formatPrice ? view.formatPrice(price) : String(price);
  const text = snapped ? `${t('draw.currentPrice')} ${value}` : value;
  const w = text.length * 7 + 14, h = 20;
  const x = Math.max(0, view.width - w - 2);
  const top = Math.max(0, Math.min(view.height - h, y - h / 2));
  return <g pointerEvents="none" data-drawing-guide data-guide-snapped={snapped || undefined}>
    <line x1={0} y1={y} x2={view.width} y2={y} stroke={tone} strokeWidth={1} strokeDasharray="4 3" />
    <rect x={x} y={top} width={w} height={h} rx={3} fill={tone} />
    <text x={x + w / 2} y={top + 14} fill={readableTextOn(tone)} fontSize={12} textAnchor="middle" style={{ userSelect: 'none' }}>{text}</text>
  </g>;
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
        if (p.variant === 'measurement') {
          // TradingView's measurement label: a solid card in the measurement's
          // colour, every line in the label colour; «Фон метки» off leaves the text alone.
          const pitch = measurementLine(size);
          return <g key={i} data-ruler-label style={{ userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>
            <title>{p.lines.join('\n')}</title>
            {p.bg !== 'none' && <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={4} fill={p.bg} />}
            {p.lines.map((line, n) => {
              const note = p.note?.line === n ? p.note : undefined;
              const available = Math.max(1, box.w - 24);
              const fits = line.length * 6.4 * (size / 11) <= available;
              return <text key={n} x={box.x + box.w / 2} y={box.y + 8 + n * pitch + Math.round(pitch * 0.68)}
                fill={p.color} fontSize={size} fontWeight={note ? (note.bold ? 700 : 400) : n === 0 ? 600 : 500} fontStyle={note?.italic ? 'italic' : undefined}
                textAnchor="middle" {...(!fits ? { textLength: available, lengthAdjust: 'spacingAndGlyphs' as const } : {})}>{line}</text>;
            })}
          </g>;
        }
        return <g key={i} style={{ userSelect: 'none' }}>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={3} fill={p.bg} />
          {p.lines.map((line, n) => <text key={n} x={box.x + box.w / 2} y={box.y + 4 + (n + 1) * 15 * (size / 11) - 4} fill={p.color} fontSize={size} textAnchor="middle">{line}</text>)}
        </g>;
      }
    }
  })}</>;
}

/**
 * The invisible shapes a pointer meets before the chart's canvas. The SVG
 * itself passes the pointer through (pointer-events: none outside a tool),
 * so only these take a press. A frozen drawing — locked itself, or every
 * drawing locked — offers its outline and labels only (lib/drawingGeometry
 * hitGeometry): its body would swallow the press and move nothing, and the
 * chart under it could not be panned (owner, 2026-10-21).
 */
function HitTargets({ geometry, frozen, cursor, onPointerDown, onDoubleClick, onContextMenu }: {
  geometry: DrawingGeometry; frozen: boolean; cursor: 'pointer' | 'cell'; onPointerDown: (e: React.PointerEvent) => void; onDoubleClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const style: CSSProperties = { cursor };
  const hit = hitGeometry(geometry, frozen);
  return <g data-drawing-hit={frozen ? 'outline' : 'body'} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick ? (e) => { e.stopPropagation(); onDoubleClick(); } : undefined} onContextMenu={onContextMenu}>
    {hit.strokes.map((s, i) => <polyline key={`s${i}`} points={s.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="transparent" strokeWidth={HIT_RADIUS * 2} style={{ ...style, pointerEvents: 'stroke' }} />)}
    {hit.areas.map((a, i) => <polygon key={`a${i}`} points={a.map((q) => `${q.x},${q.y}`).join(' ')} fill="transparent" style={{ ...style, pointerEvents: 'fill' }} />)}
    {hit.boxes.map((b, i) => <rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" style={{ ...style, pointerEvents: 'fill' }} />)}
  </g>;
}

/** The toolbar's width before it has rendered: 36px a button, plus its grip and padding (DrawingObjectToolbar). */
function toolbarWidth(drawing: ChartDrawing): number {
  const style = drawingStyle(drawing);
  const measure = drawing.kind === 'ruler' || drawing.kind === 'pricerange' || drawing.kind === 'daterange';
  const text = DRAWING_TEXT_KINDS.includes(drawing.kind);
  const buttons = 7 + (style.fill !== undefined || measure ? 1 : 0) + (measure ? 1 : 0) + (!measure && !text ? 1 : 0) + (text ? 1 : 0);
  return buttons * 36 + 30;
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
