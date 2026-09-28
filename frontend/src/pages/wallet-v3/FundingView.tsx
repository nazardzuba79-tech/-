import { useEffect, useState } from 'react';
import { onSessionChange } from '../../lib/api';
import { ArrowDownToLineIcon, ArrowLeftRightIcon, ArrowUpFromLineIcon, LandmarkIcon, WifiOffIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { useVtaSpotAccount } from '../../lib/useVtaSpotAccount';
import { useLanguage } from '../../lib/i18n';
import { EmptyState } from './ui';
import { EM_DASH, MASK, decimalsFor, formatAmount, formatUsd } from './format';
import { WalletOverview as OverviewData } from './useWalletData';

/** The standard table renders one explicit server account scope at a time.
 * Simulation cash is shared DemoBalance USDT, never merged into real funding
 * balances, real overview totals, or withdrawal/deposit availability. */
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
  const vta = useVtaSpotAccount(true);
  const [scope, setScope] = useState<'real' | 'simulation' | null>(null);
  useEffect(() => {
    const off = onSessionChange(() => setScope(null));
    const changed = (event: StorageEvent) => { if (event.key === 'exchange_token') setScope(null); };
    window.addEventListener('storage', changed);
    return () => { off(); window.removeEventListener('storage', changed); };
  }, []);
  useEffect(() => {
    if (!vta.loading && !vta.failed) setScope(current => current ?? (vta.snapshot?.account.active ? 'simulation' : 'real'));
  }, [vta.snapshot, vta.loading, vta.failed]);
  const simulation = scope === 'simulation';
  const pendingScope = scope === null;
  const viewUnavailable = simulation || pendingScope ? vta.failed || (simulation && !vta.loading && !vta.snapshot) : unavailable;
  const viewLoading = simulation || pendingScope ? vta.loading || pendingScope : loading && !overview;
  const balances = simulation ? vta.snapshot?.balances ?? [] : pendingScope ? [] : overview?.real.spot ?? [];
  const held = balances.filter(b => Number(b.available) + Number(b.locked) > 0);
  const value = simulation ? vta.snapshot?.totalValueUsd : overview?.real.spotValueUsd;
  const totalUsd = viewUnavailable || pendingScope || value == null ? null : Number(value);
  const spotTitle = lang === 'ru' ? 'Спотовый счёт · VTA / USDT' : 'Spot account · VTA / USDT';


  return (
    <div className="wallet-funding min-w-0" data-account-scope={simulation ? vta.snapshot?.account.scope : scope === 'real' ? 'REAL_FUNDING' : 'UNAVAILABLE'}>
      <header className="wallet-funding-head flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{simulation ? spotTitle : t('wallet.navFunding')}</h2>
          <p className="mt-1 text-[13px] text-ink-3">{simulation ? (lang === 'ru' ? 'USDT также учитывается в едином торговом счёте.' : 'USDT is also included in the Unified Trading account.') : t('wallet.fundingSubtitle')}</p>
          {(vta.snapshot?.account.active || simulation) && <select aria-label={lang === 'ru' ? 'Счёт' : 'Account'} className="mt-3 rounded-w border border-hair bg-panel px-3 py-2 text-[13px] text-ink" value={scope ?? 'simulation'} onChange={e => setScope(e.target.value as 'real' | 'simulation')}>
            <option value="simulation">{spotTitle}</option>
            <option value="real">{t('wallet.navFunding')}</option>
          </select>}
          <p className="wallet-funding-total num mt-3 text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink">
            {hidden ? MASK : totalUsd === null ? EM_DASH : formatUsd(totalUsd, lang)}
            <span className="ml-2 text-[13px] font-medium tracking-normal text-ink-3">USD</span>
          </p>
        </div>
        {scope === 'real' && <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
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
        </div>}
      </header>

      <section aria-label={t('wallet.assets')} className="wallet-funding-table wallet-card mt-5 overflow-hidden">
        {viewUnavailable ? (
          <EmptyState icon={WifiOffIcon} title={t('wallet.dataUnavailable')} description={t('wallet.dataUnavailableBody')} compact />
        ) : viewLoading ? (
          <div className="px-5 py-10 text-center text-[13px] leading-5 text-ink-3">{t('wallet.loading')}</div>
        ) : held.length === 0 ? (
          <EmptyState
            icon={LandmarkIcon}
            title={t('wallet.noAssets')}
            description={t('wallet.noAssetsBody')}
            action={scope === 'real' ?
              <button type="button" onClick={onDeposit} className={ACTION_PRIMARY}>
                {t('wallet.deposit')}
              </button> : undefined
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
                  const dp = b.asset === 'VTA' ? 8 : decimalsFor(b.asset);
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
                        {hidden ? MASK : b.valueUsd === null || b.valueUsd === undefined ? EM_DASH : formatUsd(Number(b.valueUsd), lang)}
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
