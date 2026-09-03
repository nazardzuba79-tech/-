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
import './home.css';

/**
 * The VOLTEX homepage, in the approved section order:
 *
 *   header · hero · market strip · market overview · Crypto Card ·
 *   markets + secondary card · FAQ · footer
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
    <div className="vx-home">
      <HomeHeader />
      <main className="flex flex-col gap-5 pb-7">
        <HomeHero market={market} />
        <HomeTicker market={market} />
        <Reveal>
          <HomeMarketOverview market={market} />
        </Reveal>
        <Reveal>
          <HomeCardSection />
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
