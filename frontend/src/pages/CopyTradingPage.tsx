import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { api } from '../lib/api';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import './copy-trading-bolt/CopyTradingBolt.css';
import { type Trader, nazarTrader } from './copy-trading-bolt/traders';
import { Marketplace, Profile } from './copy-trading-bolt/components';
import { CopyEligibilityProvider } from './copy-trading-bolt/CopyEligibilityContext';
import { FeaturedAvatarProvider } from './copy-trading-bolt/FeaturedAvatarContext';

// Integration of the approved Bolt.new Copy Trading / Marketplace archive
// (see copy-trading-bolt/) — same Marketplace/Profile views, same trader
// roster and math, same CSS, ported as closely as the stack difference
// (Next.js -> this Vite/react-router app) allows. Real site chrome (Nav,
// with the site's own unchanged VOLTEX logo, and Footer) wraps it instead
// of the archive's own placeholder topbar/footer; view/selectedTrader/tick
// state is the same machine the archive's own App() component ran. The
// archive also drifted every ROI upward on a 30s timer; that is gone,
// because the drifted figures disagreed with the chart and the earnings
// panel within minutes. Figures still move — once a UTC day, seeded, from
// one place (see traders.ts) so every surface moves together.
export function CopyTradingPage() {
  const [view, setView] = useState<'marketplace' | 'profile'>('marketplace');
  const [selectedTrader, setSelectedTrader] = useState<Trader>(nazarTrader);
  const [depositUsd, setDepositUsd] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

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

  // Admins review this page without necessarily funding the account it
  // runs under — don't make them stare at the $20,000 deposit gate to see
  // what a real copier would see.
  useEffect(() => {
    api
      .getMe()
      .then((me) => setIsAdmin(me.isAdmin))
      .catch(() => {});
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
          <CopyEligibilityProvider depositUsd={depositUsd} isAdmin={isAdmin}>
            <FeaturedAvatarProvider>
              {view === 'marketplace' ? <Marketplace onOpen={openProfile} /> : <Profile trader={selectedTrader} onBack={backToMarketplace} />}
            </FeaturedAvatarProvider>
          </CopyEligibilityProvider>
        </div>
      </div>
      <Footer />
      {/* Copying a trader confirms with a toast, so this page needs its own
          Toaster — sonner only renders toasts where one is mounted, and the
          app mounts it per page rather than globally. Without it the Copy
          button would act with no feedback at all. */}
      <Toaster position="top-right" richColors />
    </div>
  );
}
