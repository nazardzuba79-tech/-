import { useEffect, useMemo, useState } from 'react';
import { toast, Toaster } from 'sonner';
import { api } from '../lib/api';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import './copy-trading-bolt/CopyTradingBolt.css';
import { type Trader, nazarTrader } from './copy-trading-bolt/traders';
import { Marketplace, Profile } from './copy-trading-bolt/components';
import { CopyEligibilityProvider } from './copy-trading-bolt/CopyEligibilityContext';
import { FeaturedAvatarProvider } from './copy-trading-bolt/FeaturedAvatarContext';
import type { SyntheticCopyTradingResponse } from '../lib/syntheticCopyTrading';

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
  const [synthetic, setSynthetic] = useState<SyntheticCopyTradingResponse | null>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);

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

  useEffect(() => {
    api.getSyntheticCopyTrading().then(setSynthetic).catch(() => {});
  }, []);

  const liveNazara = useMemo<Trader>(() => {
    if (!synthetic) return { ...nazarTrader, name: 'Nazara' };
    const { analytics } = synthetic;
    return {
      ...nazarTrader,
      name: synthetic.trader.name,
      roi7: analytics.roi7,
      roi30: analytics.roi30,
      roi90: analytics.roi90,
      roiAll: analytics.roiAll,
      winRate: analytics.winRate,
      drawdown: analytics.maximumDrawdown,
      copiers: analytics.activeFollowers,
      aum: analytics.aum,
    };
  }, [synthetic]);

  const visibleTrader = selectedTrader.id === nazarTrader.id ? liveNazara : selectedTrader;

  async function advanceSimulation(days: 1 | 7 | 30 | 90) {
    setSimulationBusy(true);
    try { setSynthetic(await api.advanceSyntheticCopyTrading(days)); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось изменить синтетическое время'); }
    finally { setSimulationBusy(false); }
  }

  async function resetSimulation() {
    setSimulationBusy(true);
    try { setSynthetic(await api.resetSyntheticCopyTrading()); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось сбросить синтетическую историю'); }
    finally { setSimulationBusy(false); }
  }

  async function returnToRealTime() {
    setSimulationBusy(true);
    try { setSynthetic(await api.setSyntheticCopyTradingMode('REAL_TIME')); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось включить real-time режим'); }
    finally { setSimulationBusy(false); }
  }

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
          {isAdmin && synthetic && (
            <aside className="synthetic-admin" aria-label="Внутреннее управление синтетическим временем">
              <div>
                <strong>INTERNAL · Synthetic Copy Trading</strong>
                <span>{synthetic.simulation.mode} · seed {synthetic.simulation.seed} · {new Date(synthetic.simulation.simulatedAt).toLocaleDateString('ru-RU')}</span>
              </div>
              <div className="synthetic-admin-actions">
                {([1, 7, 30, 90] as const).map((days) => <button key={days} disabled={simulationBusy} onClick={() => advanceSimulation(days)}>+{days}Д</button>)}
                <button disabled={simulationBusy || synthetic.simulation.mode === 'REAL_TIME'} onClick={returnToRealTime}>Real-time</button>
                <button disabled={simulationBusy} onClick={resetSimulation}>Сброс</button>
              </div>
            </aside>
          )}
          <CopyEligibilityProvider depositUsd={depositUsd} isAdmin={isAdmin}>
            <FeaturedAvatarProvider>
              {view === 'marketplace'
                ? <Marketplace onOpen={openProfile} nazara={liveNazara} synthetic={synthetic} />
                : <Profile trader={visibleTrader} onBack={backToMarketplace} synthetic={synthetic} />}
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
