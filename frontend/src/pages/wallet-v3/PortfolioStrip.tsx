import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  EyeIcon,
  EyeOffIcon,
  RepeatIcon,
  ScrollTextIcon,
} from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, formatPercent, formatSignedUsd, formatUsd, toneOf } from './format';
import { PERFORMANCE_PERIODS, PerformancePeriod, UnifiedAccount, WalletPerformance } from './useWalletData';

/**
 * THE UNIFIED TRADING ACCOUNT HEADER.
 *
 * Flat and dense, not a boxed hero: the account's identity and margin mode,
 * how much of its equity the open risk is using, the three headline figures,
 * and the actions — all in one band, so the asset table starts inside the
 * first viewport rather than below a screenful of padding.
 *
 * NOTHING HERE IS COMPUTED. Every figure arrives on `account`, which the
 * server produced in one pass — including BOTH margin ratios, so this file
 * never divides one authoritative number by another. A `null` is an UNKNOWN
 * and renders as an em dash; it is never coerced to 0, because a margin
 * requirement of zero and an unanswered one are different facts and only one
 * of them is safe to act on.
 *
 * The full equity curve lives in the P&L section. What stays here is the
 * compact P&L readout with its period tabs — the reading a trader wants
 * beside the balance, not a screen of its own.
 */

const PERIOD_LABEL_KEY: Record<PerformancePeriod, Key> = {
  '7d': 'wallet.period7d',
  '30d': 'wallet.period30d',
  '90d': 'wallet.period90d',
  '1y': 'wallet.period1y',
  all: 'wallet.periodAll',
};

const ACTION_BASE =
  'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-w px-3 text-[12.5px] font-medium leading-5 transition-colors duration-150 ease-exp';
const ACTION_PRIMARY = ACTION_BASE + ' bg-gold font-semibold text-[#26190a] hover:bg-gold-light';
const ACTION_SECONDARY =
  ACTION_BASE + ' border border-hair bg-panel text-ink-2 hover:border-hair-strong hover:bg-panel-2 hover:text-ink';
const ACTION_OFF = ACTION_BASE + ' wallet-action-convert cursor-not-allowed border border-hair bg-panel-2 text-ink-4';

const PERIOD_BASE = 'h-6 rounded-wsm border px-1.5 text-[11.5px] transition-colors duration-150 ease-exp';
const PERIOD_ON = 'border-hair-strong bg-panel-3 font-semibold text-ink';
const PERIOD_IDLE = 'border-transparent font-medium text-ink-3 hover:bg-panel-2 hover:text-ink-2';

/** One headline figure. `value` is already formatted, dash included. */
function Metric({ label, value, hidden, tone }: { label: string; value: string; hidden: boolean; tone?: string }) {
  return (
    <div className="wallet-account-metric min-w-0">
      <p className="text-[12px] leading-4 text-ink-3">{label}</p>
      <p className={`num mt-1 break-words text-[20px] font-semibold leading-7 sm:text-[22px] ${tone ?? 'text-ink'}`}>
        {hidden ? MASK : value}
      </p>
    </div>
  );
}

/**
 * One margin-usage row: the server's ratio as a percentage, its own bar, and
 * the requirement in settle-asset terms. `ratio` is a decimal fraction the
 * server answered; the bar only draws it.
 */
function MarginRow({
  label,
  ratio,
  value,
  hidden,
}: {
  label: string;
  ratio: number | null;
  value: string;
  hidden: boolean;
}) {
  const { lang } = useLanguage();
  // Clamped so a hair-thin ratio is still visible and one above 1 cannot
  // overflow its track. The NUMBER beside it is never clamped.
  const width = ratio === null ? 0 : Math.max(Math.min(ratio, 1) * 100, ratio > 0 ? 2 : 0);
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[22px] shrink-0 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-4">{label}</span>
      <span className="wallet-im-bar w-[84px] shrink-0 sm:w-[110px]" data-tone={ratio !== null && ratio > 0.5 ? 'warn' : 'ok'} aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </span>
      <span className="num w-[52px] shrink-0 text-[11.5px] font-semibold text-pos">
        {ratio === null ? EM_DASH : formatPercent(ratio * 100, lang).replace('+', '')}
      </span>
      <span className="num text-[11.5px] text-ink-3">{hidden ? MASK : value}</span>
    </div>
  );
}

export function PortfolioStrip({
  account,
  performance,
  performanceLoading,
  period,
  onPeriodChange,
  hidden,
  onToggleHidden,
  unavailable,
  onDeposit,
  onWithdraw,
  onTransfer,
  onHistory,
}: {
  account: UnifiedAccount | null;
  performance: WalletPerformance | null;
  performanceLoading: boolean;
  period: PerformancePeriod;
  onPeriodChange: (p: PerformancePeriod) => void;
  hidden: boolean;
  onToggleHidden: () => void;
  unavailable: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onTransfer: () => void;
  onHistory: () => void;
}) {
  const { t, lang } = useLanguage();

  const cross = account?.mode === 'CROSS';
  const usd = (value: number | null | undefined) =>
    unavailable || value === null || value === undefined ? EM_DASH : formatUsd(value, lang);

  /**
   * The three headline figures. A Cross account reports what it holds, what
   * backs its margin after P&L, and that P&L. A plain ledger has no margin
   * balance to report, so it shows its two wallets instead of inventing one.
   */
  const metrics: { label: string; value: string; tone?: string }[] = cross
    ? [
        { label: t('wallet.assetsTotal'), value: usd(account!.collateralUsd) },
        { label: t('wallet.marginBalance'), value: usd(account!.totalEquityUsd) },
        {
          label: t('wallet.unrealizedPnlLabel'),
          value:
            unavailable || account!.unrealizedPnlUsd === null
              ? EM_DASH
              : formatSignedUsd(account!.unrealizedPnlUsd, lang),
          tone: toneOf(account!.unrealizedPnlUsd),
        },
      ]
    : [
        { label: t('wallet.assetsTotal'), value: usd(account?.totalEquityUsd) },
        { label: t('wallet.spot'), value: usd(account?.spotUsd) },
        { label: t('wallet.futures'), value: usd(account?.futuresUsd) },
      ];

  const incomplete = Boolean(account && !account.valuationComplete && account.unpricedAssets.length > 0);

  const selected = performance?.periods?.[period] ?? null;
  const pnlAvailable = Boolean(selected?.available);
  const pnlPercent = selected?.percent ?? null;

  return (
    <section aria-label={t('wallet.unifiedAccount')} className="wallet-account-panel min-w-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-normal text-ink sm:text-[19px]">
              {t('wallet.unifiedAccount')}
            </h2>
            <button
              type="button"
              onClick={onToggleHidden}
              aria-label={hidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
              aria-pressed={hidden}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-w text-ink-3 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink-2"
            >
              {hidden ? <EyeOffIcon className="h-4 w-4" strokeWidth={1.6} /> : <EyeIcon className="h-4 w-4" strokeWidth={1.6} />}
            </button>
            <span className="wallet-account-mode rounded-wsm border border-hair bg-panel-3 px-2 py-[2px] text-[11.5px] font-medium text-ink-2">
              {t(cross ? 'wallet.accountCross' : 'wallet.accountSpot')}
            </span>
          </div>

          {cross && (
            <div className="wallet-margin-usage mt-2.5 flex flex-col gap-1.5" aria-label={t('wallet.marginUsage')}>
              <MarginRow
                label={t('wallet.imShort')}
                ratio={account!.initialMarginRatio}
                value={usd(account!.initialMarginUsd)}
                hidden={hidden}
              />
              <MarginRow
                label={t('wallet.mmShort')}
                ratio={account!.maintenanceMarginRatio}
                value={usd(account!.maintenanceMarginUsd)}
                hidden={hidden}
              />
            </div>
          )}
        </div>

        {/* Horizontal, top-right, in the reference's order. Convert has no
            flow behind it and stays in the row as disabled rather than
            being hidden or wired to something that pretends to work. */}
        <div className="wallet-account-actions flex flex-wrap items-center gap-2 lg:justify-end">
          <button type="button" onClick={onDeposit} className={ACTION_PRIMARY}>
            <ArrowDownToLineIcon className="h-3.5 w-3.5" strokeWidth={2} />
            {t('wallet.deposit')}
          </button>
          <button type="button" disabled aria-disabled="true" title={t('wallet.convertUnavailable')} className={ACTION_OFF}>
            <RepeatIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('wallet.convert')}
          </button>
          <button type="button" onClick={onTransfer} className={ACTION_SECONDARY}>
            <ArrowLeftRightIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('wallet.transfer')}
          </button>
          <button type="button" onClick={onWithdraw} className={ACTION_SECONDARY}>
            <ArrowUpFromLineIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('wallet.withdraw')}
          </button>
          <button type="button" onClick={onHistory} className={`${ACTION_SECONDARY} wallet-action-history`}>
            <ScrollTextIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('wallet.openHistory')}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 border-t border-hair-soft pt-4 xl:flex-row xl:items-start xl:justify-between xl:gap-8">
        <div className="wallet-account-metrics grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-x-10">
          {metrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} hidden={hidden} tone={m.tone} />
          ))}
        </div>

        {/* The compact P&L readout, kept beside the balance. The full curve
            is in the P&L section; this is the glance. */}
        <div className="wallet-pnl-glance min-w-0 shrink-0 rounded-w border border-hair bg-panel-2 px-3 py-2.5 xl:w-[248px]">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[12px] leading-4 text-ink-3">{t('wallet.pnl')}</p>
            <p className={`num text-[12px] font-medium ${toneOf(pnlPercent)}`}>
              {pnlAvailable ? formatPercent(pnlPercent, lang) : EM_DASH}
            </p>
          </div>
          <p className={`num mt-0.5 text-[16px] font-semibold leading-6 ${toneOf(pnlPercent)}`}>
            {hidden ? MASK : performanceLoading ? EM_DASH : pnlAvailable ? formatSignedUsd(selected!.absolutePnl, lang) : EM_DASH}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1" role="group" aria-label={t('wallet.pnlPeriod')}>
            {PERFORMANCE_PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPeriodChange(p)}
                aria-pressed={p === period}
                className={PERIOD_BASE + ' ' + (p === period ? PERIOD_ON : PERIOD_IDLE)}
              >
                {t(PERIOD_LABEL_KEY[p])}
              </button>
            ))}
          </div>
        </div>
      </div>

      {incomplete && (
        // The totals above are a FLOOR while an asset has no quote, in the
        // terminal's own sentence so the same caveat reads the same on both
        // pages.
        <p className="wallet-valuation-note mt-3 rounded-w border border-hair bg-panel-2 px-3 py-2 text-[12px] leading-4 text-ink-3" role="status">
          {t('futures.collateralIncomplete', { assets: account!.unpricedAssets.join(', ') })}
        </p>
      )}
    </section>
  );
}
