import { HomeHeader } from './HomeHeader';
import { HomeTradingSessions } from './HomeTradingSessions';
import { HomeHeatmap } from './HomeHeatmap';
import { HomeFaq } from './HomeFaq';
import { HomeFooter } from './HomeFooter';
import { Reveal } from './Reveal';
import { useHomeMarket } from './useHomeMarket';
import { IxHero } from './institutional/IxHero';
import { IxMarkets } from './institutional/IxMarkets';
import { IxCard, IxProducts, IxReach, IxStats } from './institutional/IxSections';
import './home.css';
import './home-live-market.css';
import './home-six-hour-market.css';
// Loaded AFTER home.css on purpose: this is the Tailwind utilities layer
// the homepage owns, and it must win specificity ties against the
// `.vx-home` rules above. See home-tailwind-utilities.css for why the
// homepage ships its own copy at all.
import './home-tailwind-utilities.css';
import './home-trading-sessions.css';
import './home-heatmap.css';
// The institutional proposal's design system; last, so its tokens and the
// few overrides of the reused sections win.
import './institutional/home-institutional.css';

/**
 * The VOLTEX homepage — institutional proposal (owner review, 2026-09-30).
 *
 *   header · hero with a live market board · market facts · markets table ·
 *   market map · products · Crypto Card · trading sessions · coverage · FAQ ·
 *   footer
 *
 * One market hook still feeds every section, on the same six-hour public
 * snapshot cadence; links, tabs, favourites and the header's session logic
 * are unchanged. Sections below the fold reveal once as they come into view.
 */
export function HomePage() {
  const market = useHomeMarket();

  return (
    <div className="vx-home vx-ix">
      <HomeHeader />
      <main className="ix-main">
        <IxHero market={market} />
        <IxStats market={market} />
        <Reveal><IxMarkets market={market} /></Reveal>
        <Reveal><div className="ix-legacy ix-legacy-heatmap"><HomeHeatmap market={market} /></div></Reveal>
        <Reveal><IxProducts /></Reveal>
        <Reveal><IxCard /></Reveal>
        <Reveal><div className="ix-legacy ix-legacy-sessions"><HomeTradingSessions /></div></Reveal>
        <Reveal><IxReach market={market} /></Reveal>
        <Reveal><div className="ix-legacy ix-legacy-faq"><HomeFaq /></div></Reveal>
      </main>
      <div className="ix-legacy ix-legacy-footer"><HomeFooter /></div>
    </div>
  );
}
