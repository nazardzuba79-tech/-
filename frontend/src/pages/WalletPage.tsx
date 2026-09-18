import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { useLanguage } from '../lib/i18n';
import { PortfolioStrip } from './wallet-v3/PortfolioStrip';
import { EquityChart } from './wallet-v3/EquityChart';
import { WalletSection, WalletSideNav } from './wallet-v3/WalletSideNav';
import { AssetLedger } from './wallet-v3/AssetLedger';
import { TransactionHistory } from './wallet-v3/TransactionHistory';
import { DepositModal } from './wallet-v3/DepositModal';
import { WithdrawModal } from './wallet-v3/WithdrawModal';
import { TransferModal } from './wallet-v3/TransferModal';
import { WalletOverview } from './wallet-v3/WalletOverview';
import { FundingView } from './wallet-v3/FundingView';
import { PerformancePeriod, useWalletData } from './wallet-v3/useWalletData';
import { useWalletTheme } from './wallet-v3/useWalletTheme';
import './wallet-v3/wallet.css';

const HIDE_BALANCE_KEY = 'exchange_hide_balance';

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function saveFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // best-effort — the toggle just won't persist across reloads
  }
}

type ActiveModal = 'deposit' | 'withdraw' | 'transfer' | null;

/**
 * The Wallet workspace.
 *
 * A light financial workspace under the app's dark global header, with its
 * OWN navigation beside the content — the account's sections, inside the
 * Wallet, not a second copy of the global one. The palette lives entirely
 * in wallet-v3/wallet.css, scoped so it cannot leak into Trade, Futures or
 * Admin.
 *
 * It opens on the Overview (`Обзор`): the headline total, the two accounts,
 * the distribution ring, the equity curve with profit by period and the
 * last deposits and withdrawals — the approved design, the same for every
 * account, with each account's own figures in it and nothing in it for an
 * account that has nothing. `Финансирование` is the spot ledger, `Unified
 * Trading` the margin account below.
 *
 * The main section is dense on purpose: identity, margin usage, the three
 * headline figures, the actions, the filters and the first asset rows all
 * belong in the first viewport. The equity curve is a section of its own
 * (`Анализ P&L`) rather than a screenful between the summary and the table.
 *
 * ONE SET OF BOOKS. The header's equity, available margin and margin
 * requirements come from whichever source is authoritative for THIS
 * account: the native Cross account model for the owner's margin account —
 * the same object /futures prints — and /wallet/overview's valued ledger
 * for everyone else. The page adds nothing to either. That is why there is
 * no separate futures card below any more: a second panel of the same
 * figures is a second chance to disagree with them.
 *
 * Everything shown is real: balances and valuations from the server,
 * performance from the account's own stored daily series, activity from its
 * own deposits, withdrawals and fills. An asset that could not be priced is
 * reported as unknown and named, never valued at zero.
 */
export function WalletPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const [modal, setModal] = useState<ActiveModal>(() => {
    const action = searchParams.get('action');
    return action === 'deposit' || action === 'withdraw' || action === 'transfer' ? action : null;
  });
  const [hidden, setHidden] = useState(() => loadFlag(HIDE_BALANCE_KEY));
  const [section, setSection] = useState<WalletSection>('overview');
  const [period, setPeriod] = useState<PerformancePeriod>('7d');
  const { theme, toggleTheme } = useWalletTheme();
  const historyRef = useRef<HTMLDivElement>(null);

  const {
    overview,
    overviewState,
    performance,
    performanceState,
    account,
    accountResolved,
    rows,
    btcEquivalent,
    setCollateral,
    refresh,
  } = useWalletData();

  // Deep links from elsewhere in the app (Futures' transfer action, the
  // header's Пополнить) keep working across a query-string-only navigation,
  // which does not remount this page.
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'deposit' || action === 'withdraw' || action === 'transfer') setModal(action);
  }, [searchParams]);

  // An error is only an error once the ordinary ledger failed AND no margin
  // account answered: the owner's figures do not come from /wallet/overview,
  // so a failure there must not blank a page that has authoritative numbers.
  const unavailable = overviewState === 'error' && account === null;
  const loading = !accountResolved || (account === null && overviewState === 'loading');

  function toggleHidden() {
    setHidden((v) => {
      saveFlag(HIDE_BALANCE_KEY, !v);
      return !v;
    });
  }

  return (
    <div className="vx-wallet">
      {/* No gainers strip here. Wallet is where a balance is read, not where
          a market is watched, and the scrolling tape under the header pushed
          the whole account down for no reason a Wallet user has. Trade and
          Futures keep theirs — the flag is per page, not global. */}
      <Nav active="/wallet" hideTicker />

      {/* Full-bleed, like the reference terminal: the rail sits against the
          left edge and the content runs to the right one. No page heading
          above it — the rail's wordmark is the title. */}
      <main className="wallet-workspace w-full" aria-label={t('nav.wallet')}>
        <div className="wallet-shell">
          <WalletSideNav section={section} onSection={setSection} theme={theme} onToggleTheme={toggleTheme} />

          <div className="wallet-content min-w-0">
            {section === 'overview' && (
              <WalletOverview
                account={account}
                overview={overview}
                rows={rows}
                performance={performance}
                performanceState={performanceState}
                btcEquivalent={btcEquivalent}
                hidden={hidden}
                onToggleHidden={toggleHidden}
                unavailable={unavailable}
                loading={loading}
                onDeposit={() => setModal('deposit')}
                onWithdraw={() => setModal('withdraw')}
                onTransfer={() => setModal('transfer')}
                onHistory={() => setSection('orders')}
                onOpenUnified={() => setSection('unified')}
                onOpenFunding={() => setSection('funding')}
                onOpenPnl={() => setSection('pnl')}
              />
            )}

            {section === 'funding' && (
              <FundingView
                overview={overview}
                hidden={hidden}
                unavailable={unavailable}
                loading={loading}
                onDeposit={() => setModal('deposit')}
                onWithdraw={() => setModal('withdraw')}
                onTransfer={() => setModal('transfer')}
              />
            )}

            {section === 'unified' && (
              <>
                <PortfolioStrip
                  account={account}
                  performance={performance}
                  performanceLoading={performanceState === 'loading'}
                  period={period}
                  onPeriodChange={setPeriod}
                  hidden={hidden}
                  onToggleHidden={toggleHidden}
                  unavailable={unavailable}
                  onDeposit={() => setModal('deposit')}
                  onWithdraw={() => setModal('withdraw')}
                  onTransfer={() => setModal('transfer')}
                  onHistory={() => setSection('orders')}
                />

                <div className="wallet-holdings-grid mt-4">
                  <AssetLedger
                    rows={rows}
                    hidden={hidden}
                    unavailable={unavailable}
                    loading={loading}
                    collateral={account?.mode === 'CROSS'}
                    onCollateralChange={setCollateral}
                    onDeposit={() => setModal('deposit')}
                    onWithdraw={() => setModal('withdraw')}
                    onTransfer={() => setModal('transfer')}
                  />
                  {/* The approved design's footnote: the valuation status
                      under the table. Complete → said so; incomplete → the
                      header already names the unpriced asset. */}
                  {account && account.valuationComplete && (
                    <p className="wallet-foot-note">{t('wallet.valuationFull')}</p>
                  )}
                </div>
              </>
            )}

            {/* The equity curve's own section. Same real series as before —
                stored daily snapshots, flows removed — just no longer
                pushing the asset table out of the first viewport. */}
            {section === 'pnl' && (
              <EquityChart
                performance={performance}
                loading={performanceState === 'loading'}
                unavailable={performanceState === 'error'}
                hidden={hidden}
              />
            )}

            {section === 'orders' && (
              <div ref={historyRef}>
                <TransactionHistory hidden={hidden} />
              </div>
            )}
          </div>
        </div>
      </main>

      <DepositModal open={modal === 'deposit'} onClose={() => setModal(null)} />
      <WithdrawModal open={modal === 'withdraw'} onClose={() => setModal(null)} onSubmitted={refresh} />
      <TransferModal open={modal === 'transfer'} onClose={() => setModal(null)} onSubmitted={refresh} />
    </div>
  );
}
