import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';

/** Where the menu was asked to appear, in viewport coordinates. */
export interface ChartMenuAnchor { x: number; y: number }

/**
 * The chart's tool menu, opened by a double click ON the chart.
 *
 * This replaces a checkbox that sat above the chart permanently. The switch
 * was needed perhaps once a session and cost a strip of vertical space in
 * every session, on a terminal whose scarcest resource is chart height.
 *
 * It switches TOOLS, never accounts. The terminal, the account, the balance,
 * the open positions and the history are the same on both sides of it; what
 * changes is whether a bar on the chart can be picked, and whether that pick
 * prices the ordinary order form. Opening this menu places no order and
 * picks no bar — `Выбрать вход на графике` is a separate, deliberate press,
 * and even that only arms the existing picker.
 */
export function ChartTradingMenu({
  anchor, enabled, picking, onToggle, onPick, onCancelPicking, onClose,
}: {
  /** Non-null means open. The coordinates are the double click's own. */
  anchor: ChartMenuAnchor | null;
  enabled: boolean;
  /** A bar is being chosen right now. */
  picking: boolean;
  onToggle: (next: boolean) => void;
  onPick: () => void;
  onCancelPicking: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const menu = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  /**
   * Keep the whole menu on screen.
   *
   * Measured after layout rather than guessed from a constant, because the
   * menu's height changes with its own state — the picking row appears and
   * disappears — and a double click near the bottom edge is exactly the
   * case a fixed guess gets wrong.
   */
  useLayoutEffect(() => {
    if (!anchor || !menu.current) { setPlaced(null); return; }
    const box = menu.current.getBoundingClientRect();
    const margin = 8;
    setPlaced({
      left: Math.max(margin, Math.min(anchor.x, window.innerWidth - box.width - margin)),
      top: Math.max(margin, Math.min(anchor.y, window.innerHeight - box.height - margin)),
    });
  }, [anchor, enabled, picking]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const onPointer = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) onClose();
    };
    // Capture, so an outside click closes the menu before the chart's own
    // handlers see it — a click meant to dismiss must not also draw.
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [anchor, onClose]);

  // Focus the menu when it opens, so Esc reaches it and a keyboard user is
  // not left behind a control they cannot see.
  useEffect(() => { if (anchor) menu.current?.focus(); }, [anchor]);

  if (!anchor) return null;

  return (
    <div
      ref={menu}
      className="chart-tools-menu"
      role="menu"
      tabIndex={-1}
      aria-label={t('futures.chartTrading')}
      style={{
        left: placed?.left ?? anchor.x,
        top: placed?.top ?? anchor.y,
        // Hidden for the one frame between mounting and measuring, so the
        // menu never flashes at an off-screen position first.
        visibility: placed ? 'visible' : 'hidden',
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="chart-tools-head">
        <span>{t('futures.chartTools')}</span>
        <button type="button" className="chart-tools-close" aria-label={t('futures.close')} onClick={onClose}>×</button>
      </div>

      <label className="chart-tools-switch" role="menuitemcheckbox" aria-checked={enabled}>
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
        <span>{t('futures.chartTrading')}</span>
      </label>

      {picking ? (
        // The current state, and the way out of it. Arming the picker and
        // then hiding that fact is how a trader ends up wondering why their
        // next click on the chart did something unexpected.
        <>
          <div className="chart-tools-state" role="status">{t('futures.chartTradingPicking')}</div>
          <button type="button" role="menuitem" className="chart-tools-action" onClick={() => { onCancelPicking(); onClose(); }}>
            {t('futures.chartTradingCancel')}
          </button>
        </>
      ) : (
        // Always offered, and it carries the switch with it: a trader who
        // wants to pick an entry should not have to discover that a
        // checkbox above it gates the only action in the menu.
        <button type="button" role="menuitem" className="chart-tools-action primary" onClick={() => {
          if (!enabled) onToggle(true);
          onPick();
          onClose();
        }}>
          {t('futures.chartTradingPick')}
        </button>
      )}
    </div>
  );
}
