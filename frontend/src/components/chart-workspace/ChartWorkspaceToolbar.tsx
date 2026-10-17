import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChartWorkspaceMenu } from './ChartWorkspaceMenu';

/**
 * The chart workspace's second row (2026-10-13): the timeframe strip at the
 * left, the tool groups, the quick actions at the right and the terminal's
 * own end slot (the VOLTEX / TradingView switch). What does not fit the
 * width moves into «Ещё» by priority rather than being clipped; on a phone
 * the row keeps the timeframes and the four most used keys, and everything
 * else lives in a bottom sheet behind «•••».
 *
 * A feature is a trigger plus either an action or a menu body; the same
 * body is rendered under the trigger, inside «Ещё» and inside the sheet,
 * so every control works wherever the width put it.
 */
export interface WorkspaceFeature {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Lower stays on the row longer. */
  priority: number;
  /** Menu body; `close` closes the menu it is in. */
  body?: (close: () => void) => ReactNode;
  /** Plain action instead of a menu. */
  onAction?: () => void;
  active?: boolean;
  /** Text under the icon-only trigger, for the tooltip and the sheet. */
  title?: string;
  /** Icon-only trigger on the row (quick actions). */
  iconOnly?: boolean;
  /** Width of the menu body. */
  menuWidth?: number;
  /** Keep on the phone row rather than in the sheet. */
  phoneRow?: boolean;
  /** Group separator before this feature. */
  separator?: boolean;
  /** Test hook on the trigger. */
  testId?: string;
  /** Badge text beside the label (e.g. an active count). */
  badge?: string;
  disabled?: boolean;
  disabledHint?: string;
}

export interface ChartWorkspaceToolbarProps {
  features: WorkspaceFeature[];
  /** The timeframe strip. */
  start: ReactNode;
  /** The terminal's end slot. */
  end?: ReactNode;
  /** The type and indicator menus (own component), kept on the row and on the phone. */
  menus?: ReactNode;
  compact: boolean;
  moreLabel: string;
  phoneLabel: string;
  closeLabel: string;
  /** Which feature's menu is open; the toolbar owns this. */
  onOpenChange?: (id: string | null) => void;
  /** Keyboard request from outside: open a feature by id (null closes). */
  openRequest?: { id: string | null; seq: number };
}

const GAP = 4;

/** How much the row must shed: 0 nothing, 1 the strip down to five quick
 *  timeframes and the indicator key to its icon, 2 the strip down to three,
 *  3 the chart type and indicator menus into «Ещё» as well. Set by the
 *  toolbar when the row is too narrow even with every feature inside «Ещё»;
 *  the strip reads it and keeps the rest reachable from its «▾» menu. */
export const ToolbarDensity = createContext(0);
const MAX_DENSE = 3;

/** The width a row part needs, not the width it was squeezed to: its box plus whatever its first child (the
 *  timeframe strip, a shrinkable scroll box whose keys keep their width) holds beyond its own box. */
function naturalWidth(part: HTMLElement | null): number {
  if (!part) return 0;
  const box = part.getBoundingClientRect().width;
  const inner = part.firstElementChild as HTMLElement | null;
  if (!inner || typeof getComputedStyle === 'undefined') return box;
  const style = getComputedStyle(inner);
  const px = (value: string) => parseFloat(value) || 0;
  let content = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
  const kids = Array.from(inner.children) as HTMLElement[];
  for (const kid of kids) { const ks = getComputedStyle(kid); content += kid.getBoundingClientRect().width + px(ks.marginLeft) + px(ks.marginRight); }
  content += px(style.columnGap) * Math.max(0, kids.length - 1);
  return Math.max(box, box - inner.getBoundingClientRect().width + content);
}

export function ChartWorkspaceToolbar({ features, start, end, menus, compact, moreLabel, phoneLabel, closeLabel, onOpenChange, openRequest }: ChartWorkspaceToolbarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const menusRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const widths = useRef(new Map<string, number>());
  const foldAt = useRef({ width: -1, dense: 0 });
  const moreSeen = useRef(0);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [measured, setMeasured] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const anchors = useRef(new Map<string, HTMLElement>());
  const moreRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLButtonElement>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const [dense, setDense] = useState(0);
  const denseRef = useRef(0);
  denseRef.current = dense;

  const ids = features.map(f => f.id).join('|');
  const labels = features.map(f => `${f.label}:${f.badge ?? ''}`).join('|');

  // Widths are read while an item is on the row (never from its copy in a list, which shows the label);
  // a hidden item keeps the last width it had. Labels or the language changing re-measures everything —
  // in the same commit as the change (a layout effect, before the fold below): run after paint, the old
  // fold was painted once more with the new labels and then re-folded (a key showing for a frame).
  useLayoutEffect(() => { widths.current.clear(); setMeasured(false); setHidden(new Set()); }, [labels, compact]);
  // Switching between the phone row and the desktop row starts from the full strip, as any outside width change does.
  useLayoutEffect(() => { denseRef.current = 0; foldAt.current = { width: -1, dense: 0 }; setDense(0); }, [compact]);

  const compute = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    if (compact) {
      // The phone row keeps every key; the strip sheds quick timeframes until its «▾» is on screen without scrolling.
      const start = startRef.current, strip = start?.firstElementChild;
      const overflows = (el: Element | null | undefined) => !!el && el.scrollWidth > el.clientWidth + 2;
      if ((overflows(start) || overflows(strip)) && denseRef.current < 2) setDense(denseRef.current + 1);
      return;
    }
    // One fold per width. A width change from outside (a layout change, a resize) starts from the full strip
    // BEFORE anything is folded: folding against the previous level's narrower strip put keys on the row for
    // a frame and took them away in the next passes (seen as «К дате» appearing and vanishing after 2 → 1
    // charts). Run from the layout effect, the dense change re-renders at once, so the row paints once. A width
    // change that came with our own density change is not a restart, or a row whose width follows its content
    // would never settle.
    const width = row.clientWidth;
    const external = foldAt.current.dense === denseRef.current && Math.abs(width - foldAt.current.width) >= 1;
    foldAt.current = { width, dense: denseRef.current };
    if (external && denseRef.current) { denseRef.current = 0; foldAt.current = { width, dense: 0 }; setDense(0); return; }
    for (const [id, el] of itemRefs.current) if (el.isConnected) widths.current.set(id, el.getBoundingClientRect().width + GAP);
    // Nothing is decided from a partial row: a key whose width was cleared by a label change and is not on
    // the row yet is measured by the re-measuring render that follows, which computes again. Treating it as
    // zero-width would show every key until the next measurement.
    if (features.some(f => !widths.current.has(f.id))) return;
    // The strip is a shrinkable scroll box: while keys share the row it gives way first, and its squeezed box
    // let keys through that its own keys pushed out again on the next passes (seen as «К дате», then
    // «Раскладка», then «Во весь экран» on the row for a frame each after 2 → 1 charts). Its keys keep their
    // width inside it, so what it needs is the sum of its keys. «Ещё» keeps the width it last had on the row
    // while it is not there (a guess of 44 px let one more key through on the measuring pass).
    const fixed = naturalWidth(startRef.current) + (endRef.current?.getBoundingClientRect().width ?? 0) + (menusRef.current?.getBoundingClientRect().width ?? 0);
    const moreNow = moreRef.current?.isConnected ? moreRef.current.getBoundingClientRect().width : 0;
    if (moreNow) moreSeen.current = moreNow;
    const moreWidth = (moreSeen.current || 44) + GAP;
    const total = width - 24;
    const sorted = [...features].sort((a, b) => a.priority - b.priority);
    const next = new Set<string>();
    let used = fixed;
    const all = sorted.reduce((sum, f) => sum + (widths.current.get(f.id) ?? 0), 0);
    const budget = used + all <= total ? total : total - moreWidth;
    for (const feature of sorted) {
      const w = widths.current.get(feature.id) ?? 0;
      if (used + w <= budget) used += w; else next.add(feature.id);
    }
    setHidden(previous => (previous.size === next.size && [...previous].every(id => next.has(id)) ? previous : next));
    // Everything is in «Ещё» and the row still overflows: the strip sheds quick timeframes, one level per pass.
    if (next.size === sorted.length && fixed + (next.size ? moreWidth : 0) > total && denseRef.current < MAX_DENSE) setDense(denseRef.current + 1);
    setMeasured(true);
  }, [features, compact]);

  useLayoutEffect(() => { compute(); }, [compute, ids, labels, measured, dense]);
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    // The row growing or shrinking starts a fresh pass from the full strip (compute sees the new width);
    // the strip itself changing size (its buttons arriving, the chart tab being revealed on a phone)
    // re-checks at the current level. Only a WIDTH change counts: a height change (a scrollbar appearing
    // under an overflowing row) must not, or the row would oscillate between its levels.
    const lastWidth = { value: -1 };
    const rowObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? row.clientWidth;
      if (Math.abs(width - lastWidth.value) < 1) return;
      lastWidth.value = width;
      compute();
    });
    rowObserver.observe(row);
    const strip = startRef.current?.firstElementChild;
    const stripObserver = new ResizeObserver(() => compute());
    if (strip) stripObserver.observe(strip);
    const settle = window.setTimeout(compute, 120);
    return () => { rowObserver.disconnect(); stripObserver.disconnect(); window.clearTimeout(settle); };
  }, [compute]);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.id === null) { setOpen(null); setSheetOpen(false); return; }
    const feature = features.find(f => f.id === openRequest.id);
    if (!feature) return;
    if (feature.onAction) { feature.onAction(); return; }
    setFromKeyboard(true);
    if (compact && !feature.phoneRow) setSheetOpen(true); else setOpen(feature.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.seq]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(current => {
      if (returnFocus && current) anchors.current.get(current)?.focus();
      return null;
    });
  }, []);

  const trigger = (feature: WorkspaceFeature, listMode = false) => {
    const isOpen = open === feature.id;
    const click = (event: React.MouseEvent) => {
      if (feature.disabled) return;
      if (feature.onAction) { feature.onAction(); if (listMode) { setSheetOpen(false); setOpen(null); } return; }
      setFromKeyboard(event.detail === 0);
      setOpen(current => (current === feature.id ? null : feature.id));
    };
    const title = feature.disabled && feature.disabledHint ? feature.disabledHint : feature.title ?? feature.label;
    return (
      <button
        key={feature.id}
        ref={node => { if (node && !listMode) { itemRefs.current.set(feature.id, node); anchors.current.set(feature.id, node); } }}
        type="button"
        className={`chart-tool-btn cw-feature${feature.iconOnly ? ' is-icon' : ''}${feature.active ? ' active' : ''}${listMode ? ' is-list' : ''}`}
        aria-label={title}
        title={title}
        aria-haspopup={feature.body ? 'dialog' : undefined}
        aria-expanded={feature.body ? isOpen : undefined}
        aria-pressed={feature.onAction && feature.active !== undefined ? feature.active : undefined}
        aria-disabled={feature.disabled || undefined}
        data-cw-feature={feature.testId ?? feature.id}
        onClick={click}
        onKeyDown={event => { if (feature.body && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setFromKeyboard(true); setOpen(feature.id); } }}
      >
        {feature.icon && <span className="cw-feature-icon" aria-hidden="true">{feature.icon}</span>}
        {(!feature.iconOnly || listMode) && <span className="cw-feature-label">{feature.label}</span>}
        {feature.badge && <span className="cw-feature-badge">{feature.badge}</span>}
        {feature.body && !feature.iconOnly && <svg className="cw-chev" viewBox="0 0 10 10" aria-hidden="true"><path d="m2.5 3.8 2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </button>
    );
  };

  const visible = compact ? features.filter(f => f.phoneRow) : features.filter(f => !hidden.has(f.id));
  const overflow = compact ? features.filter(f => !f.phoneRow) : features.filter(f => hidden.has(f.id));
  const openFeature = open ? features.find(f => f.id === open) : null;

  /** A feature's body inside a list (Ещё or the sheet): heading + body or a plain action row. */
  const section = (feature: WorkspaceFeature) => (
    <div key={feature.id} className="cw-section" data-cw-section={feature.testId ?? feature.id}>
      {feature.body ? <>
        <div className="cw-section-title">{feature.icon && <span className="cw-feature-icon" aria-hidden="true">{feature.icon}</span>}{feature.label}{feature.badge && <span className="cw-feature-badge">{feature.badge}</span>}</div>
        {feature.body(() => { setOpen(null); setSheetOpen(false); })}
      </> : trigger(feature, true)}
    </div>
  );

  return (
    <div ref={rowRef} className={`cw-row${measured || compact ? ' is-measured' : ''}${compact ? ' is-compact' : ''}`} data-cw-toolbar data-mobile-tools={sheetOpen || undefined} data-cw-dense={dense || undefined}
      data-cw-more={!compact && overflow.length > 0 ? overflow.length : undefined}>
      <div ref={startRef} className="cw-start"><ToolbarDensity.Provider value={dense}>{start}</ToolbarDensity.Provider></div>
      {menus && !compact && dense < 3 && <div ref={menusRef} className="cw-menus">{menus}</div>}
      <div className="cw-features">
        {visible.map((feature, i) => <span key={feature.id} className={`cw-feature-wrap${feature.separator && i > 0 ? ' has-separator' : ''}`}>{trigger(feature)}</span>)}
        {!compact && overflow.length > 0 && (
          <button ref={moreRef} type="button" className={`chart-tool-btn cw-feature cw-more${open === '__more' ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={open === '__more'}
            aria-label={moreLabel} title={moreLabel} data-cw-feature="more" onClick={event => { setFromKeyboard(event.detail === 0); setOpen(current => (current === '__more' ? null : '__more')); }}>
            <span className="cw-feature-label">{moreLabel}</span>
            <svg className="cw-chev" viewBox="0 0 10 10" aria-hidden="true"><path d="m2.5 3.8 2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>
      <div ref={endRef} className="cw-end">
        {compact && overflow.length > 0 && (
          <button ref={sheetRef} type="button" className="futures-mobile-tools-toggle cw-sheet-trigger" aria-label={phoneLabel} aria-haspopup="dialog" aria-expanded={sheetOpen} data-cw-feature="phone-more"
            onClick={() => setSheetOpen(value => !value)}>•••</button>
        )}
        {end}
      </div>

      {openFeature?.body && (
        <ChartWorkspaceMenu open anchor={anchors.current.get(openFeature.id) ?? null} onClose={close} label={openFeature.label} width={openFeature.menuWidth} sheet={compact} testId={openFeature.testId ?? openFeature.id} autoFocus={fromKeyboard}>
          <div className="cw-menu-title" aria-hidden="true">{openFeature.label}</div>
          {openFeature.body(() => close(true))}
        </ChartWorkspaceMenu>
      )}
      {open === '__more' && !compact && (
        <ChartWorkspaceMenu open anchor={moreRef.current} onClose={close} label={moreLabel} width={300} align="right" testId="more" autoFocus={fromKeyboard}>
          {menus && dense >= 3 && <div className="cw-section cw-sheet-menus" data-cw-section="menus">{menus}</div>}
          {overflow.map(section)}
        </ChartWorkspaceMenu>
      )}
      {compact && sheetOpen && (
        <ChartWorkspaceMenu open anchor={sheetRef.current} onClose={() => { setSheetOpen(false); sheetRef.current?.focus(); }} label={phoneLabel} sheet testId="phone-sheet" autoFocus={fromKeyboard}>
          {/* The chart type and indicator menus leave the phone row to the timeframes and live here. */}
          {menus && <div className="cw-section cw-sheet-menus" data-cw-section="menus">{menus}</div>}
          {overflow.map(section)}
          <button type="button" className="cw-sheet-done" onClick={() => setSheetOpen(false)}>{closeLabel}</button>
        </ChartWorkspaceMenu>
      )}
    </div>
  );
}
