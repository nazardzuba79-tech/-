import { useEffect, useMemo, useState } from 'react';
import { Toaster } from 'sonner';
import { api } from '../lib/api';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import './copy-trading-bolt/CopyTradingBolt.css';
import './copy-trading-bolt/CopyTradingRefinement.css';
import './copy-trading-bolt/KseniaReview.css';
import { type Trader, nazarTrader } from './copy-trading-bolt/traders';
import { Marketplace, Profile } from './copy-trading-bolt/components';
import { CopyEligibilityProvider } from './copy-trading-bolt/CopyEligibilityContext';
import { FeaturedAvatarProvider } from './copy-trading-bolt/FeaturedAvatarContext';
import { syntheticNazaraTrader } from '../lib/syntheticCopyTrading';
import { kseniaTrader, KSENIA_TRADER_ID, withStrategyIdentityVerification } from '../lib/kseniaCopyTrading';
import { useCopyMarketplace } from '../lib/useCopyMarketplace';

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
  const [profileReady, setProfileReady] = useState(true);
  const [depositUsd, setDepositUsd] = useState(0);
  const marketplace = useCopyMarketplace();
  const { nazar: synthetic, ksenia, identities } = marketplace;

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

  // The two featured profiles carry substantially more analytics than an
  // ordinary catalogue card. Render a tiny profile shell first, let the
  // browser paint it, then mount the heavy analytics on the next frame.
  // This makes the click itself immediate even on a cold first open.
  useEffect(() => {
    if (view !== 'profile' || profileReady) return;
    const frame = window.requestAnimationFrame(() => setProfileReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [view, profileReady, selectedTrader.id]);

  function openProfile(trader: Trader) {
    setSelectedTrader(trader);
    setProfileReady(false);
    setView('profile');
    window.scrollTo(0, 0);
  }

  function backToMarketplace() {
    setProfileReady(true);
    setView('marketplace');
    window.scrollTo(0, 0);
  }

  // Profile styling is scoped separately so its compact analytical layout
  // can evolve without changing the approved marketplace surface.
  return (
    <div className={`copytrading-bolt-root ${view === 'profile' ? 'profile-view' : ''}`}>
      <Nav active="/copy-trading" />
      <div className="app">
        <div className="content-wrap">
          <CopyEligibilityProvider depositUsd={depositUsd}>
            <FeaturedAvatarProvider ownerAvatar={identities.find(i => i.traderId === nazarTrader.id)?.avatarUrl ?? null}>
              {view === 'marketplace'
                ? <Marketplace onOpen={openProfile} nazara={liveNazara} synthetic={synthetic} ksenia={liveKsenia} kseniaSynthetic={ksenia} availability={marketplace} />
                : profileReady
                  ? <Profile trader={visibleTrader} onBack={backToMarketplace} synthetic={visibleTrader.id === KSENIA_TRADER_ID ? ksenia : synthetic} />
                  : <main className="page-shell copy-profile profile-opening-shell" role="status" aria-live="polite">
                      <button className="profile-opening-back" type="button" onClick={backToMarketplace}>← Назад к трейдерам</button>
                      <section className="profile-opening-card">
                        <div className={`avatar avatar-${visibleTrader.tone}`}>{visibleTrader.initials}</div>
                        <div><span>MASTER TRADER</span><h1>{visibleTrader.name}</h1><p>Открываем профиль…</p></div>
                      </section>
                    </main>}
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
