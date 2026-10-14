import type { ReactNode } from 'react';
import type { Key } from '../../lib/i18n';
import type { WorkspaceLayout } from '../../lib/chartWorkspace';

export interface ChartMultiLayoutProps {
  layout: WorkspaceLayout;
  compact: boolean;
  /** Pane shown on a phone (0 = the main chart). */
  activePane: number;
  onActivePane: (index: number) => void;
  /** Index of the pane shown alone (expanded); null for the grid. */
  expanded: number | null;
  main: ReactNode;
  panes: ReactNode[];
  paneLabels: string[];
  mainPair: string;
  t: (key: Key, params?: Record<string, string | number>) => string;
}

/**
 * One, two or four chart canvases (2026-10-13). The main chart is always the
 * first cell and is never unmounted; the extra panes mount only while they
 * are shown, so a hidden pane neither paints nor refreshes. On a phone the
 * grid becomes one chart with a switcher.
 */
export function ChartMultiLayout({ layout, compact, activePane, onActivePane, expanded, main, panes, paneLabels, mainPair, t }: ChartMultiLayoutProps) {
  if (layout === 1 && expanded === null) return <>{main}</>;
  const count = layout;
  const cells = [main, ...panes.slice(0, count - 1)];
  if (compact) {
    const shown = Math.min(activePane, count - 1);
    return (
      <div className="cw-layout is-compact" data-cw-layout={layout} data-cw-active-pane={shown}>
        <div className="cw-layout-tabs" role="tablist" aria-label={t('chart.ws.layout')}>
          {cells.map((_, i) => (
            <button key={i} type="button" role="tab" aria-selected={shown === i} className={`cw-layout-tab${shown === i ? ' active' : ''}`} data-cw-layout-tab={i} onClick={() => onActivePane(i)}>
              {i === 0 ? mainPair : paneLabels[i - 1] || t('chart.ws.pane.title', { n: i + 1 })}
            </button>
          ))}
        </div>
        <p className="cw-hint cw-layout-note">{t('chart.ws.layout.phone')}</p>
        <div className="cw-layout-cell is-only">{cells[shown]}</div>
        {/* The main chart stays mounted off-screen when another pane is shown, so its drawings, scale and candles survive the switch. */}
        {shown !== 0 && <div className="cw-layout-cell is-parked" aria-hidden="true">{main}</div>}
      </div>
    );
  }
  if (expanded !== null) {
    const shown = Math.min(expanded, count - 1);
    return (
      <div className="cw-layout is-expanded" data-cw-layout={layout} data-cw-expanded={shown}>
        <div className="cw-layout-cell is-only">{cells[shown]}</div>
        {shown !== 0 && <div className="cw-layout-cell is-parked" aria-hidden="true">{main}</div>}
      </div>
    );
  }
  return (
    <div className={`cw-layout is-grid-${count}`} data-cw-layout={layout}>
      {cells.map((cell, i) => <div key={i} className={`cw-layout-cell${i === 0 ? ' is-main' : ''}`} data-cw-layout-cell={i}>{cell}</div>)}
    </div>
  );
}
