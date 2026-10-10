import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './ChartToolbarMenus.css';

/**
 * The Futures chart's type and indicator controls as two compact menus
 * (owner, 2026-09-29: «Свечи Линия Область MA200 Bollinger RSI MACD» as a
 * flat row of eight buttons → one type button and one «Индикаторы» button).
 *
 * 2026-10-10 (Issue #502): the indicator menu is a catalogue — a search
 * field, the indicators already on the chart (show/hide, configure, remove)
 * and every indicator the chart can compute. The trigger no longer wears a
 * count: it reads «Индикаторы», as Bybit's does, whatever is active; the
 * count is announced to assistive technology only. The menus render into
 * document.body, like the drawing rail's flyouts, because the toolbar they
 * open from clips its overflow on every terminal design.
 */
export type ChartKind = 'candles' | 'line' | 'area';

export interface ChartIndicatorToggle {
  key: string;
  label: string;
  /** The indicator's real default parameters, as PriceChart computes it. */
  params: string;
  color: string;
  /** At least one instance of this indicator is on the chart. */
  active: boolean;
  /** Off → add one with its defaults; on → take every instance of it off. */
  onToggle: () => void;
  /** Add another copy beside the one already on the chart. */
  onAdd?: () => void;
  pane?: 'price' | 'lower';
}

export interface ChartActiveIndicator {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  onToggleVisible: () => void;
  onConfigure: () => void;
  onRemove: () => void;
}

interface Props {
  chartType: ChartKind;
  typeLabels: Record<ChartKind, string>;
  onChartType: (next: ChartKind) => void;
  indicators: ChartIndicatorToggle[];
  typeGroupLabel: string;
  indicatorsLabel: string;
  /** The catalogue menu's extra copy; without it the menu is the plain toggle list. */
  catalogue?: {
    active: ChartActiveIndicator[];
    activeLabel: string; catalogueLabel: string; searchLabel: string; noMatchLabel: string;
    /** «Active indicators: {count}», for the screen reader only. */
    activeCountLabel: (count: number) => string;
    visibleLabel: string; configureLabel: string; removeLabel: string; addLabel: string;
    pricePaneLabel: string; lowerPaneLabel: string;
  };
}

const svg = (children: ReactNode) => (
  <svg className="chart-menu-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const TYPE_ICONS: Record<ChartKind, ReactNode> = {
  candles: svg(<>
    <path d="M5 2.5v13M13 3.5v11" />
    <rect x="3" y="5.5" width="4" height="6.5" rx=".6" fill="currentColor" />
    <rect x="11" y="6.5" width="4" height="4.5" rx=".6" />
  </>),
  line: svg(<path d="M2.5 13 7 7.5l3 3L15.5 4" />),
  area: svg(<>
    <path d="M2.5 13 7 7.5l3 3L15.5 4v11.5h-13Z" fill="currentColor" fillOpacity=".22" stroke="none" />
    <path d="M2.5 13 7 7.5l3 3L15.5 4" />
  </>),
};

const INDICATORS_ICON = svg(<path d="M2.5 12.5c2.2 0 2.4-7 4.8-7s2.3 5 4.6 5c1.6 0 2-2.2 3.6-2.2" />);

const CHEVRON = (
  <svg className="chart-menu-chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m2.5 3.8 2.5 2.5 2.5-2.5" />
  </svg>
);

const CHECK = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m2.5 6.2 2.3 2.3 4.7-5" />
  </svg>
);
const EYE = (on: boolean) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
    {!on && <path d="m2.5 13.5 11-11" />}
  </svg>
);
const GEAR = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
);
const PLUS = (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 2v8M2 6h8" /></svg>
);

type Which = 'type' | 'indicators';
const MENU_WIDTH = 236;
const CATALOGUE_WIDTH = 312;

export function ChartToolbarMenus({ chartType, typeLabels, onChartType, indicators, typeGroupLabel, indicatorsLabel, catalogue }: Props) {
  const [open, setOpen] = useState<Which | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [query, setQuery] = useState('');
  const typeBtn = useRef<HTMLButtonElement>(null);
  const indBtn = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const typeMenuId = useId();
  const indMenuId = useId();
  const activeCount = catalogue ? catalogue.active.length : indicators.filter(i => i.active).length;
  const width = catalogue ? CATALOGUE_WIDTH : MENU_WIDTH;

  const trigger = (which: Which) => (which === 'type' ? typeBtn : indBtn).current;

  const show = (which: Which, withFocus: boolean) => {
    const button = trigger(which);
    if (!button) return;
    const r = button.getBoundingClientRect();
    const rows = which === 'type' ? 3 : (catalogue ? Math.min(12, catalogue.active.length + indicators.length) + 2 : indicators.length);
    const height = 44 + rows * 38 + (which === 'indicators' && catalogue ? 48 : 0);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
    const below = r.bottom + 6;
    const spaceBelow = window.innerHeight - 8 - below;
    const top = height <= spaceBelow ? below : Math.max(8, Math.min(below, window.innerHeight - 8 - Math.min(height, window.innerHeight - 16)));
    focusFirst.current = withFocus;
    setPos({ top, left, maxHeight: window.innerHeight - 8 - top });
    setQuery('');
    setOpen(which);
  };

  const close = (returnFocus: boolean) => {
    const was = open;
    setOpen(null);
    if (returnFocus && was) trigger(was)?.focus();
  };

  // Outside press, a page scroll or a resize closes the menu, as the
  // drawing flyouts do. Escape and Tab are handled on the menu itself.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || trigger(open)?.contains(target)) return;
      setOpen(null);
    };
    const onViewport = () => setOpen(null);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport);
    };
  }, [open]);

  // Keyboard opening lands on the checked item (type), the search field
  // (catalogue) or the first item.
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    const search = menuRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
    if (search) { search.focus(); return; }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    (items.find(i => i.getAttribute('aria-checked') === 'true' && open === 'type') ?? items[0])?.focus();
  }, [open]);

  const onTriggerKey = (which: Which) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(which, true);
    }
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const inSearch = (event.target as HTMLElement).tagName === 'INPUT';
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { setOpen(null); return; }
    if (inSearch && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
  };

  const toggle = (which: Which) => (event: React.MouseEvent<HTMLButtonElement>) => {
    if (open === which) { setOpen(null); return; }
    // A keyboard click (Enter/Space) reports no pointer position.
    show(which, event.detail === 0);
  };

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? indicators.filter(i => `${i.label} ${i.params} ${i.key}`.toLowerCase().includes(needle)) : indicators),
    [indicators, needle],
  );

  const catalogueRows = catalogue && (
    <>
      <div className="chart-menu-search" role="none">
        <input
          type="search"
          value={query}
          placeholder={catalogue.searchLabel}
          aria-label={catalogue.searchLabel}
          autoComplete="off"
          spellCheck={false}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      <div className="chart-menu-scroll">
        {catalogue.active.length > 0 && !needle && <>
          <div className="chart-menu-section" aria-hidden="true">{catalogue.activeLabel}</div>
          {catalogue.active.map(item => (
            <div key={item.id} className={`chart-menu-row${item.visible ? '' : ' is-hidden'}`} data-chart-active-indicator={item.id}>
              <span className="chart-menu-swatch" style={{ background: item.color }} aria-hidden="true" />
              <span className="chart-menu-label">{item.label}</span>
              <button type="button" role="menuitem" className="chart-menu-action" aria-pressed={item.visible} aria-label={`${catalogue.visibleLabel}: ${item.label}`} title={catalogue.visibleLabel} data-chart-indicator-visible={item.id} onClick={item.onToggleVisible}>{EYE(item.visible)}</button>
              <button type="button" role="menuitem" className="chart-menu-action" aria-label={`${catalogue.configureLabel}: ${item.label}`} title={catalogue.configureLabel} data-chart-indicator-configure={item.id} onClick={() => { item.onConfigure(); close(false); }}>{GEAR}</button>
              <button type="button" role="menuitem" className="chart-menu-action chart-menu-remove" aria-label={`${catalogue.removeLabel}: ${item.label}`} title={catalogue.removeLabel} data-chart-indicator-remove={item.id} onClick={item.onRemove}>{CROSS}</button>
            </div>
          ))}
        </>}
        <div className="chart-menu-section" aria-hidden="true">{catalogue.catalogueLabel}</div>
        {filtered.length === 0 && <div className="chart-menu-empty">{catalogue.noMatchLabel}</div>}
        {filtered.map(item => (
          <div key={item.key} className="chart-menu-row">
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={item.active}
              data-chart-indicator={item.key}
              className="chart-menu-item"
              onClick={item.onToggle}
            >
              <span className="chart-menu-swatch" style={{ background: item.color }} aria-hidden="true" />
              <span className="chart-menu-label">{item.label}</span>
              <span className="chart-menu-params">{item.params}</span>
              <span className="chart-menu-pane" aria-label={item.pane === 'lower' ? catalogue.lowerPaneLabel : catalogue.pricePaneLabel} title={item.pane === 'lower' ? catalogue.lowerPaneLabel : catalogue.pricePaneLabel}>{item.pane === 'lower' ? '▾' : '▴'}</span>
              <span className="chart-menu-box" aria-hidden="true">{item.active ? CHECK : null}</span>
            </button>
            {item.active && item.onAdd && (
              <button type="button" role="menuitem" className="chart-menu-action" aria-label={`${catalogue.addLabel}: ${item.label}`} title={catalogue.addLabel} data-chart-indicator-add={item.key} onClick={item.onAdd}>{PLUS}</button>
            )}
          </div>
        ))}
      </div>
    </>
  );

  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      className={`chart-menu${open === 'indicators' && catalogue ? ' chart-menu-catalogue' : ''}`}
      id={open === 'type' ? typeMenuId : indMenuId}
      role="menu"
      aria-label={open === 'type' ? typeGroupLabel : indicatorsLabel}
      style={{ top: pos.top, left: pos.left, width: open === 'type' ? MENU_WIDTH : width, maxHeight: pos.maxHeight }}
      onKeyDown={onMenuKey}
    >
      <div className="chart-menu-title" aria-hidden="true">{open === 'type' ? typeGroupLabel : indicatorsLabel}</div>
      {open === 'type'
        ? (Object.keys(typeLabels) as ChartKind[]).map(kind => (
          <button
            key={kind}
            type="button"
            role="menuitemradio"
            aria-checked={chartType === kind}
            data-chart-type={kind}
            className="chart-menu-item"
            onClick={() => { onChartType(kind); close(true); }}
          >
            {TYPE_ICONS[kind]}
            <span className="chart-menu-label">{typeLabels[kind]}</span>
            <span className="chart-menu-tick">{chartType === kind ? CHECK : null}</span>
          </button>
        ))
        : catalogue ? catalogueRows : indicators.map(item => (
          <button
            key={item.key}
            type="button"
            role="menuitemcheckbox"
            aria-checked={item.active}
            data-chart-indicator={item.key}
            className="chart-menu-item"
            onClick={item.onToggle}
          >
            <span className="chart-menu-swatch" style={{ background: item.color }} aria-hidden="true" />
            <span className="chart-menu-label">{item.label}</span>
            <span className="chart-menu-params">{item.params}</span>
            <span className="chart-menu-box" aria-hidden="true">{item.active ? CHECK : null}</span>
          </button>
        ))}
    </div>,
    document.body,
  );

  const activeTitle = catalogue ? catalogue.active.map(i => i.label).join(', ') : indicators.filter(i => i.active).map(i => i.label).join(', ');

  return (
    <div className="chart-menus">
      <button
        ref={typeBtn}
        type="button"
        className="chart-tool-btn chart-menu-trigger chart-type-trigger"
        aria-haspopup="menu"
        aria-expanded={open === 'type'}
        aria-controls={open === 'type' ? typeMenuId : undefined}
        aria-label={`${typeGroupLabel}: ${typeLabels[chartType]}`}
        title={`${typeGroupLabel}: ${typeLabels[chartType]}`}
        data-chart-type-current={chartType}
        onClick={toggle('type')}
        onKeyDown={onTriggerKey('type')}
      >
        {TYPE_ICONS[chartType]}
        {CHEVRON}
      </button>
      <button
        ref={indBtn}
        type="button"
        className="chart-tool-btn chart-menu-trigger chart-indicators-trigger"
        aria-haspopup="menu"
        aria-expanded={open === 'indicators'}
        aria-controls={open === 'indicators' ? indMenuId : undefined}
        title={activeTitle || indicatorsLabel}
        data-chart-indicators-active={activeCount}
        onClick={toggle('indicators')}
        onKeyDown={onTriggerKey('indicators')}
      >
        {INDICATORS_ICON}
        <span>{indicatorsLabel}</span>
        {/* The count is for assistive technology only; the visible trigger reads «Индикаторы», as Bybit's does. */}
        {activeCount > 0 && <span className="chart-menu-sr">{catalogue ? catalogue.activeCountLabel(activeCount) : String(activeCount)}</span>}
        {CHEVRON}
      </button>
      {menu}
    </div>
  );
}
