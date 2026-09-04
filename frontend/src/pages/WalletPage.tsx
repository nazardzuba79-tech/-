import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { useLanguage } from '../lib/i18n';
import { PortfolioStrip } from './wallet-v3/PortfolioStrip';
import { AssetLedger } from './wallet-v3/AssetLedger';
import { PortfolioAllocation } from './wallet-v3/PortfolioAllocation';
import { TransactionHistory } from './wallet-v3/TransactionHistory';
import { DepositModal } from './wallet-v3/DepositModal';
import { WithdrawModal } from './wallet-v3/WithdrawModal';
import { TransferModal } from './wallet-v3/TransferModal';
import { PerformancePeriod, useWalletData } from './wallet-v3/useWalletData';
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
 * Deliberately a *light* financial surface under the app's own dark global
 * header: the exchange chrome stays the dark terminal it is everywhere
 * else, and the account's books read as a ledger. That contrast is the
 * approved design, not an accident — see wallet-v3/wallet.css for how the
 * light area is scoped so it cannot leak into Trade, Futures or Admin.
 *
 * Everything on the page is real: balances and valuations come from
 * /wallet/overview, performance from /wallet/performance, activity from the
 * account's own deposits, withdrawals and fills, and all three modals talk
 * to the same backends the previous Wallet used. Nothing from the design
 * archive's sample data — no example addresses, fees, transactions or
 * balances — reached this code.
 */
export function WalletPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const [modal, setModal] = useState<ActiveModal>(() => {
    const action = searchParams.get('action');
    return action === 'deposit' || action === 'withdraw' || action === 'transfer' ? action : null;
  });
  const [hidden, setHidden] = useState(() => loadFlag(HIDE_BALANCE_KEY));
  const [period, setPeriod] = useState<PerformancePeriod>('7d');

  const { overview, overviewState, performance, performanceState, rows, rankingsLoaded, btcEquivalent, refresh } =
    useWalletData();

  // Deep links from elsewhere in the app (Futures' transfer action, the
  // header's Пополнить) keep working across a query-string-only navigation,
  // which does not remount this page.
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'deposit' || action === 'withdraw' || action === 'transfer') setModal(action);
  }, [searchParams]);

  const unavailable = overviewState === 'error';
  const loading = overviewState === 'loading' || !overview;

  function toggleHidden() {
    setHidden((v) => {
      saveFlag(HIDE_BALANCE_KEY, !v);
      return !v;
    });
  }

  return (
    <div className="vx-wallet">
      <Nav active="/wallet" />

      <main className="mx-auto w-full max-w-[1600px] px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-[21px] font-semibold tracking-[-0.022em] text-ink">{t('nav.wallet')}</h1>
        </div>

        <PortfolioStrip
          overview={overview}
          performance={performance}
          performanceLoading={performanceState === 'loading'}
          btcEquivalent={btcEquivalent}
          hidden={hidden}
          onToggleHidden={toggleHidden}
          period={period}
          onPeriodChange={setPeriod}
          unavailable={unavailable}
          onDeposit={() => setModal('deposit')}
          onWithdraw={() => setModal('withdraw')}
          onTransfer={() => setModal('transfer')}
        />

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_282px] xl:grid-cols-[minmax(0,1fr)_312px] xl:gap-6">
          <AssetLedger
            rows={rows}
            hidden={hidden}
            unavailable={unavailable}
            loading={loading || !rankingsLoaded}
            onDeposit={() => setModal('deposit')}
          />

          <div className="min-w-0 lg:pt-[42px]">
            <PortfolioAllocation rows={rows} hidden={hidden} unavailable={unavailable} loading={loading} />
          </div>
        </div>

        <div className="mt-6">
          <TransactionHistory hidden={hidden} />
        </div>
      </main>

      <DepositModal open={modal === 'deposit'} onClose={() => setModal(null)} />
      <WithdrawModal open={modal === 'withdraw'} onClose={() => setModal(null)} onSubmitted={refresh} />
      <TransferModal open={modal === 'transfer'} onClose={() => setModal(null)} onSubmitted={refresh} />
    </div>
  );
}
