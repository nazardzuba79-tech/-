import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './ChartToolbarMenus.css';

/**
 * The Futures chart's type and indicator controls as two compact menus
 * (owner, 2026-09-29: «Свечи Линия Область MA200 Bollinger RSI MACD» as a
 * flat row of eight buttons → one type button and one «Индикаторы» button).
 *
 * Nothing about what the chart can do changes: the same three chart types,
 * the same four indicators, the same setters PriceChart already owns. Only
 * the way they are reached does. The menus render into document.body, like
 * the drawing rail's flyouts, because the toolbar they open from clips its
 * overflow on every terminal design.
 */
export type ChartKind = 'candles' | 'line' | 'area';

export interface ChartIndicatorToggle {
  key: string;
  label: string;
  /** The indicator's real parameters, as PriceChart computes it. */
  params: string;
  color: string;
  active: boolean;
  onToggle: () => void;
}

interface Props {
  chartType: ChartKind;
  typeLabels: Record<ChartKind, string>;
  onChartType: (next: ChartKind) => void;
  indicators: ChartIndicatorToggle[];
  typeGroupLabel: string;
  indicatorsLabel: string;
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

type Which = 'type' | 'indicators';
const MENU_WIDTH = 236;

export function ChartToolbarMenus({ chartType, typeLabels, onChartType, indicators, typeGroupLabel, indicatorsLabel }: Props) {
  const [open, setOpen] = useState<Which | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const typeBtn = useRef<HTMLButtonElement>(null);
  const indBtn = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const typeMenuId = useId();
  const indMenuId = useId();
  const activeCount = indicators.filter(i => i.active).length;

  const trigger = (which: Which) => (which === 'type' ? typeBtn : indBtn).current;

  const show = (which: Which, withFocus: boolean) => {
    const button = trigger(which);
    if (!button) return;
    const r = button.getBoundingClientRect();
    const rows = which === 'type' ? 3 : indicators.length;
    const height = 44 + rows * 40;
    const left = Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, r.left));
    const below = r.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, r.top - 6 - height);
    focusFirst.current = withFocus;
    setPos({ top, left });
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

  // Keyboard opening lands on the checked item (type) or the first one.
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
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
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); return; }
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') setOpen(null);
  };

  const toggle = (which: Which) => (event: React.MouseEvent<HTMLButtonElement>) => {
    if (open === which) { setOpen(null); return; }
    // A keyboard click (Enter/Space) reports no pointer position.
    show(which, event.detail === 0);
  };

  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      className="chart-menu"
      id={open === 'type' ? typeMenuId : indMenuId}
      role="menu"
      aria-label={open === 'type' ? typeGroupLabel : indicatorsLabel}
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
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
        : indicators.map(item => (
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
        title={indicators.filter(i => i.active).map(i => i.label).join(', ') || indicatorsLabel}
        onClick={toggle('indicators')}
        onKeyDown={onTriggerKey('indicators')}
      >
        {INDICATORS_ICON}
        <span>{indicatorsLabel}</span>
        {activeCount > 0 && <span className="chart-menu-count" aria-label={String(activeCount)}>{activeCount}</span>}
        {CHEVRON}
      </button>
      {menu}
    </div>
  );
}
