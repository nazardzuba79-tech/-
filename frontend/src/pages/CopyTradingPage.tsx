import { useEffect, useMemo, useState } from 'react';
import { Toaster } from 'sonner';
import { api } from '../lib/api';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import './copy-trading-bolt/CopyTradingBolt.css';
import './copy-trading-bolt/CopyTradingRefinement.css';
import './copy-trading-bolt/KseniaReview.css';
import { type Trader, marketplaceTraders, nazarTrader } from './copy-trading-bolt/traders';
import { Marketplace, Profile } from './copy-trading-bolt/components';
import { CopyEligibilityProvider } from './copy-trading-bolt/CopyEligibilityContext';
import { FeaturedAvatarProvider } from './copy-trading-bolt/FeaturedAvatarContext';
import { syntheticNazaraTrader } from '../lib/syntheticCopyTrading';
import { kseniaTrader, kseniaTraderShell, KSENIA_TRADER_ID, withStrategyIdentityVerification } from '../lib/kseniaCopyTrading';
import { useCopyMarketplace } from '../lib/useCopyMarketplace';

function traderFromLocation(): Trader | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('trader');
  if (!id) return null;
  if (id === nazarTrader.id) return nazarTrader;
  if (id === KSENIA_TRADER_ID) return kseniaTraderShell;
  return marketplaceTraders.find(trader => trader.id === id) ?? null;
}

function writeTraderLocation(traderId: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (traderId) url.searchParams.set('trader', traderId);
  else url.searchParams.delete('trader');
  window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

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
  const initialTrader = useMemo(() => traderFromLocation(), []);
  const [view, setView] = useState<'marketplace' | 'profile'>(initialTrader ? 'profile' : 'marketplace');
  const [selectedTrader, setSelectedTrader] = useState<Trader>(initialTrader ?? nazarTrader);
  const [depositUsd, setDepositUsd] = useState(0);
  const marketplace = useCopyMarketplace();
  const { nazar: synthetic, ksenia, identities } = marketplace;

  // A trader profile is a real deep link. Reloading /copy-trading?trader=...
  // restores the same profile, while browser Back/Forward follows history.
  useEffect(() => {
    const syncFromLocation = () => {
      const trader = traderFromLocation();
      if (trader) {
        setSelectedTrader(trader);
        setView('profile');
      } else {
        setView('marketplace');
      }
    };
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  // The archive hardcoded a USER_DEPOSIT constant to gate the deposit
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

  const liveNazara = useMemo(() => withStrategyIdentityVerification(
    syntheticNazaraTrader(synthetic), identities.find(i => i.traderId === nazarTrader.id),
  ), [synthetic, identities]);
  const liveKsenia = useMemo(() => kseniaTrader(ksenia, identities.find(i => i.traderId === KSENIA_TRADER_ID)), [ksenia, identities]);

  const visibleTrader = selectedTrader.id === nazarTrader.id ? liveNazara : selectedTrader.id === KSENIA_TRADER_ID ? liveKsenia : selectedTrader;

  function openProfile(trader: Trader) {
    setSelectedTrader(trader);
    setView('profile');
    writeTraderLocation(trader.id);
    window.scrollTo(0, 0);
  }

  function backToMarketplace() {
    setView('marketplace');
    writeTraderLocation(null);
    window.scrollTo(0, 0);
  }

  // The profile itself renders its identity/header immediately and defers
  // the heavier charts/tables until after the first browser paint.
  return (
    <div className={`copytrading-bolt-root ${view === 'profile' ? 'profile-view' : ''}`}>
      <Nav active="/copy-trading" />
      <div className="app">
        <div className="content-wrap">
          <CopyEligibilityProvider depositUsd={depositUsd}>
            <FeaturedAvatarProvider ownerAvatar={identities.find(i => i.traderId === nazarTrader.id)?.avatarUrl ?? null}>
              {view === 'marketplace'
                ? <Marketplace onOpen={openProfile} nazara={liveNazara} synthetic={synthetic} ksenia={liveKsenia} kseniaSynthetic={ksenia} availability={marketplace} />
                : <Profile trader={visibleTrader} onBack={backToMarketplace} synthetic={visibleTrader.id === KSENIA_TRADER_ID ? ksenia : synthetic} />}
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
