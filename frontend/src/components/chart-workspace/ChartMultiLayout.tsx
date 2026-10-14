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
 * first cell of one and the same grid, whatever the layout, the expansion or
 * the phone's active pane (2026-10-14): React keeps the element where it is,
 * so its scale, drawings, selection, indicators and loaded history survive
 * every switch — moving it between a fragment and a grid cell used to remount
 * it. A cell that is not shown is parked off-screen, not removed. The extra
 * panes mount only while their layout shows them; on a phone only the active
 * pane is mounted, so a hidden pane neither paints nor refreshes.
 */
export function ChartMultiLayout({ layout, compact, activePane, onActivePane, expanded, main, panes, paneLabels, mainPair, t }: ChartMultiLayoutProps) {
  const count = layout;
  const list = panes.slice(0, count - 1);
  const compactMode = compact && count > 1;
  const shown = compactMode ? Math.min(activePane, count - 1) : expanded !== null ? Math.min(expanded, count - 1) : null;
  const mainState = shown === null ? '' : shown === 0 ? ' is-only' : ' is-parked';
  return (
    <div className={`cw-layout is-grid-${count}${compactMode ? ' is-compact' : expanded !== null ? ' is-expanded' : ''}`} data-cw-layout={layout}
      data-cw-active-pane={compactMode ? shown ?? undefined : undefined} data-cw-expanded={!compactMode && expanded !== null ? shown ?? undefined : undefined}>
      {compactMode && (
        <>
          <div className="cw-layout-tabs" role="tablist" aria-label={t('chart.ws.layout')}>
            {Array.from({ length: count }, (_, i) => (
              <button key={i} type="button" role="tab" aria-selected={shown === i} className={`cw-layout-tab${shown === i ? ' active' : ''}`} data-cw-layout-tab={i} onClick={() => onActivePane(i)}>
                {i === 0 ? mainPair : paneLabels[i - 1] || t('chart.ws.pane.title', { n: i + 1 })}
              </button>
            ))}
          </div>
          <p className="cw-hint cw-layout-note">{t('chart.ws.layout.phone')}</p>
        </>
      )}
      {/* The main chart: the same cell in every mode; parked off-screen while another pane is shown alone. */}
      <div className={`cw-layout-cell is-main${mainState}`} data-cw-layout-cell={0} aria-hidden={shown !== null && shown !== 0 ? true : undefined}>{main}</div>
      {list.map((cell, i) => {
        const index = i + 1;
        if (compactMode && shown !== index) return null;
        const state = shown === null ? '' : shown === index ? ' is-only' : ' is-hidden';
        return <div key={index} className={`cw-layout-cell${state}`} data-cw-layout-cell={index} aria-hidden={state === ' is-hidden' || undefined}>{cell}</div>;
      })}
    </div>
  );
}
