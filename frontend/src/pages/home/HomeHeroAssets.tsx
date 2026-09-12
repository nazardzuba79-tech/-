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
      <linearGradient id="vx-hero-oil-metal" x1="6" y1="19" x2="35" y2="35" gradientUnits="userSpaceOnUse">
        <stop stopColor="#f1f6fc"/><stop offset=".18" stopColor="#a0b4c9"/><stop offset=".36" stopColor="#28394c"/>
        <stop offset=".65" stopColor="#03080e"/><stop offset="1" stopColor="#314a61"/>
      </linearGradient>
    </defs>
    <path d="M20 2C19 12 6 21 6 32a14 14 0 0 0 28 0C34 21 23 12 20 2Z" fill="url(#vx-hero-oil-metal)" stroke="#bdcddd" strokeWidth=".7"/>
    <path d="M16 14C12 21 9 27 9 32c0 5 3 9 7 10" fill="none" stroke="#e6f2ff" strokeWidth="1.1" strokeLinecap="round" opacity=".78"/>
    <path d="M14 43c7 3 14-1 16-7" fill="none" stroke="#7190ad" strokeWidth=".8" strokeLinecap="round" opacity=".6"/>
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
    { key: 'gold', title: copy.gold, price: finiteQuote(gold?.price), change: finiteQuote(gold?.changePercent24h), Icon: GoldIcon, points: gold ? market.cfdPriceHistory?.XAUUSD ?? [] : [], note: gold ? `${copy.quote} · XAU/USD` : copy.unavailable },
    // No oil instrument exists in the current CFD catalog. Do not substitute
    // another asset or imply an unlisted trading route to fill the design.
    { key: 'oil', title: copy.oil, price: null, change: null, Icon: OilIcon, points: [], note: copy.unavailable },
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
