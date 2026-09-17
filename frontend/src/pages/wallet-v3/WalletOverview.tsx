import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  LandmarkIcon,
  ScrollTextIcon,
  WalletIcon,
} from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, btcEquivalentDecimals, formatAmount, formatPercent, formatSignedUsd, formatUsd, toneOf } from './format';
import { EquityChart } from './EquityChart';
import { PerformancePeriods } from './PerformancePeriods';
import { PortfolioAllocation } from './PortfolioAllocation';
import { RecentActivity } from './RecentActivity';
import { TierBadge } from './TierBadge';
import { LedgerRow, LoadState, UnifiedAccount, WalletOverview as OverviewData, WalletPerformance } from './useWalletData';

/**
 * THE OVERVIEW — the Wallet's landing section, on the approved design.
 *
 * One page: the account's headline total with its BTC equivalent and tier,
 * the two accounts it is made of, the distribution ring, the equity curve
 * with profit by period, and the last deposits and withdrawals.
 *
 * NOTHING HERE IS A SECOND SET OF BOOKS. The total is `account.totalEquityUsd`
 * — the same figure the Unified Trading section prints; the BTC equivalent
 * is the hook's, divided by the same mark that valued the equity; every
 * period figure is the server's own `periods[p]`; the accounts card reads
 * the ledger subtotals the server answered and never adds them up itself.
 * A `null` anywhere is an unknown and renders as an em dash.
 *
 * THE P&L PILL IS 7D, AND SAYS SO. VOLTEX stores one snapshot per day, so
 * there is no intraday figure to call "today"; the pill is labelled with
 * the window it actually measures.
 *
 * EVERY USER, THE SAME PAGE. An ordinary account gets exactly this layout
 * with its own (possibly empty) figures: no tier badge, dashes where the
 * account has no answer, an empty-state ring and an empty activity list —
 * never sample values.
 */
const ACTION_BASE =
  'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-w px-4 text-[13px] font-semibold leading-5 transition-colors duration-150 ease-exp';
const ACTION_PRIMARY = ACTION_BASE + ' bg-gold text-[#1a1400] hover:bg-gold-light';
const ACTION_SECONDARY = ACTION_BASE + ' border border-hair bg-panel text-ink hover:border-hair-strong hover:bg-panel-2';

const ICON_BUTTON =
  'wallet-account-icon-button flex h-8 w-8 items-center justify-center rounded-w border border-hair bg-panel text-ink transition-colors duration-150 ease-exp hover:bg-panel-3';

function AccountRow({
  icon: Icon,
  name,
  value,
  note,
  hidden,
  children,
}: {
  icon: typeof WalletIcon;
  name: string;
  value: string;
  note?: string;
  hidden: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="wallet-account-row" data-account={name}>
      <div className="wallet-account-row-name flex min-w-0 items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-panel-3 text-ink">
          <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
      </div>
      <div className="wallet-account-row-value min-w-0">
        <p className="num text-[15px] font-semibold leading-5 text-ink">{hidden ? MASK : value}</p>
        {note && <p className="mt-0.5 text-[11px] leading-4 text-ink-4">{note}</p>}
      </div>
      <div className="wallet-account-row-actions flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function WalletOverview({
  account,
  overview,
  rows,
  performance,
  performanceState,
  btcEquivalent,
  hidden,
  onToggleHidden,
  unavailable,
  loading,
  onDeposit,
  onWithdraw,
  onTransfer,
  onHistory,
  onOpenUnified,
  onOpenFunding,
}: {
  account: UnifiedAccount | null;
  overview: OverviewData | null;
  rows: LedgerRow[];
  performance: WalletPerformance | null;
  performanceState: LoadState;
  btcEquivalent: number | null;
  hidden: boolean;
  onToggleHidden: () => void;
  unavailable: boolean;
  loading: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onTransfer: () => void;
  onHistory: () => void;
  onOpenUnified: () => void;
  onOpenFunding: () => void;
}) {
  const { t, lang } = useLanguage();

  const cross = account?.mode === 'CROSS';
  const usd = (value: number | null | undefined) =>
    unavailable || value === null || value === undefined ? EM_DASH : formatUsd(value, lang);

  const total = unavailable ? null : account?.totalEquityUsd ?? null;
  const week = performance?.periods?.['7d'] ?? null;
  const weekOk = Boolean(week?.available) && performanceState !== 'error';

  // The funding account is the spot ledger — where deposits land and
  // withdrawals leave from. On the Cross account that same ledger is the
  // collateral behind Unified Trading, so its value is REPORTED but marked
  // as already counted, and never added to the equity beside it.
  const fundingUsd = overview ? overview.real.spotValueUsd : null;
  const unifiedUsd = cross ? account!.totalEquityUsd : account?.futuresUsd ?? null;

  return (
    <div className="wallet-overview min-w-0">
      <header className="wallet-overview-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-medium text-ink-3">{t('wallet.overviewTitle')}</h2>
            <button
              type="button"
              onClick={onToggleHidden}
              aria-label={hidden ? t('wallet.showBalance') : t('wallet.hideBalance')}
              aria-pressed={hidden}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-w text-ink-3 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink-2"
            >
              {hidden ? <EyeOffIcon className="h-4 w-4" strokeWidth={1.6} /> : <EyeIcon className="h-4 w-4" strokeWidth={1.6} />}
            </button>
          </div>

          <div className="wallet-overview-total mt-3 flex flex-wrap items-end gap-x-2.5 gap-y-2">
            <span className="num text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink sm:text-[34px]">
              {hidden ? MASK : total === null ? EM_DASH : formatUsd(total, lang)}
            </span>
            <span className="pb-[3px] text-[13px] font-medium text-ink-3">USD</span>
            <span className="pb-[1px]">
              <TierBadge mode={account?.mode} />
            </span>
          </div>

          <p className="wallet-overview-btc num mt-2.5 text-[13px] text-ink-3">
            ≈ {hidden ? MASK : btcEquivalent === null ? EM_DASH : formatAmount(btcEquivalent, lang, btcEquivalentDecimals(btcEquivalent))} BTC
          </p>

          <div className="wallet-overview-pnl mt-3.5 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink-3">{t('wallet.pnlSeven')}</span>
            <span className={`wallet-overview-pnl-pill num ${toneOf(weekOk ? week!.percent : null)}`} data-available={weekOk ? 'true' : 'false'}>
              {hidden ? MASK : weekOk ? `${formatSignedUsd(week!.absolutePnl, lang)} · ${formatPercent(week!.percent, lang)}` : EM_DASH}
            </span>
          </div>
        </div>

        <div className="wallet-overview-actions flex flex-wrap items-center gap-2.5 lg:justify-end">
          <button type="button" onClick={onDeposit} className={ACTION_PRIMARY}>
            <ArrowDownToLineIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {t('wallet.deposit')}
          </button>
          <button type="button" onClick={onWithdraw} className={ACTION_SECONDARY}>
            <ArrowUpFromLineIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.withdraw')}
          </button>
          <button type="button" onClick={onTransfer} className={ACTION_SECONDARY}>
            <ArrowLeftRightIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.transfer')}
          </button>
          <button type="button" onClick={onHistory} className={ACTION_SECONDARY}>
            <ScrollTextIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.openHistory')}
          </button>
        </div>

        <span className="wallet-overview-mark" aria-hidden="true">
          V
        </span>
      </header>

      <div className="wallet-overview-body mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-5">
        <div className="flex min-w-0 flex-col gap-4 xl:gap-5">
          <section aria-label={t('wallet.accountsTitle')} className="wallet-accounts-card rounded-wlg border border-hair bg-panel shadow-panel">
            <p className="px-5 pt-4 pb-1 text-[12px] font-medium text-ink-3">{t('wallet.accountsTitle')}</p>
            <AccountRow
              icon={LandmarkIcon}
              name={t('wallet.navFunding')}
              value={usd(fundingUsd)}
              note={cross ? t('wallet.accountCounted') : undefined}
              hidden={hidden}
            >
              <button type="button" onClick={onDeposit} aria-label={t('wallet.deposit')} title={t('wallet.deposit')} className={ICON_BUTTON}>
                <ArrowDownToLineIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" onClick={onWithdraw} aria-label={t('wallet.withdraw')} title={t('wallet.withdraw')} className={ICON_BUTTON}>
                <ArrowUpFromLineIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" onClick={onTransfer} aria-label={t('wallet.transfer')} title={t('wallet.transfer')} className={ICON_BUTTON}>
                <ArrowLeftRightIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" onClick={onOpenFunding} aria-label={t('wallet.openDetails')} title={t('wallet.openDetails')} className={ICON_BUTTON}>
                <ChevronRightIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
            </AccountRow>
            <AccountRow icon={WalletIcon} name={t('wallet.navUnified')} value={usd(unifiedUsd)} hidden={hidden}>
              <button type="button" onClick={onTransfer} aria-label={t('wallet.transfer')} title={t('wallet.transfer')} className={ICON_BUTTON}>
                <ArrowLeftRightIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" onClick={onHistory} aria-label={t('wallet.openHistory')} title={t('wallet.openHistory')} className={ICON_BUTTON}>
                <ScrollTextIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button type="button" onClick={onOpenUnified} aria-label={t('wallet.openDetails')} title={t('wallet.openDetails')} className={ICON_BUTTON}>
                <ChevronRightIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
            </AccountRow>
            {cross && (
              <p className="wallet-accounts-note border-t border-hair-soft px-5 py-3 text-[11.5px] leading-4 text-ink-4" role="note">
                {t('wallet.accountUnifiedPool')}
              </p>
            )}
          </section>

          <PortfolioAllocation
            rows={rows}
            hidden={hidden}
            unavailable={unavailable}
            loading={loading}
            unpricedAssets={account?.unpricedAssets ?? []}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:gap-5">
          <div className="wallet-dynamics min-w-0">
            <EquityChart
              performance={performance}
              loading={performanceState === 'loading'}
              unavailable={performanceState === 'error'}
              hidden={hidden}
            />
            <PerformancePeriods performance={performance} hidden={hidden} />
          </div>

          <RecentActivity hidden={hidden} onAll={onHistory} />
        </div>
      </div>
    </div>
  );
}
