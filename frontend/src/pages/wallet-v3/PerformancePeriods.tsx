import { Key, useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, formatPercent, formatSignedUsd, toneOf } from './format';
import { PERFORMANCE_PERIODS, PerformancePeriod, WalletPerformance } from './useWalletData';

/**
 * Profit by period, as rows under the equity curve: 7D, 30D, 90D, 1Y and all
 * time, each with its absolute P&L in USD and its percentage.
 *
 * Every figure is the server's own `periods[p]` answer — the same object the
 * curve is drawn from, so a row can never disagree with the chart above it.
 * A period the account's history does not reach back far enough to answer
 * is `available: false` and renders as a dash on both columns: a 12-day
 * return in the 30D row would be a different number wearing the wrong label.
 */
const PERIOD_LABEL_KEY: Record<PerformancePeriod, Key> = {
  '7d': 'wallet.period7d',
  '30d': 'wallet.period30d',
  '90d': 'wallet.period90d',
  '1y': 'wallet.period1y',
  all: 'wallet.periodAll',
};

export function PerformancePeriods({
  performance,
  hidden,
}: {
  performance: WalletPerformance | null;
  hidden: boolean;
}) {
  const { t, lang } = useLanguage();
  return (
    <div className="wallet-period-rows" role="group" aria-label={t('wallet.periodsTitle')}>
      <p className="wallet-period-rows-title text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4">
        {t('wallet.periodsTitle')}
      </p>
      {PERFORMANCE_PERIODS.map((p) => {
        const period = performance?.periods?.[p] ?? null;
        const ok = Boolean(period?.available);
        const percent = ok ? period!.percent : null;
        const range =
          ok && period!.startDate && period!.endDate ? `${period!.startDate} — ${period!.endDate}` : null;
        return (
          <div key={p} className="wallet-period-row" data-period={p} data-available={ok ? 'true' : 'false'}>
            <span className="wallet-period-row-label">
              <span className="text-[12px] font-semibold text-ink-2">{t(PERIOD_LABEL_KEY[p])}</span>
              {range && <span className="num block text-[11px] leading-4 text-ink-4">{range}</span>}
            </span>
            <span className={`wallet-period-row-usd num text-[13px] font-semibold ${toneOf(percent)}`}>
              {hidden ? MASK : ok ? formatSignedUsd(period!.absolutePnl, lang) : EM_DASH}
            </span>
            <span className={`wallet-period-row-pct num text-[12px] font-semibold ${toneOf(percent)}`}>
              {hidden ? MASK : ok ? formatPercent(percent, lang) : EM_DASH}
            </span>
          </div>
        );
      })}
    </div>
  );
}
