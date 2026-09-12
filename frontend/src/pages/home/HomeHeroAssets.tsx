import { Bitcoin } from 'lucide-react';
import { Sparkline } from '../../components/Sparkline';
import { useLanguage } from '../../lib/i18n';
import { LiveValue } from './LiveValue';
import type { HomeMarket } from './useHomeMarket';
import { globalHeroCopy } from './globalHeroCopy';

export const finiteQuote = (value: unknown) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
  ? Number(value) : typeof value === 'number' && Number.isFinite(value) ? value : null;

function GoldIcon({ size = 24 }: { size?: number; strokeWidth?: number }) {
  return <svg width={size + 8} height={size + 8} viewBox="0 0 48 44" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="vx-hero-gold-top" x1="2" y1="0" x2="19" y2="10" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fff4b6"/><stop offset=".42" stopColor="#ffdf72"/><stop offset="1" stopColor="#e9a320"/>
      </linearGradient>
      <linearGradient id="vx-hero-gold-front" x1="0" y1="6" x2="11" y2="18" gradientUnits="userSpaceOnUse">
        <stop stopColor="#f5c151"/><stop offset="1" stopColor="#a95e08"/>
      </linearGradient>
      <linearGradient id="vx-hero-gold-side" x1="12" y1="9" x2="25" y2="15" gradientUnits="userSpaceOnUse">
        <stop stopColor="#ffdd79"/><stop offset="1" stopColor="#c58117"/>
      </linearGradient>
    </defs>
    {["translate(4 22)", "translate(23 18)", "translate(13 5)"].map((transform, index) => <g transform={transform} key={index}>
      <path d="M0 5 12 0 22 5 10 10Z" fill="url(#vx-hero-gold-top)"/>
      <path d="M0 5 10 10 11 18-2 11Z" fill="url(#vx-hero-gold-front)"/>
      <path d="M10 10 22 5 24 12 11 18Z" fill="url(#vx-hero-gold-side)"/>
      <path d="M0 5 10 10 22 5M10 10 11 18" stroke="#fff0a7" strokeWidth=".65" strokeOpacity=".78"/>
    </g>)}
  </svg>;
}

function OilIcon({ size = 24 }: { size?: number; strokeWidth?: number }) {
  return <svg width={size + 5} height={size + 10} viewBox="0 0 40 48" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="vx-hero-oil-metal" x1="6" y1="24" x2="34" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#132333"/><stop offset=".24" stopColor="#668097"/><stop offset=".43" stopColor="#344d63"/>
        <stop offset=".78" stopColor="#142638"/><stop offset="1" stopColor="#08131e"/>
      </linearGradient>
      <linearGradient id="vx-hero-oil-rim" x1="5" y1="0" x2="35" y2="0" gradientUnits="userSpaceOnUse">
        <stop stopColor="#8c672c"/><stop offset=".3" stopColor="#ffe1a1"/><stop offset=".64" stopColor="#c49950"/><stop offset="1" stopColor="#725124"/>
      </linearGradient>
    </defs>
    <path d="M6 8v32c0 3 6 5 14 5s14-2 14-5V8Z" fill="url(#vx-hero-oil-metal)" stroke="#8ba1b4" strokeWidth=".8"/>
    <ellipse cx="20" cy="8" rx="14" ry="5" fill="#354b5e" stroke="url(#vx-hero-oil-rim)" strokeWidth="1.6"/>
    <ellipse cx="20" cy="8" rx="10.5" ry="3" fill="#192c3c" stroke="#718594" strokeWidth=".6"/>
    <ellipse cx="25" cy="7.5" rx="2.2" ry="1" fill="#07131e" stroke="#b4c0c9" strokeWidth=".6"/>
    <path d="M5.5 16c0 3 6.5 5 14.5 5s14.5-2 14.5-5M5.5 32c0 3 6.5 5 14.5 5s14.5-2 14.5-5M6 40c0 3 6 5 14 5s14-2 14-5" stroke="url(#vx-hero-oil-rim)" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M10 13v25" stroke="#dceaf3" strokeOpacity=".25" strokeWidth="1"/>
    <path d="M20 23c-1.1 2.5-3.5 4.5-3.5 6.5a3.5 3.5 0 0 0 7 0c0-2-2.4-4-3.5-6.5Z" fill="#e4bd76"/>
  </svg>;
}

export function HomeHeroAssets({ market }: { market: HomeMarket }) {
  const { lang, t } = useLanguage();
  const copy = globalHeroCopy[lang];
  const btc = market.tickers.find(row => row.pair === 'BTC/USDT');
  const gold = market.cfd?.configured ? market.cfd.tickers.find(row => row.symbol === 'XAUUSD') : undefined;
  const rows = [
    { key: 'btc', title: 'BTC / USDT', price: market.hero.pair === 'BTC/USDT' ? market.hero.livePrice ?? btc?.price : btc?.price,
      change: btc?.change, Icon: Bitcoin, points: market.priceHistory['BTC/USDT'] ?? [], note: market.tickersStale ? copy.quote : 'BTC / USDT' },
    { key: 'gold', title: 'GOLD', price: finiteQuote(gold?.price), change: finiteQuote(gold?.changePercent24h), Icon: GoldIcon, points: gold ? market.cfdPriceHistory?.XAUUSD ?? [] : [], note: gold ? `${copy.quote} · XAU/USD` : copy.unavailable },
    // No oil instrument exists in the current CFD catalog. Do not substitute
    // another asset or imply an unlisted trading route to fill the design.
    { key: 'oil', title: 'OIL', price: null, change: null, Icon: OilIcon, points: [], note: copy.unavailable },
  ];
  return <div className="vx-global-assets">
    {rows.map(({ key, title, price, change, Icon, points, note }, index) => <div className={`vx-asset-pill vx-asset-${key}`} key={key}
      data-stale={key === 'btc' && market.tickersStale || undefined} style={{ animationDelay: `${-index*3}s` }}>
      <span className="vx-asset-symbol"><Icon size={24} strokeWidth={1.5}/></span>
      <div className="vx-asset-copy"><span>{title}</span><LiveValue value={price}/>
        {typeof change === 'number' && Number.isFinite(change)
          ? <LiveValue value={change} className={change >= 0 ? 'text-up' : 'text-down'} format={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}/>
          : <small>{note}</small>}
      </div>
      {points.length > 1 && <span className="vx-asset-spark" aria-hidden="true"><Sparkline points={points} width={54} height={25}/></span>}
      {key === 'gold' && gold && <span className="vx-asset-source">{copy.quote}</span>}
      {key === 'btc' && market.tickersStale && <span className="vx-asset-source vx-asset-stale">{t('analytics.stale')}</span>}
    </div>)}
  </div>;
}
