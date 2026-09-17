import { useMemo, useState } from 'react';
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUpFromLineIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  RepeatIcon,
  WalletIcon,
} from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { useLanguage } from '../../lib/i18n';
import { EM_DASH, MASK, decimalsFor, formatAmount, formatPercent, formatSignedUsd, formatUsd, toneOf } from './format';
import { AllocationCard } from './AllocationCard';
import { DynamicsCard } from './DynamicsCard';
import { RecentActivity } from './RecentActivity';
import { TierBadge } from './TierBadge';
import { LedgerRow, LoadState, UnifiedAccount, WalletOverview as OverviewData, WalletPerformance } from './useWalletData';

/**
 * THE OVERVIEW — the Wallet's landing section, on the approved design.
 *
 * TWO ACCOUNTS, TWO LEDGERS. `Финансирование` is the real spot ledger the
 * deposits land on (`/wallet/overview`). `Unified Trading` is the margin
 * account (`/private-trading/native/wallet`) for the owner, or the futures
 * ledger for everyone else. They are separate ledgers, so the Overview's
 * headline is their sum — the one place the two are added, and the only
 * arithmetic on this page. Each account row shows the server's own figure.
 *
 * THE BTC EQUIVALENT uses the same mark the hook divided the account's
 * equity by (`totalEquityUsd / btcEquivalent`), so the Overview and the
 * Unified section cannot disagree on a BTC figure.
 *
 * THE P&L PILL IS 7D, AND SAYS SO. VOLTEX stores one snapshot per day; there
 * is no intraday figure to call "today".
 *
 * EVERY USER, THE SAME PAGE. An ordinary account gets exactly this layout
 * with its own figures: no tier badge, dashes where the account has no
 * answer, an empty ring and an empty activity list — never sample values.
 */
const ACTION_BASE =
  'wallet-btn flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-w px-4 text-[13px] font-semibold leading-5 transition-colors duration-150 ease-exp';
const ACTION_PRIMARY = ACTION_BASE + ' bg-gold text-[#1a1400] hover:bg-gold-light';
const ACTION_SECONDARY = ACTION_BASE + ' border border-hair bg-panel text-ink hover:border-hair-strong hover:bg-panel-2';
const ACTION_OFF = ACTION_BASE + ' wallet-action-convert cursor-not-allowed border border-hair bg-panel text-ink-4';
const ICON_BUTTON = 'wallet-account-icon-button';

type Tab = 'account' | 'asset';

function AccountRow({
  icon: Icon,
  name,
  usd,
  btc,
  hidden,
  children,
}: {
  icon: typeof WalletIcon;
  name: string;
  usd: string;
  btc: string;
  hidden: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="wallet-account-row" data-account={name}>
      <div className="wallet-account-row-name">
        <span className="wallet-account-ico">
          <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
      </div>
      <div className="wallet-account-row-value min-w-0">
        <p className="num text-[15px] font-semibold leading-5 text-ink">{hidden ? MASK : usd}</p>
        <p className="num mt-0.5 text-[11px] leading-4 text-ink-4">≈ {hidden ? MASK : btc} BTC</p>
      </div>
      <div className="wallet-account-row-actions">{children}</div>
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
  onOpenPnl,
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
  onOpenPnl: () => void;
}) {
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<Tab>('account');

  const cross = account?.mode === 'CROSS';
  const known = (v: number | null | undefined): number | null => (unavailable || v === null || v === undefined ? null : v);

  // The two accounts, as the server answered them.
  const fundingUsd = known(cross ? overview?.real.spotValueUsd : account?.spotUsd);
  const unifiedUsd = known(cross ? account!.totalEquityUsd : account?.futuresUsd);
  // The headline: the sum of the accounts, when at least one is known. On
  // a plain ledger this is exactly the server's own total.
  const total = cross
    ? fundingUsd === null && unifiedUsd === null
      ? null
      : (fundingUsd ?? 0) + (unifiedUsd ?? 0)
    : known(account?.totalEquityUsd);

  // One BTC mark for the whole page: the one the hook used for the
  // account's equity, or the spot feed's when the account has no equity.
  const btcPrice =
    account?.totalEquityUsd && btcEquivalent && account.totalEquityUsd > 0 && btcEquivalent > 0
      ? account.totalEquityUsd / btcEquivalent
      : overview?.btcPriceUsd && overview.btcPriceUsd > 0
        ? overview.btcPriceUsd
        : null;
  const btc = (usd: number | null) => (usd === null || btcPrice === null ? EM_DASH : formatAmount(usd / btcPrice, lang, 8));
  const usd = (v: number | null) => (v === null ? EM_DASH : formatUsd(v, lang));

  const week = performance?.periods?.['7d'] ?? null;
  const weekOk = Boolean(week?.available) && performanceState !== 'error';

  /** Every held asset across both accounts, tagged with the account it sits in. */
  const assets = useMemo(() => {
    const list: { symbol: string; account: string; quantity: number; valueUsd: number | null; priced: boolean }[] = [];
    for (const r of rows) if (r.total > 0) list.push({ symbol: r.symbol, account: t('wallet.navUnified'), quantity: r.total, valueUsd: r.valueUsd, priced: r.priced });
    if (cross && overview) {
      for (const b of overview.real.spot) {
        const q = Number(b.available) + Number(b.locked);
        if (q > 0) list.push({ symbol: b.asset, account: t('wallet.navFunding'), quantity: q, valueUsd: b.valueUsd, priced: b.valueUsd !== null });
      }
    }
    return list.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  }, [rows, overview, cross, t]);

  const holdings = useMemo(() => {
    const bySymbol = new Map<string, number>();
    for (const a of assets) if (a.valueUsd !== null && a.valueUsd > 0) bySymbol.set(a.symbol, (bySymbol.get(a.symbol) ?? 0) + a.valueUsd);
    return [...bySymbol].map(([symbol, valueUsd]) => ({ symbol, valueUsd }));
  }, [assets]);
  const unpriced = useMemo(() => {
    const names = new Set<string>(account?.unpricedAssets ?? []);
    for (const a of assets) if (!a.priced) names.add(a.symbol);
    return [...names];
  }, [assets, account]);

  const footer = `${t('wallet.navUnified')} ${unifiedUsd === null ? EM_DASH : formatUsd(unifiedUsd, lang).replace('$', '')} · ${t('wallet.navFunding')} ${fundingUsd === null ? EM_DASH : formatUsd(fundingUsd, lang).replace('$', '')} USD`;

  return (
    <div className="wallet-overview min-w-0">
      <header className="wallet-overview-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[17px] font-medium text-ink-3">{t('wallet.overviewTitle')}</h2>
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

          <div className="wallet-overview-total">
            <span className="num wallet-overview-amount">{hidden ? MASK : total === null ? EM_DASH : formatUsd(total, lang).replace('$', '')}</span>
            <span className="wallet-overview-unit">USD</span>
            <TierBadge mode={account?.mode} />
          </div>

          <p className="wallet-overview-btc num">≈ {hidden ? MASK : total === null ? EM_DASH : btc(total)} BTC</p>

          <button type="button" onClick={onOpenPnl} className="wallet-overview-pnl">
            <span className="text-ink-3">{t('wallet.pnlSeven')}</span>
            <span className={`wallet-pill num ${toneOf(weekOk ? week!.percent : null)}`} data-available={weekOk ? 'true' : 'false'}>
              {hidden ? MASK : weekOk ? `${formatSignedUsd(week!.absolutePnl, lang)} · ${formatPercent(week!.percent, lang)}` : EM_DASH}
            </span>
            <ArrowRightIcon className="h-3.5 w-3.5 text-ink-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <div className="wallet-overview-actions">
          <button type="button" onClick={onDeposit} className={ACTION_PRIMARY}>
            <ArrowDownToLineIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {t('wallet.depositShort')}
          </button>
          <button type="button" onClick={onWithdraw} className={ACTION_SECONDARY}>
            <ArrowUpFromLineIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.withdraw')}
          </button>
          <button type="button" onClick={onTransfer} className={ACTION_SECONDARY}>
            <ArrowLeftRightIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.transfer')}
          </button>
          <button type="button" disabled aria-disabled="true" title={t('wallet.convertUnavailable')} className={ACTION_OFF}>
            <RepeatIcon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t('wallet.convert')}
          </button>
        </div>

        <span className="wallet-overview-mark" aria-hidden="true">
          V
        </span>
      </header>

      <div className="wallet-overview-body">
        <div className="wallet-overview-col">
          <section aria-label={t('wallet.accountsTitle')} className="wallet-accounts-card wallet-card">
            <div className="wallet-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'account'} onClick={() => setTab('account')}>
                {t('wallet.tabAccount')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'asset'} onClick={() => setTab('asset')}>
                {t('wallet.tabAsset')}
              </button>
            </div>

            {tab === 'account' ? (
              <>
                <p className="wallet-accounts-label">{t('wallet.assets')}</p>
                <AccountRow icon={CircleDollarSignIcon} name={t('wallet.navFunding')} usd={usd(fundingUsd)} btc={btc(fundingUsd)} hidden={hidden}>
                  <button type="button" onClick={onDeposit} aria-label={t('wallet.depositShort')} title={t('wallet.depositShort')} className={ICON_BUTTON}>
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
                <AccountRow icon={WalletIcon} name={t('wallet.navUnified')} usd={usd(unifiedUsd)} btc={btc(unifiedUsd)} hidden={hidden}>
                  <button type="button" onClick={onDeposit} aria-label={t('wallet.depositShort')} title={t('wallet.depositShort')} className={ICON_BUTTON}>
                    <ArrowDownToLineIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={onTransfer} aria-label={t('wallet.transfer')} title={t('wallet.transfer')} className={ICON_BUTTON}>
                    <ArrowLeftRightIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={onHistory} aria-label={t('wallet.openHistory')} title={t('wallet.openHistory')} className={ICON_BUTTON}>
                    <HistoryIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={onOpenUnified} aria-label={t('wallet.openDetails')} title={t('wallet.openDetails')} className={ICON_BUTTON}>
                    <ChevronRightIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </AccountRow>
              </>
            ) : (
              <ul className="wallet-asset-tab">
                {assets.length === 0 && <li className="px-5 py-8 text-center text-[13px] text-ink-4">{loading ? t('wallet.loading') : t('wallet.noAssets')}</li>}
                {assets.map((a) => (
                  <li key={a.account + a.symbol} className="wallet-asset-tab-row" data-symbol={a.symbol}>
                    <CryptoIcon symbol={a.symbol} size={30} />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold text-ink">{a.symbol}</span>
                      <span className="block truncate text-[11px] leading-4 text-ink-4">{a.account}</span>
                    </span>
                    <span className="text-right">
                      <span className="num block text-[14px] font-semibold text-ink">{hidden ? MASK : formatAmount(a.quantity, lang, decimalsFor(a.symbol))}</span>
                      <span className="num block text-[11px] leading-4 text-ink-4">
                        {hidden ? MASK : a.valueUsd === null ? t('wallet.noQuote') : `≈ ${formatUsd(a.valueUsd, lang).replace('$', '')} USD`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AllocationCard
            holdings={holdings}
            accounts={[
              { label: t('wallet.navUnified'), valueUsd: unifiedUsd },
              { label: t('wallet.navFunding'), valueUsd: fundingUsd },
            ]}
            hidden={hidden}
            unavailable={unavailable}
            loading={loading}
            unpricedAssets={unpriced}
            footer={footer}
          />
        </div>

        <div className="wallet-overview-col">
          <DynamicsCard performance={performance} loading={performanceState === 'loading'} unavailable={performanceState === 'error'} hidden={hidden} />
          <RecentActivity hidden={hidden} onAll={onHistory} />
        </div>
      </div>
    </div>
  );
}
