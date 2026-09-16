import { useLanguage } from '../lib/i18n';

/**
 * "Торговля с графика" — the chart's own tool switch.
 *
 * It switches TOOLS, never accounts. The terminal, the account, the
 * balance, the open positions and the history are the same on both sides
 * of it; what changes is whether a bar on the chart can be picked, and
 * whether that pick prices the ordinary order form.
 *
 * Off is the resting state, so an ordinary order is never silently priced
 * from a bar somebody selected minutes ago: the page drops an unsent
 * selection when this goes off (see FuturesPage), and this control owns no
 * account state of its own to lose.
 */
export function ChartTradingToggle({
  enabled, onChange, picking, onPick,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  /** A bar is being chosen right now. */
  picking: boolean;
  onPick: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="chart-trading-toggle">
      <label className="chart-trading-switch">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{t('futures.chartTrading')}</span>
      </label>
      {enabled && (
        <button
          type="button"
          className={`chart-trading-pick ${picking ? 'active' : ''}`}
          aria-pressed={picking}
          onClick={onPick}
        >
          {t(picking ? 'futures.chartTradingPicking' : 'futures.chartTradingPick')}
        </button>
      )}
    </div>
  );
}
