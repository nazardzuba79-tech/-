import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import './copy-trading-bolt/CopyTradingBolt.css';
import { type Trader, nazarTrader } from './copy-trading-bolt/traders';
import { Marketplace, Profile } from './copy-trading-bolt/components';
import { CopyEligibilityProvider } from './copy-trading-bolt/CopyEligibilityContext';

// Integration of the approved Bolt.new Copy Trading / Marketplace archive
// (see copy-trading-bolt/) — same Marketplace/Profile views, same trader
// roster and math, same CSS, ported as closely as the stack difference
// (Next.js -> this Vite/react-router app) allows. Real site chrome (Nav,
// with the site's own unchanged VOLTEX logo, and Footer) wraps it instead
// of the archive's own placeholder topbar/footer; view/selectedTrader/tick
// state and the 30s "live" tick are the same state machine the archive's
// own App() component ran.
export function CopyTradingPage() {
  const [view, setView] = useState<'marketplace' | 'profile'>('marketplace');
  const [selectedTrader, setSelectedTrader] = useState<Trader>(nazarTrader);
  const [tick, setTick] = useState(0);
  const [depositUsd, setDepositUsd] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((c) => c + 1), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // The archive hardcoded a USER_DEPOSIT constant to gate the $20,000
  // threshold; this account's real deposit is the most recent portfolio
  // value the Wallet page has persisted (spot + futures, priced live —
  // see portfolio.ts). A brand-new account that has never opened Wallet
  // has no snapshot yet, so it correctly reads as $0 / not eligible rather
  // than guessing.
  useEffect(() => {
    api
      .getPortfolioHistory('90d')
      .then(({ points }) => {
        const latest = points[points.length - 1];
        setDepositUsd(latest ? Number(latest.totalValueUsd) : 0);
      })
      .catch(() => setDepositUsd(0));
  }, []);

  function openProfile(trader: Trader) {
    setSelectedTrader(trader);
    setView('profile');
    window.scrollTo(0, 0);
  }

  function backToMarketplace() {
    setView('marketplace');
    window.scrollTo(0, 0);
  }

  return (
    <div className="copytrading-bolt-root">
      <Nav active="/copy-trading" />
      <div className="app">
        <div className="content-wrap">
          <CopyEligibilityProvider depositUsd={depositUsd}>
            {view === 'marketplace' ? <Marketplace onOpen={openProfile} /> : <Profile trader={selectedTrader} onBack={backToMarketplace} tick={tick} />}
          </CopyEligibilityProvider>
        </div>
      </div>
      <Footer />
    </div>
  );
}
