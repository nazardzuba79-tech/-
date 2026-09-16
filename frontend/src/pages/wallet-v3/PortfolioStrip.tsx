import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  RepeatIcon,
  ScrollTextIcon,
} from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, btcEquivalentDecimals, formatAmount, formatPercent, formatSignedUsd, formatUsd, toneOf } from './format';
import { PERFORMANCE_PERIODS, PerformancePeriod, UnifiedAccount, WalletPerformance } from './useWalletData';

/**
 * THE UNIFIED TRADING ACCOUNT HEADER.
 *
 * One panel: what the account is worth, what of it is free, what the open
 * risk is doing to it, and the account actions. The total is the page's
 * primary number and stays visually largest; everything beside it is a
 * secondary reading of that same total, deliberately smaller, so a return
 * or a margin figure never out-shouts the balance it was measured on.
 *
 * NOTHING HERE IS COMPUTED. Every figure arrives on `account`, which the
 * server produced in one pass — see `useWalletData`. A `null` is an
 * UNKNOWN and renders as an em dash; it is never coerced to 0, because a
 * margin requirement of zero and an unanswered one are different facts and
 * only one of them is safe to act on.
 */

/** Short period labels; abbreviations differ by language, so they are keys. */
const PERIOD_LABEL_KEY: Record<PerformancePeriod, Key> = {
  '7d': 'wallet.period7d',
  '30d': 'wallet.period30d',
  '90d': 'wallet.period90d',
  '1y': 'wallet.period1y',
  all: 'wallet.periodAll',
};

function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  if (points.length < 2) return null;
  const width = 320;
  const height = 40;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const d = points
    .map((v, i) => `${(i * stepX).toFixed(2)},${(pad + (1 - (v - min) / span) * (height - pad * 2)).toFixed(2)}`)
    .join(' L');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth="1" opacity="0.25" vectorEffect="non-scaling-stroke" />
      <path
        d={`M${d}`}
        fill="none"
        stroke={positive ? 'var(--w-pos)' : 'var(--w-neg)'}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * One account metric. `value` is already formatted — including the dash an
 * unknown renders as — so this component cannot turn an unknown into a
 * number by accident.
 */
function Metric({ label, value, hidden, tone }: { label: string; value: string; hidden: boolean; tone?: string }) {
  return (
    <div className="wallet-account-metric min-w-0">
      <p className="text-[11.5px] font-medium uppercase leading-4 tracking-[0.04em] text-ink-4">{label}</p>
      <p className={`num mt-1 break-words text-[15px] font-semibold leading-5 ${tone ?? 'text-ink'}`}>
        {hidden ? MASK : value}
      </p>
    </div>
  );
}

function Performance({
  performance,
  period,
  onPeriodChange,
  hidden,
  loading,
}: {
  performance: WalletPerformance | null;
  period: PerformancePeriod;
  onPeriodChange: (p: PerformancePeriod) => void;
  hidden: boolean;
  loading: boolean;
}) {
  const { t, lang } = useLanguage();
  const selected = performance?.periods?.[period] ?? null;
  const available = Boolean(selected?.available);
  const percent = selected?.percent ?? null;
  const pnl = selected?.absolutePnl ?? null;
  const positive = (percent ?? 0) >= 0;

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium uppercase leading-4 tracking-[0.04em] text-ink-4">{t('wallet.pnl')}</p>
          <p className={`num mt-1 text-[18px] font-semibold leading-6 ${toneOf(percent)}`}>
            {hidden ? MASK : available ? formatSignedUsd(pnl, lang) : EM_DASH}
          </p>
          <p className={`num text-[12.5px] font-medium leading-5 ${toneOf(percent)}`}>
            {available ? formatPercent(percent, lang) : EM_DASH}
          </p>
        </div>
      </div>
      <div className="h-10 w-full border-b border-hair-soft text-ink-4">
        {loading ? null : available && !hidden ? (
          <Sparkline points={selected!.points.map((pt) => pt.equity)} positive={positive} />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-4">
            {/* Honest: this period has no history behind it yet, so no
                percentage is invented to fill the space. */}
            {hidden ? MASK : t('wallet.notEnoughHistory')}
          </div>
        )}
      </div>
      {/* Its own row rather than sharing the heading's: five labels in seven
          languages never fit beside the figure, and widening this column to
          make them fit would let the return crowd the balance. */}
      <div
        className="mt-2 flex flex-wrap items-center justify-between gap-1"
        role="group"
        aria-label={t('wallet.pnlPeriod')}
      >
        {PERFORMANCE_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPeriodChange(p)}
            aria-pressed={p === period}
            className={`h-7 rounded-wsm border px-1.5 text-[12px] transition-colors duration-150 ease-exp ${
              p === period
                ? 'border-hair-strong bg-panel-3 font-semibold text-ink'
                : 'border-transparent font-medium text-ink-3 hover:bg-panel-2 hover:text-ink-2'
            }`}
          >
            {t(PERIOD_LABEL_KEY[p])}
          </button>
        ))}
      </div>
    </div>
  );
}

const ACTION_BASE =
  'flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-w px-2 py-2 text-[12.5px] font-medium leading-5 transition-colors duration-150 ease-exp sm:min-h-[38px] sm:flex-row sm:gap-1.5 sm:px-3 sm:py-0';
const ACTION_SECONDARY = `${ACTION_BASE} border border-hair bg-panel-2 text-ink-2 hover:border-hair-strong hover:bg-panel-3 hover:text-ink`;

export function PortfolioStrip({
  account,
  performance,
  performanceLoading,
  btcEquivalent,
  hidden,
  onToggleHidden,
  period,
  onPeriodChange,
  unavailable,
  onDeposit,
  onWithdraw,
  onTransfer,
  onHistory,
  onRefresh,
}: {
  account: UnifiedAccount | null;
  performance: WalletPerformance | null;
  performanceLoading: boolean;
  btcEquivalent: number | null;
  hidden: boolean;
  onToggleHidden: () => void;
  period: PerformancePeriod;
  onPeriodChange: (p: PerformancePeriod) => void;
  unavailable: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onTransfer: () => void;
  onHistory: () => void;
  onRefresh: () => void;
}) {
  const { t, lang } = useLanguage();

  const cross = account?.mode === 'CROSS';
  const usd = (value: number | null | undefined) =>
    unavailable || value === null || value === undefined ? EM_DASH : formatUsd(value, lang);

  /**
   * What sits beside the total. A Cross account reports margin; a plain
   * ledger reports its two wallets. Neither is shown for the other kind of
   * account, because the fields it does not have are not zeros.
   */
  const metrics: { label: string; value: string; tone?: string }[] = cross
    ? [
        { label: t('wallet.availableMargin'), value: usd(account!.availableUsd) },
        {
          label: t('wallet.unrealizedPnlLabel'),
          value:
            unavailable || account!.unrealizedPnlUsd === null
              ? EM_DASH
              : formatSignedUsd(account!.unrealizedPnlUsd, lang),
          tone: toneOf(account!.unrealizedPnlUsd),
        },
        { label: t('wallet.initialMargin'), value: usd(account!.initialMarginUsd) },
        { label: t('wallet.maintenanceMargin'), value: usd(account!.maintenanceMarginUsd) },
      ]
    : [
        { label: t('wallet.spot'), value: usd(account?.spotUsd) },
        { label: t('wallet.futures'), value: usd(account?.futuresUsd) },
      ];

  const incomplete = Boolean(account && !account.valuationComplete && account.unpricedAssets.length > 0);

  return (
    <section
      aria-label={t('wallet.unifiedAccount')}
      className="wallet-account-panel relative overflow-hidden rounded-wlg border border-hair bg-panel shadow-panel"
    >
      <span className="absolute left-0 top-0 h-[2px] w-14 bg-gold" aria-hidden="true" />

      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-stretch lg:gap-6 lg:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[12.5px] font-medium leading-5 text-ink-3">{t('wallet.totalEquity')}</h2>
              <span className="wallet-account-mode rounded-wsm border border-hair bg-panel-3 px-2 py-[2px] text-[11px] font-medium text-ink-3">
                {t(cross ? 'wallet.accountCross' : 'wallet.accountSpot')}
              </span>
              <button
                type="button"
                onClick={onToggleHidden}
                aria-label={hidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
                aria-pressed={hidden}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-w text-ink-3 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink-2"
              >
                {hidden ? <EyeOffIcon className="h-4 w-4" strokeWidth={1.6} /> : <EyeIcon className="h-4 w-4" strokeWidth={1.6} />}
              </button>
              <button
                type="button"
                onClick={onRefresh}
                aria-label={t('wallet.refreshAccount')}
                title={t('wallet.refreshAccount')}
                className="wallet-account-refresh flex h-7 w-7 shrink-0 items-center justify-center rounded-w text-ink-4 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink-2"
              >
                <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
            <p className="wallet-total-value num mt-2 min-w-0 break-words text-[30px] font-semibold leading-[1.15] text-ink sm:text-[38px]">
              {hidden ? MASK : usd(account?.totalEquityUsd)}
            </p>
            <p className="num mt-1.5 break-words text-[13px] leading-5 text-ink-3">
              ≈ {hidden ? MASK : btcEquivalent === null ? EM_DASH : `${formatAmount(btcEquivalent, lang, btcEquivalentDecimals(btcEquivalent))} BTC`}
            </p>
          </div>

          <div className="wallet-account-metrics grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 border-t border-hair pt-4 sm:grid-cols-4 sm:gap-x-7">
            {metrics.map((m) => (
              <Metric key={m.label} label={m.label} value={m.value} hidden={hidden} tone={m.tone} />
            ))}
          </div>

          {incomplete && (
            // The total above is a FLOOR while an asset has no quote. Saying
            // so is the difference between an incomplete number and a wrong
            // one — see the collateral model, which refuses to value an
            // unpriced holding at zero for exactly this reason.
            //
            // Deliberately the TERMINAL's sentence, not a second wording of
            // it: the same caveat about the same account should read the
            // same on both pages.
            <p className="wallet-valuation-note rounded-w border border-hair bg-panel-2 px-3 py-2 text-[12px] leading-4 text-ink-3" role="status">
              {t('futures.collateralIncomplete', { assets: account!.unpricedAssets.join(', ') })}
            </p>
          )}
        </div>

        <div className="hidden w-[228px] shrink-0 border-l border-hair pl-6 lg:block xl:w-[248px]">
          <Performance
            performance={performance}
            period={period}
            onPeriodChange={onPeriodChange}
            hidden={hidden}
            loading={performanceLoading}
          />
        </div>

        <div className="min-w-0 border-t border-hair pt-4 lg:w-[188px] lg:shrink-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <button
              type="button"
              onClick={onDeposit}
              className={`${ACTION_BASE} bg-gold font-semibold text-[#26190a] hover:bg-gold-light`}
            >
              <ArrowDownToLineIcon className="h-3.5 w-3.5" strokeWidth={2} />
              {t('wallet.deposit')}
            </button>
            <button type="button" onClick={onWithdraw} className={ACTION_SECONDARY}>
              <ArrowUpFromLineIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('wallet.withdraw')}
            </button>
            <button type="button" onClick={onTransfer} className={ACTION_SECONDARY}>
              <ArrowLeftRightIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('wallet.transfer')}
            </button>
            {/* Convert has no flow behind it on this exchange. It is shown
                disabled and says why, rather than opening something that
                pretends to succeed. */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={t('wallet.convertUnavailable')}
              className={`${ACTION_BASE} wallet-action-convert cursor-not-allowed border border-hair bg-panel-2 text-ink-4`}
            >
              <RepeatIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('wallet.convert')}
            </button>
            <button type="button" onClick={onHistory} className={`${ACTION_SECONDARY} wallet-action-history`}>
              <ScrollTextIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('wallet.openHistory')}
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-hair-soft px-5 py-4 lg:hidden">
        <Performance
          performance={performance}
          period={period}
          onPeriodChange={onPeriodChange}
          hidden={hidden}
          loading={performanceLoading}
        />
      </div>
    </section>
  );
}
