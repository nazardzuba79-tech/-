import { useContext, useState } from 'react';
import { ChartWorkspaceMenu } from './ChartWorkspaceMenu';
import { ToolbarDensity } from './ChartWorkspaceToolbar';
import { ICONS } from './chartWorkspaceIcons';
import { CHART_TIMEFRAMES, DEFAULT_QUICK_TIMEFRAMES, MAX_QUICK_TIMEFRAMES, timeframeGroup, timeframeLabelKey, type ChartTimeframe, type TimeframePlan } from '../../lib/chartTimeframes';
import type { Key } from '../../lib/i18n';

export interface ChartTimeframeStripProps {
  timeframe: ChartTimeframe;
  quick: ChartTimeframe[];
  plans: Record<ChartTimeframe, TimeframePlan>;
  onSelect: (tf: ChartTimeframe) => void;
  onQuickChange: (list: ChartTimeframe[]) => void;
  t: (key: Key, params?: Record<string, string | number>) => string;
  compact: boolean;
  /** Candle selection for a trade is possible on these intervals only. */
  tradable?: readonly string[];
}

const GROUPS = ['minutes', 'hours', 'days', 'months'] as const;
/** Which quick timeframes survive a narrow row, most used first. */
const KEEP_ORDER: readonly ChartTimeframe[] = ['1h', '15m', '1d', '4h', '1m', '5m', '1w', '30m', '2h', '3m', '6h', '12h', '1M'];
const DENSE_LIMIT = [Infinity, 5, 3] as const;

/** The quick timeframes on the row and the «▾» that opens all thirteen with their stars. */
export function ChartTimeframeStrip({ timeframe, quick, plans, onSelect, onQuickChange, t, compact, tradable }: ChartTimeframeStripProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const label = (tf: ChartTimeframe) => t(timeframeLabelKey(tf));
  const hint = (tf: ChartTimeframe): string | null => {
    const plan = plans[tf];
    if (plan.kind === 'unavailable') return t('chart.ws.tf.unavailable');
    if (plan.kind === 'derived') return t('chart.ws.tf.derived', { base: label(plan.base) });
    return null;
  };
  const dense = useContext(ToolbarDensity);
  const limit = DENSE_LIMIT[Math.min(dense, 2)];
  const full = quick.includes(timeframe) ? quick : [...quick, timeframe];
  // A narrow row shows the most used quick timeframes (the current one always); the rest stay one «▾» away.
  const kept = full.length <= limit ? full : [...full].sort((a, b) => (a === timeframe ? -1 : b === timeframe ? 1 : KEEP_ORDER.indexOf(a) - KEEP_ORDER.indexOf(b))).slice(0, limit);
  const shown = CHART_TIMEFRAMES.filter(tf => kept.includes(tf));
  const toggleQuick = (tf: ChartTimeframe) => {
    const next = quick.includes(tf) ? quick.filter(x => x !== tf) : CHART_TIMEFRAMES.filter(x => x === tf || quick.includes(x));
    if (next.length === 0 || next.length > MAX_QUICK_TIMEFRAMES) return;
    onQuickChange(next);
  };
  return (
    <div className="chart-tabs cw-tf-strip" role="group" aria-label={t('chart.group.timeframe')} data-cw-tf-strip>
      {shown.map(tf => {
        const plan = plans[tf];
        const note = hint(tf);
        return (
          <button key={tf} type="button" aria-pressed={timeframe === tf} data-cw-tf={tf} data-cw-tf-plan={plan.kind}
            className={`chart-tab${timeframe === tf ? ' active' : ''}`} title={note ?? undefined} aria-disabled={plan.kind === 'unavailable' || undefined}
            onClick={() => { if (plan.kind !== 'unavailable') onSelect(tf); }}>{label(tf)}</button>
        );
      })}
      <button ref={setAnchor} type="button" className={`chart-tab cw-tf-more${open ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t('chart.ws.tf.menu')} title={t('chart.ws.tf.menu')} data-cw-feature="timeframes"
        onClick={event => { setFromKeyboard(event.detail === 0); setOpen(value => !value); }}>
        <svg className="cw-chev" viewBox="0 0 10 10" aria-hidden="true"><path d="m2.5 3.8 2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <ChartWorkspaceMenu open={open} anchor={anchor} onClose={returnFocus => { setOpen(false); if (returnFocus) anchor?.focus(); }} label={t('chart.ws.tf.menu')} width={300} sheet={compact} testId="timeframes" autoFocus={fromKeyboard}>
        <div className="cw-menu-title" aria-hidden="true">{t('chart.ws.tf.menu')}</div>
        {GROUPS.map(group => (
          <div key={group} className="cw-section" role="group" aria-label={t(`chart.tf.group.${group}` as Key)}>
            <div className="cw-section-title">{t(`chart.tf.group.${group}` as Key)}</div>
            {CHART_TIMEFRAMES.filter(tf => timeframeGroup(tf) === group).map(tf => {
              const plan = plans[tf];
              const note = hint(tf);
              const inQuick = quick.includes(tf);
              return (
                <div key={tf} className={`cw-tf-row${plan.kind === 'unavailable' ? ' is-off' : ''}`}>
                  <button type="button" role="menuitemradio" aria-checked={timeframe === tf} data-cw-tf-option={tf} className="cw-item" disabled={plan.kind === 'unavailable'}
                    onClick={() => { onSelect(tf); setOpen(false); anchor?.focus(); }}>
                    <span className="cw-item-label">{label(tf)}</span>
                    {note && <span className="cw-item-hint">{note}</span>}
                    {tradable && !tradable.includes(tf) && plan.kind !== 'unavailable' && <span className="cw-item-tag" title={t('chart.ws.tf.selectionNote')}>•</span>}
                    <span className="cw-item-tick" aria-hidden="true">{timeframe === tf ? ICONS.check : null}</span>
                  </button>
                  <button type="button" className={`cw-star${inQuick ? ' is-on' : ''}`} aria-pressed={inQuick} data-cw-tf-star={tf}
                    aria-label={`${label(tf)}: ${t(inQuick ? 'chart.ws.tf.unquick' : 'chart.ws.tf.quick')}`} title={t(inQuick ? 'chart.ws.tf.unquick' : 'chart.ws.tf.quick')}
                    disabled={plan.kind === 'unavailable'} onClick={() => toggleQuick(tf)}>
                    {inQuick ? ICONS.starFilled : ICONS.star}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        <div className="cw-actions">
          <span className="cw-hint">{t('chart.ws.tf.max', { n: MAX_QUICK_TIMEFRAMES })}{tradable ? ` · ${t('chart.ws.tf.selectionNote')}` : ''}</span>
          <button type="button" className="cw-button" data-cw-tf-reset onClick={() => onQuickChange([...DEFAULT_QUICK_TIMEFRAMES])}>{t('chart.ws.tf.reset')}</button>
        </div>
      </ChartWorkspaceMenu>
    </div>
  );
}
