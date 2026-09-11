import { Bitcoin, Droplet, Layers3 } from 'lucide-react';
import { Sparkline } from '../../components/Sparkline';
import { useLanguage } from '../../lib/i18n';
import { LiveValue } from './LiveValue';
import type { HomeMarket } from './useHomeMarket';
import { globalHeroCopy } from './globalHeroCopy';

export const finiteQuote = (value: unknown) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
  ? Number(value) : typeof value === 'number' && Number.isFinite(value) ? value : null;

export function HomeHeroAssets({ market }: { market: HomeMarket }) {
  const { lang } = useLanguage();
  const copy = globalHeroCopy[lang];
  const btc = market.tickers.find(row => row.pair === 'BTC/USDT');
  const gold = market.cfd?.configured ? market.cfd.tickers.find(row => row.symbol === 'XAUUSD') : undefined;
  const rows = [
    { key: 'btc', title: 'BTC / USDT', price: market.hero.pair === 'BTC/USDT' ? market.hero.livePrice ?? btc?.price : btc?.price,
      change: btc?.change, Icon: Bitcoin, points: market.priceHistory['BTC/USDT'] ?? [], note: market.tickersStale ? copy.quote : 'BTC / USDT' },
    { key: 'gold', title: copy.gold, price: finiteQuote(gold?.price), change: finiteQuote(gold?.changePercent24h), Icon: Layers3, points: gold ? market.cfdPriceHistory?.XAUUSD ?? [] : [], note: gold ? `${copy.quote} · XAU/USD` : copy.unavailable },
    // No oil instrument exists in the current CFD catalog. Do not substitute
    // another asset or imply an unlisted trading route to fill the design.
    { key: 'oil', title: copy.oil, price: null, change: null, Icon: Droplet, points: [], note: copy.unavailable },
  ];
  return <div className="vx-global-assets">
    {rows.map(({ key, title, price, change, Icon, points, note }, index) => <div className={`vx-asset-pill vx-asset-${key}`} key={key} style={{ animationDelay: `${-index*3}s` }}>
      <span className="vx-asset-symbol"><Icon size={24} strokeWidth={1.5}/></span>
      <div className="vx-asset-copy"><span>{title}</span><LiveValue value={price}/>
        {typeof change === 'number' && Number.isFinite(change)
          ? <LiveValue value={change} className={change >= 0 ? 'text-up' : 'text-down'} format={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}/>
          : <small>{note}</small>}
      </div>
      {points.length > 1 && <span className="vx-asset-spark" aria-hidden="true"><Sparkline points={points} width={54} height={25}/></span>}
      {key === 'gold' && gold && <span className="vx-asset-source">{copy.quote}</span>}
    </div>)}
  </div>;
}
