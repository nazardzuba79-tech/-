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
import { useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, btcEquivalentDecimals, formatAmount, formatSignedUsd, formatUsd, toneOf } from './format';
import { UnifiedAccount } from './useWalletData';

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
 *
 * The equity curve is NOT here. It used to be a 40px sparkline wedged into
 * a side column, which is no place for the account's history; it now has
 * its own card directly below — see `EquityChart`.
 */

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

const ACTION_BASE =
  'flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-w px-2 py-2 text-[12.5px] font-medium leading-5 transition-colors duration-150 ease-exp sm:min-h-[38px] sm:flex-row sm:gap-1.5 sm:px-3 sm:py-0';
const ACTION_SECONDARY = `${ACTION_BASE} border border-hair bg-panel-2 text-ink-2 hover:border-hair-strong hover:bg-panel-3 hover:text-ink`;

export function PortfolioStrip({
  account,
  btcEquivalent,
  hidden,
  onToggleHidden,
  unavailable,
  onDeposit,
  onWithdraw,
  onTransfer,
  onHistory,
  onRefresh,
}: {
  account: UnifiedAccount | null;
  btcEquivalent: number | null;
  hidden: boolean;
  onToggleHidden: () => void;
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
    </section>
  );
}
