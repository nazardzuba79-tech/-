import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { useLanguage } from '../lib/i18n';
import { PortfolioStrip } from './wallet-v3/PortfolioStrip';
import { EquityChart } from './wallet-v3/EquityChart';
import { AssetLedger } from './wallet-v3/AssetLedger';
import { PortfolioAllocation } from './wallet-v3/PortfolioAllocation';
import { TransactionHistory } from './wallet-v3/TransactionHistory';
import { DepositModal } from './wallet-v3/DepositModal';
import { WithdrawModal } from './wallet-v3/WithdrawModal';
import { TransferModal } from './wallet-v3/TransferModal';
import { useWalletData } from './wallet-v3/useWalletData';
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
 * The Unified Trading Account.
 *
 * A dark terminal surface, in the same visual language as Futures and Spot
 * rather than a white sheet under the app's black header. The palette lives
 * entirely in wallet-v3/wallet.css, scoped so it cannot leak into Trade,
 * Futures or Admin.
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
  const historyRef = useRef<HTMLDivElement>(null);

  const {
    overviewState,
    performance,
    performanceState,
    account,
    accountResolved,
    rows,
    rankingsLoaded,
    btcEquivalent,
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
      <Nav active="/wallet" />

      <main className="wallet-workspace mx-auto w-full max-w-[1680px] px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-[22px] font-semibold tracking-normal text-ink sm:text-[24px]">{t('nav.wallet')}</h1>
        </div>

        <PortfolioStrip
          account={account}
          btcEquivalent={btcEquivalent}
          hidden={hidden}
          onToggleHidden={toggleHidden}
          unavailable={unavailable}
          onDeposit={() => setModal('deposit')}
          onWithdraw={() => setModal('withdraw')}
          onTransfer={() => setModal('transfer')}
          onHistory={() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onRefresh={refresh}
        />

        {/* The account's own history, from its stored daily snapshots. Its
            own card rather than a strip inside the header: an equity curve
            is a section, not an ornament beside the balance. */}
        <div className="mt-5">
          <EquityChart
            performance={performance}
            loading={performanceState === 'loading'}
            unavailable={performanceState === 'error'}
            hidden={hidden}
          />
        </div>

        <div className="wallet-holdings-grid mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
          <AssetLedger
            rows={rows}
            hidden={hidden}
            unavailable={unavailable}
            loading={loading || !rankingsLoaded}
            onDeposit={() => setModal('deposit')}
            onWithdraw={() => setModal('withdraw')}
            onTransfer={() => setModal('transfer')}
          />

          <div className="wallet-allocation-column min-w-0 lg:pt-[46px]">
            <PortfolioAllocation
              rows={rows}
              hidden={hidden}
              unavailable={unavailable}
              loading={loading}
              unpricedAssets={account?.unpricedAssets ?? []}
            />
          </div>
        </div>

        <div className="mt-5" ref={historyRef}>
          <TransactionHistory hidden={hidden} />
        </div>
      </main>

      <DepositModal open={modal === 'deposit'} onClose={() => setModal(null)} />
      <WithdrawModal open={modal === 'withdraw'} onClose={() => setModal(null)} onSubmitted={refresh} />
      <TransferModal open={modal === 'transfer'} onClose={() => setModal(null)} onSubmitted={refresh} />
    </div>
  );
}
