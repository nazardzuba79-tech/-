import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  EyeIcon,
  EyeOffIcon,
} from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, btcEquivalentDecimals, formatAmount, formatPercent, formatSignedUsd, formatUsd, toneOf } from './format';
import { PERFORMANCE_PERIODS, PerformancePeriod, WalletOverview, WalletPerformance } from './useWalletData';

/**
 * The single integrated portfolio panel: total value, the Spot/Futures
 * split, performance, and the three account actions — one white surface
 * rather than four separate dashboard cards.
 *
 * The total is the page's primary number and stays visually largest; the
 * PnL block sits beside it at a smaller weight, deliberately, so a return
 * never out-shouts the balance it was earned on.
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
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#edeff3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path
        d={`M${d}`}
        fill="none"
        stroke={positive ? '#12a177' : '#d94a56'}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function AccountBalance({ label, value, hidden }: { label: string; value: string; hidden: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-ink-3">{label}</p>
      <p className="num mt-1.5 text-[17px] font-semibold tracking-[-0.015em] text-ink">{hidden ? MASK : value}</p>
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
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-ink-3">{t('wallet.pnl')}</p>
          <p className={`num mt-1 text-[15px] font-semibold tracking-[-0.015em] ${toneOf(percent)}`}>
            {hidden ? MASK : available ? formatSignedUsd(pnl, lang) : EM_DASH}
          </p>
          <p className={`num text-[12px] font-medium ${toneOf(percent)}`}>
            {available ? formatPercent(percent, lang) : EM_DASH}
          </p>
        </div>
      </div>
      <div className="h-10 w-full border-b border-hair-soft">
        {loading ? null : available && !hidden ? (
          <Sparkline points={selected!.points.map((pt) => pt.equity)} positive={positive} />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-ink-4">
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
        className="mt-2 flex items-center justify-between gap-0.5"
        role="group"
        aria-label={t('wallet.pnlPeriod')}
      >
        {PERFORMANCE_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPeriodChange(p)}
            aria-pressed={p === period}
            className={`h-6 rounded-wsm border px-1.5 text-[11px] transition-colors duration-150 ease-exp ${
              p === period
                ? 'border-hair-strong bg-panel-3 font-semibold text-ink'
                : 'border-transparent font-medium text-ink-4 hover:bg-panel-2 hover:text-ink-3'
            }`}
          >
            {t(PERIOD_LABEL_KEY[p])}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PortfolioStrip({
  overview,
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
}: {
  overview: WalletOverview | null;
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
}) {
  const { t, lang } = useLanguage();

  // What the page shows as the portfolio. For an ordinary account this is
  // the real ledger; the Spot/Futures split below is always the real ledger,
  // because that is what those two wallets actually hold.
  const totalUsd = overview?.displayTotalUsd ?? null;
  const spotUsd = overview?.real.spotValueUsd ?? null;
  const futuresUsd = overview?.real.futuresValueUsd ?? null;

  return (
    <section
      aria-label={t('wallet.portfolio')}
      className="relative overflow-hidden rounded-wlg border border-hair bg-panel shadow-panel"
    >
      <span className="absolute left-0 top-0 h-[2px] w-14 bg-gold" aria-hidden="true" />

      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:gap-7 lg:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-5 xl:flex-row xl:items-end xl:gap-7">
          <div className="min-w-0">
            <h2 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-3">{t('wallet.totalBalance')}</h2>
            <div className="mt-2 flex items-center gap-2.5">
              <p className="num break-all text-[26px] font-semibold leading-none tracking-[-0.028em] text-ink sm:text-[30px]">
                {hidden ? MASK : unavailable ? EM_DASH : formatUsd(totalUsd, lang)}
              </p>
              <button
                type="button"
                onClick={onToggleHidden}
                aria-label={hidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
                aria-pressed={hidden}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-w text-ink-4 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink-2"
              >
                {hidden ? <EyeOffIcon className="h-4 w-4" strokeWidth={1.6} /> : <EyeIcon className="h-4 w-4" strokeWidth={1.6} />}
              </button>
            </div>
            <p className="num mt-2 text-[12.5px] text-ink-3">
              ≈ {hidden ? MASK : btcEquivalent === null ? EM_DASH : `${formatAmount(btcEquivalent, lang, btcEquivalentDecimals(btcEquivalent))} BTC`}
            </p>
          </div>

          <div className="flex gap-7 border-t border-hair pt-4 sm:gap-9 xl:border-l xl:border-t-0 xl:pb-1 xl:pl-7 xl:pt-0">
            <AccountBalance label={t('wallet.spot')} value={unavailable ? EM_DASH : formatUsd(spotUsd, lang)} hidden={hidden} />
            <span className="w-px self-stretch bg-hair" aria-hidden="true" />
            <AccountBalance
              label={t('wallet.futures')}
              value={unavailable ? EM_DASH : formatUsd(futuresUsd, lang)}
              hidden={hidden}
            />
          </div>
        </div>

        <div className="hidden w-[236px] shrink-0 border-l border-hair pl-7 lg:block xl:w-[268px]">
          <Performance
            performance={performance}
            period={period}
            onPeriodChange={onPeriodChange}
            hidden={hidden}
            loading={performanceLoading}
          />
        </div>

        <div className="border-t border-hair pt-4 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
            <button
              type="button"
              onClick={onDeposit}
              className="flex h-9 items-center justify-center gap-1.5 rounded-w bg-gold px-3.5 text-[12.5px] font-semibold text-[#26190a] transition-colors duration-150 ease-exp hover:bg-gold-light"
            >
              <ArrowDownToLineIcon className="h-3.5 w-3.5" strokeWidth={2} />
              {t('wallet.deposit')}
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              className="flex h-9 items-center justify-center gap-1.5 rounded-w border border-hair bg-panel px-3.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-150 ease-exp hover:border-hair-strong hover:bg-panel-2 hover:text-ink"
            >
              <ArrowUpFromLineIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('wallet.withdraw')}
            </button>
            <button
              type="button"
              onClick={onTransfer}
              className="flex h-9 items-center justify-center gap-1.5 rounded-w border border-hair bg-panel px-3.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-150 ease-exp hover:border-hair-strong hover:bg-panel-2 hover:text-ink"
            >
              <ArrowLeftRightIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('wallet.transfer')}
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
