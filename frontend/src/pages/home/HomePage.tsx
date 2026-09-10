import { HomeHeader } from './HomeHeader';
import { HomeHero } from './HomeHero';
import { HomeTicker } from './HomeTicker';
import { HomeMarketOverview } from './HomeMarketOverview';
import { HomeCardSection } from './HomeCardSection';
import { HomeMarkets } from './HomeMarkets';
import { HomeFaq } from './HomeFaq';
import { HomeFooter } from './HomeFooter';
import { Reveal } from './Reveal';
import { useHomeMarket } from './useHomeMarket';
import { HomeWorldActivity } from './HomeWorldActivity';
import { HomeHeatmap } from './HomeHeatmap';
import { MotionStage } from './HomeMotion';
import './home.css';
// Loaded AFTER home.css on purpose: this is the Tailwind utilities layer
// the homepage owns, and it must win specificity ties against the
// `.vx-home` rules above. See home-tailwind-utilities.css for why the
// homepage ships its own copy at all.
import './home-tailwind-utilities.css';
import './home-live-market.css';
import './home-world-heatmap.css';
import './home-motion.css';

/**
 * Existing product sections retain their order; the world map and heatmap
 * introduce two wider pauses between the trading data and product story.
 *
 *   header · hero · market strip · market overview · Crypto Card ·
 *   markets + secondary card · FAQ · footer
 *
 * One market hook owns ticker polling and the visible hero's real market
 * detail requests. Presentation components never start data polling.
 * Sections below the fold reveal once as they come into view.
 *
 * Nothing outside this directory is touched: Trade, Futures, Copy Trading,
 * Wallet, Analytics and Admin keep their own components, routes, styling
 * and permissions exactly as they were.
 */
export function HomePage() {
  const market = useHomeMarket();

  return (
    <div className="vx-home">
      <HomeHeader />
      <main className="flex flex-col gap-5 pb-7">
        <MotionStage className="vx-hero-stage"><HomeHero market={market} /></MotionStage>
        <HomeTicker market={market} />
        <Reveal>
          <HomeMarketOverview market={market} />
        </Reveal>
        <Reveal>
          <HomeWorldActivity />
        </Reveal>
        <Reveal>
          <MotionStage className="vx-card-stage" tilt><HomeCardSection /></MotionStage>
        </Reveal>
        <Reveal>
          <HomeHeatmap market={market} />
        </Reveal>
        <Reveal>
          <HomeMarkets market={market} />
        </Reveal>
        <Reveal>
          <HomeFaq />
        </Reveal>
      </main>
      <HomeFooter />
    </div>
  );
}
