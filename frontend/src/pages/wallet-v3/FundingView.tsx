import { ArrowDownToLineIcon, ArrowLeftRightIcon, ArrowUpFromLineIcon, LandmarkIcon, WifiOffIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { useLanguage } from '../../lib/i18n';
import { EmptyState } from './ui';
import { EM_DASH, MASK, decimalsFor, formatAmount, formatUsd } from './format';
import { WalletOverview as OverviewData } from './useWalletData';

/**
 * THE FUNDING ACCOUNT — the spot ledger, the account deposits land on and
 * withdrawals leave from.
 *
 * Its rows are `/wallet/overview`'s own valued spot balances: quantity,
 * available, locked and the server's valuation. An asset the server could
 * not price shows its value as a dash, never as $0. It is a separate ledger
 * from the Unified Trading account, so nothing here is counted twice.
 *
 * An empty ledger is an empty table with a deposit action — the design the
 * owner approved, with nothing in it, for every account that has nothing.
 */
const ACTION_BASE =
  'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-w px-4 text-[13px] font-semibold leading-5 transition-colors duration-150 ease-exp';
const ACTION_PRIMARY = ACTION_BASE + ' bg-gold text-[#1a1400] hover:bg-gold-light';
const ACTION_SECONDARY = ACTION_BASE + ' border border-hair bg-panel text-ink hover:border-hair-strong hover:bg-panel-2';

export function FundingView({
  overview,
  hidden,
  unavailable,
  loading,
  onDeposit,
  onWithdraw,
  onTransfer,
}: {
  overview: OverviewData | null;
  hidden: boolean;
  unavailable: boolean;
  loading: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onTransfer: () => void;
}) {
  const { t, lang } = useLanguage();
  const balances = overview?.real.spot ?? [];
  const held = balances.filter((b) => Number(b.available) + Number(b.locked) > 0);
  const totalUsd = unavailable || !overview ? null : overview.real.spotValueUsd;

  return (
    <div className="wallet-funding min-w-0">
      <header className="wallet-funding-head flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{t('wallet.navFunding')}</h2>
          <p className="mt-1 text-[13px] text-ink-3">{t('wallet.fundingSubtitle')}</p>
          <p className="wallet-funding-total num mt-3 text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink">
            {hidden ? MASK : totalUsd === null ? EM_DASH : formatUsd(totalUsd, lang)}
            <span className="ml-2 text-[13px] font-medium tracking-normal text-ink-3">USD</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
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
        </div>
      </header>

      <section aria-label={t('wallet.assets')} className="wallet-funding-table wallet-card mt-5 overflow-hidden">
        {unavailable ? (
          <EmptyState icon={WifiOffIcon} title={t('wallet.dataUnavailable')} description={t('wallet.dataUnavailableBody')} compact />
        ) : loading && !overview ? (
          <div className="px-5 py-10 text-center text-[13px] leading-5 text-ink-3">{t('wallet.loading')}</div>
        ) : held.length === 0 ? (
          <EmptyState
            icon={LandmarkIcon}
            title={t('wallet.noAssets')}
            description={t('wallet.noAssetsBody')}
            action={
              <button type="button" onClick={onDeposit} className={ACTION_PRIMARY}>
                {t('wallet.deposit')}
              </button>
            }
          />
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-hair-soft text-[12px] text-ink-3">
                  <th scope="col" className="px-5 py-3 text-left font-medium">{t('wallet.colAsset')}</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">{t('wallet.colBalance')}</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">{t('wallet.colAvailable')}</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">{t('wallet.colInOrders')}</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">{t('wallet.colValue')}</th>
                </tr>
              </thead>
              <tbody>
                {held.map((b) => {
                  const dp = decimalsFor(b.asset);
                  const available = Number(b.available);
                  const locked = Number(b.locked);
                  return (
                    <tr key={b.asset} className="wallet-funding-row border-b border-hair-soft last:border-b-0" data-asset={b.asset}>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2.5">
                          <CryptoIcon symbol={b.asset} size={26} />
                          <span className="text-[14px] font-semibold text-ink">{b.asset}</span>
                        </span>
                      </td>
                      <td className="num px-3 py-3 text-right font-semibold text-ink">{hidden ? MASK : formatAmount(available + locked, lang, dp)}</td>
                      <td className="num px-3 py-3 text-right text-ink-2">{hidden ? MASK : formatAmount(available, lang, dp)}</td>
                      <td className="num px-3 py-3 text-right text-ink-2">{hidden ? MASK : formatAmount(locked, lang, dp)}</td>
                      <td className="num px-5 py-3 text-right font-semibold text-ink">
                        {hidden ? MASK : b.valueUsd === null || b.valueUsd === undefined ? EM_DASH : formatUsd(b.valueUsd, lang)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
