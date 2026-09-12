import { HomeHeader } from './HomeHeader';
import { HomeHero } from './HomeHero';
import { HomeMarketOverview } from './HomeMarketOverview';
import { HomeCardTravel } from './HomeCardTravel';
import { HomeTradingSessions } from './HomeTradingSessions';
import { HomeHeatmap } from './HomeHeatmap';
import { HomeEcosystem } from './HomeEcosystem';
import { MotionStage } from './HomeMotion';
import { HomeMarkets } from './HomeMarkets';
import { HomeFaq } from './HomeFaq';
import { HomeFooter } from './HomeFooter';
import { Reveal } from './Reveal';
import { useHomeMarket } from './useHomeMarket';
import './home.css';
import './home-live-market.css';
// Loaded AFTER home.css on purpose: this is the Tailwind utilities layer
// the homepage owns, and it must win specificity ties against the
// `.vx-home` rules above. See home-tailwind-utilities.css for why the
// homepage ships its own copy at all.
import './home-tailwind-utilities.css';
import './home-card-travel.css';
import './home-trading-sessions.css';
import './home-heatmap.css';
// Perspective display geometry must win over the shared compact preview rules.
import './hero-reference.css';
import './home-sapphire.css';
import './sapphire-terminal-detail.css';

/**
 * The VOLTEX homepage, in the approved section order:
 *
 *   header · hero + market tape · market overview · approved Crypto Card A ·
 *   trading sessions · heatmap · markets · institutional ecosystem · FAQ · footer
 *
 * One market hook feeds every section, so the whole page costs a single
 * ticker poll plus three one-shot requests rather than a fetch per block.
 * Sections below the fold reveal once as they come into view.
 *
 * Nothing outside this directory is touched: Trade, Futures, Copy Trading,
 * Wallet, Analytics and Admin keep their own components, routes, styling
 * and permissions exactly as they were.
 */
export function HomePage() {
  const market = useHomeMarket();

  return (
    <div className="vx-home vx-reference-home vx-sapphire-home">
      <HomeHeader />
      <main className="flex flex-col gap-5 pb-7">
        <HomeHero market={market} />
        <Reveal>
          <HomeMarketOverview market={market} />
        </Reveal>
        <Reveal>
          <MotionStage className="vx-travel-stage"><HomeCardTravel /></MotionStage>
        </Reveal>
        <Reveal>
          <HomeTradingSessions />
        </Reveal>
        <Reveal>
          <HomeHeatmap market={market} />
        </Reveal>
        <Reveal>
          <HomeMarkets market={market} />
        </Reveal>
        <Reveal>
          <HomeEcosystem />
        </Reveal>
        <Reveal>
          <HomeFaq />
        </Reveal>
      </main>
      <HomeFooter />
    </div>
  );
}
