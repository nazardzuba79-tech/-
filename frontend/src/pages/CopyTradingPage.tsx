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
import { syntheticNazaraTrader, type SyntheticCopyTradingResponse } from '../lib/syntheticCopyTrading';
import { kseniaTrader, KSENIA_TRADER_ID, withStrategyIdentityVerification, type KseniaResponse, type PublicStrategyIdentity } from '../lib/kseniaCopyTrading';

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
  const [synthetic, setSynthetic] = useState<SyntheticCopyTradingResponse | null>(null);
  const [ksenia, setKsenia] = useState<KseniaResponse | null>(null);
  const [identities, setIdentities] = useState<PublicStrategyIdentity[]>([]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void api.getCopyStrategyIdentities().then(data => { if (!disposed) setIdentities(data.identities.filter((value): value is PublicStrategyIdentity => value !== null)); }).catch(() => {});
      void api.getKseniaCopyTrading().then(data => { if (!disposed) setKsenia(data); }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
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

  useEffect(() => {
    let disposed = false;
    let loading = false;
    let loadedDay = '';
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const next = await api.getNazarCopyTrading();
        if (!disposed) {
          loadedDay = next.simulation.simulatedAt.slice(0, 10);
          setSynthetic(next);
        }
      } catch { /* Keep unavailable/last known state; never invent returns. */ }
      finally { loading = false; }
    }
    void refresh();
    // The normal backend appends the canonical UTC history without replacing
    // older sessions. Refresh across midnight and when the owner returns.
    const timer = window.setInterval(() => {
      if (loadedDay !== new Date().toISOString().slice(0, 10)) void refresh();
    }, 60_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  const liveNazara = useMemo(() => withStrategyIdentityVerification(
    syntheticNazaraTrader(synthetic), identities.find(i => i.traderId === nazarTrader.id),
  ), [synthetic, identities]);
  const liveKsenia = useMemo(() => ksenia ? kseniaTrader(ksenia, identities.find(i => i.traderId === KSENIA_TRADER_ID)) : undefined, [ksenia, identities]);

  const visibleTrader = selectedTrader.id === nazarTrader.id ? liveNazara : selectedTrader.id === KSENIA_TRADER_ID ? liveKsenia ?? selectedTrader : selectedTrader;

  function openProfile(trader: Trader) {
    setSelectedTrader(trader);
    setView('profile');
    window.scrollTo(0, 0);
  }

  function backToMarketplace() {
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
                ? <Marketplace onOpen={openProfile} nazara={liveNazara} synthetic={synthetic} ksenia={liveKsenia} kseniaSynthetic={ksenia} />
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
