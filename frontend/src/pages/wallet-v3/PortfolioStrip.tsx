import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  LandmarkIcon,
  RepeatIcon,
  ShieldIcon,
  TrendingUpIcon,
} from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, formatPercent, formatSignedUsd, formatUsd, toneOf } from './format';
import { PerformancePeriod, UnifiedAccount, WalletPerformance } from './useWalletData';

/**
 * THE UNIFIED TRADING ACCOUNT HEADER, on the approved layout.
 *
 * The title row with the margin-mode chip, the IM/MM usage in one line, the
 * actions on the right, and below them one card with the three headline
 * figures: what the account holds (with the 7D P&L beside it), what backs
 * its margin after P&L, and that P&L.
 *
 * NOTHING HERE IS COMPUTED. Every figure arrives on `account`, which the
 * server produced in one pass — including BOTH margin ratios, so this file
 * never divides one authoritative number by another. A `null` is an UNKNOWN
 * and renders as an em dash; it is never coerced to 0, because a margin
 * requirement of zero and an unanswered one are different facts and only one
 * of them is safe to act on.
 *
 * Convert and Borrow are on the row because the approved design has them
 * there, and DISABLED because VOLTEX has no flow behind either yet — a
 * button that pretends to work is worse than one that says it does not.
 */
const ACTION_BASE =
  'wallet-btn flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-w px-4 text-[13px] font-semibold leading-5 transition-colors duration-150 ease-exp';
const ACTION_PRIMARY = ACTION_BASE + ' bg-gold text-[#1a1400] hover:bg-gold-light';
const ACTION_SECONDARY = ACTION_BASE + ' border border-hair bg-panel text-ink hover:border-hair-strong hover:bg-panel-2';
const ACTION_OFF = ACTION_BASE + ' cursor-not-allowed border border-hair bg-panel text-ink-4';

/** One headline figure. `value` is already formatted, dash included. */
function Metric({ label, value, hidden, tone, pill }: { label: string; value: string; hidden: boolean; tone?: string; pill?: React.ReactNode }) {
  return (
    <div className="wallet-account-metric min-w-0">
      <p className="flex flex-wrap items-center gap-2 text-[12px] leading-4 text-ink-3">
        {label}
        {pill}
      </p>
      <p className={`num mt-2 break-words text-[22px] font-bold leading-7 tracking-[-0.02em] ${tone ?? 'text-ink'}`}>
        {hidden ? MASK : value}
        {value !== EM_DASH && !hidden && <span className="ml-1 text-[12px] font-medium tracking-normal text-ink-3">USD</span>}
      </p>
    </div>
  );
}

/**
 * One margin-usage entry: the server's ratio as a percentage, its own bar,
 * and the requirement in settle-asset terms. `ratio` is a decimal fraction
 * the server answered; the bar only draws it.
 */
function MarginRow({ label, ratio, value, hidden }: { label: string; ratio: number | null; value: string; hidden: boolean }) {
  const { lang } = useLanguage();
  // Clamped so a hair-thin ratio is still visible and one above 1 cannot
  // overflow its track. The NUMBER beside it is never clamped.
  const width = ratio === null ? 0 : Math.max(Math.min(ratio, 1) * 100, ratio > 0 ? 2 : 0);
  return (
    <div className="flex items-center gap-2">
      <span className="w-[26px] shrink-0 text-[13px] text-ink-3">{label}</span>
      <span className="wallet-im-bar w-[96px] shrink-0" data-tone={ratio !== null && ratio > 0.5 ? 'warn' : 'ok'} aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </span>
      <span className="num text-[13px] font-semibold text-pos">{ratio === null ? EM_DASH : formatPercent(ratio * 100, lang).replace('+', '')}</span>
      <span className="num text-[13px] text-ink">{hidden ? MASK : value}</span>
    </div>
  );
}

export function PortfolioStrip({
  account,
  performance,
  period,
  hidden,
  onToggleHidden,
  unavailable,
  onDeposit,
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
    unavailable || value === null || value === undefined ? EM_DASH : formatUsd(value, lang).replace('$', '');

  const selected = performance?.periods?.[period] ?? null;
  const pnlOk = Boolean(selected?.available);
  const pill = (
    <span className={`wallet-pill num ${toneOf(pnlOk ? selected!.percent : null)}`} title={pnlOk ? formatSignedUsd(selected!.absolutePnl, lang) : undefined}>
      <TrendingUpIcon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      P&L {hidden ? MASK : pnlOk ? formatPercent(selected!.percent, lang) : EM_DASH}
    </span>
  );

  /**
   * The three headline figures. A Cross account reports what it holds, what
   * backs its margin after P&L, and that P&L. A plain ledger has no margin
   * balance to report, so it shows its two wallets instead of inventing one.
   */
  const metrics: { label: string; value: string; tone?: string; pill?: React.ReactNode }[] = cross
    ? [
        { label: t('wallet.assetsTotal'), value: usd(account!.collateralUsd), pill },
        { label: t('wallet.marginBalance'), value: usd(account!.totalEquityUsd) },
        {
          label: t('wallet.unrealizedPnlLong'),
          value: unavailable || account!.unrealizedPnlUsd === null ? EM_DASH : formatSignedUsd(account!.unrealizedPnlUsd, lang).replace('$', ''),
          tone: toneOf(account!.unrealizedPnlUsd),
        },
      ]
    : [
        { label: t('wallet.assetsTotal'), value: usd(account?.totalEquityUsd), pill },
        { label: t('wallet.spot'), value: usd(account?.spotUsd) },
        { label: t('wallet.futures'), value: usd(account?.futuresUsd) },
      ];

  const incomplete = Boolean(account && !account.valuationComplete && account.unpricedAssets.length > 0);

  return (
    <section aria-label={t('wallet.unifiedAccount')} className="wallet-account-panel min-w-0">
      <div className="wallet-page-head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[24px] font-bold tracking-[-0.02em] text-ink">{t('wallet.unifiedAccount')}</h2>
            <button
              type="button"
              onClick={onToggleHidden}
              aria-label={hidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
              aria-pressed={hidden}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-w text-ink-3 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink-2"
            >
              {hidden ? <EyeOffIcon className="h-4 w-4" strokeWidth={1.6} /> : <EyeIcon className="h-4 w-4" strokeWidth={1.6} />}
            </button>
            <span className="wallet-account-mode wallet-chip">
              <ShieldIcon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {t(cross ? 'wallet.accountCross' : 'wallet.accountSpot')}
            </span>
          </div>

          {cross && (
            <div className="wallet-margin-usage mt-3 flex flex-wrap gap-x-6 gap-y-2" aria-label={t('wallet.marginUsage')}>
              <MarginRow label={t('wallet.imShort')} ratio={account!.initialMarginRatio} value={`${usd(account!.initialMarginUsd)} USD`} hidden={hidden} />
              <MarginRow label={t('wallet.mmShort')} ratio={account!.maintenanceMarginRatio} value={`${usd(account!.maintenanceMarginUsd)} USD`} hidden={hidden} />
            </div>
          )}
        </div>

        <div className="wallet-account-actions flex flex-wrap items-center gap-2.5 lg:justify-end">
          <button type="button" onClick={onDeposit} className={ACTION_PRIMARY}>
            <ArrowDownToLineIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {t('wallet.depositShort')}
          </button>
          <button type="button" disabled aria-disabled="true" title={t('wallet.convertUnavailable')} className={`${ACTION_OFF} wallet-action-convert`}>
            <RepeatIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.convert')}
          </button>
          <button type="button" onClick={onTransfer} className={ACTION_SECONDARY}>
            <ArrowLeftRightIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.transfer')}
          </button>
          <button type="button" disabled aria-disabled="true" title={t('wallet.borrowUnavailable')} className={`${ACTION_OFF} wallet-action-borrow`}>
            <LandmarkIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.borrow')}
          </button>
          <button type="button" onClick={onHistory} className={`${ACTION_SECONDARY} wallet-action-history`}>
            <HistoryIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.tab.history')}
            <ChevronDownIcon className="h-3.5 w-3.5 text-ink-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="wallet-summary wallet-card">
        <div className="wallet-account-metrics">
          {metrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} hidden={hidden} tone={m.tone} pill={m.pill} />
          ))}
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
