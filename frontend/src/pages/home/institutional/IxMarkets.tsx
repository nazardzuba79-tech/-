import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Star } from 'lucide-react';
import { CryptoIcon } from '../../../components/CryptoIcon';
import { useFavorites } from '../../../lib/useFavorites';
import { type Key, useLanguage } from '../../../lib/i18n';
import { HomeMarket, HomeTicker, byVolume, formatCompactUsd, formatPriceValue } from '../useHomeMarket';
import { IxSpark } from './IxCharts';
import { dir, signed } from './IxHero';
import { ixCopy } from './ixCopy';

type Tab = 'favorites' | 'all' | 'spot' | 'futures' | 'cfd';
const TABS: { id: Tab; labelKey?: Key; label?: string }[] = [
  { id: 'all', labelKey: 'home.markets.tabAll' },
  { id: 'spot', labelKey: 'trade.spotTab' },
  { id: 'futures', labelKey: 'nav.futures' },
  { id: 'cfd', label: 'CFD' },
  { id: 'favorites', labelKey: 'home.markets.tabFavorites' },
];
const ROWS = 8;

interface Row { key: string; symbol: string; base: string; name: string; price: number; change: number; volume: number | null; products: string[]; to: string; spark: number[] | null | undefined; fav: string | null }

/**
 * The markets table the old page kept below the fold, moved up and given
 * the terminal's discipline: one row height, tabular figures, the 7-day
 * path from the rankings feed, and the same tabs, favourites and links.
 */
export function IxMarkets({ market }: { market: HomeMarket }) {
  const { t, lang } = useLanguage();
  const c = ixCopy[lang];
  const [tab, setTab] = useState<Tab>('all');
  const { favorites, toggle } = useFavorites();
  const rank = useMemo(() => new Map(market.rankings.map(r => [r.symbol.toUpperCase(), r])), [market.rankings]);
  const spot = useMemo(() => byVolume(market.tickers, 60), [market.tickers]);
  const perp = useMemo(() => new Set(market.futuresSymbols), [market.futuresSymbols]);

  const cryptoRow = (tk: HomeTicker, futuresOnly = false): Row => ({
    key: `${futuresOnly ? 'perp:' : ''}${tk.pair}`, symbol: tk.pair, base: tk.base, name: rank.get(tk.base.toUpperCase())?.name ?? tk.base,
    price: tk.price, change: tk.change, volume: tk.quoteVolume,
    products: futuresOnly ? [t('nav.futures')] : [t('trade.spotTab'), ...(perp.has(tk.pair) ? [t('nav.futures')] : [])],
    to: futuresOnly ? `/futures?pair=${encodeURIComponent(tk.pair)}` : `/trade?pair=${encodeURIComponent(tk.pair)}`,
    spark: rank.get(tk.base.toUpperCase())?.sparkline ?? market.priceHistory[tk.pair], fav: tk.pair,
  });
  const cfd: Row[] = market.cfd?.configured ? market.cfd.tickers.map(x => {
    const ch = Number(x.changePercent24h);
    return { key: `cfd:${x.symbol}`, symbol: x.symbol, base: x.symbol.slice(0, 3), name: x.name, price: Number(x.price), change: Number.isFinite(ch) ? ch : 0, volume: null,
      products: ['CFD'], to: `/trade?market=cfd&symbol=${encodeURIComponent(x.symbol)}`, spark: market.cfdPriceHistory?.[x.symbol], fav: null };
  }) : [];

  const rows: Row[] = (() => {
    switch (tab) {
      case 'favorites': return spot.filter(tk => favorites.has(tk.pair)).slice(0, ROWS).map(tk => cryptoRow(tk));
      case 'spot': return spot.slice(0, ROWS).map(tk => cryptoRow(tk));
      case 'futures': return spot.filter(tk => perp.has(tk.pair)).slice(0, ROWS).map(tk => cryptoRow(tk, true));
      case 'cfd': return cfd.slice(0, ROWS);
      default: return [...spot.map(tk => cryptoRow(tk)), ...cfd].slice(0, ROWS);
    }
  })();
  const empty = tab === 'favorites' ? t('home.markets.noFavorites')
    : market.tickersStatus === 'loading' ? t('home.markets.loading')
    : tab === 'cfd' && market.cfd && !market.cfd.configured ? t('home.markets.cfdNotConfigured') : t('home.marketDataUnavailable');

  return <section className="ix-wrap ix-section" aria-labelledby="ix-markets-title">
    <header className="ix-section-head ix-section-head-split">
      <div><p className="ix-label">{t('nav.markets')}</p><h2 id="ix-markets-title">{t('home.markets.title')}</h2></div>
      <p className="ix-lead">{c.marketsLead}</p>
    </header>
    <div className="ix-table-card">
      <div className="ix-tabs" role="tablist">
        {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.labelKey ? t(item.labelKey) : item.label}</button>)}
      </div>
      <div className="ix-table-scroll">
        <table className="ix-table">
          <thead><tr>
            <th scope="col">{t('markets.pair')}</th>
            <th scope="col" className="r">{t('markets.price')}</th>
            <th scope="col" className="r">{t('trade.change24h')}</th>
            <th scope="col" className="c ix-hide-sm">{c.sevenDays}</th>
            <th scope="col" className="r ix-hide-sm">{t('trade.volume24h')}</th>
            <th scope="col" className="r ix-hide-xs"><span className="ix-sr">{t('trade.action')}</span></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="ix-table-empty">{empty}</td></tr> : rows.map(r => <tr key={r.key}>
              <td>
                <div className="ix-pair">
                  {r.fav ? <button type="button" className="ix-fav" aria-pressed={favorites.has(r.fav)} aria-label={r.symbol} onClick={() => toggle(r.fav!)}><Star size={14} strokeWidth={1.6} aria-hidden="true" /></button> : <span className="ix-fav-spacer" aria-hidden="true" />}
                  <CryptoIcon symbol={r.base} size={24} imageUrl={r.fav ? market.logoOf(r.base) : undefined} />
                  <Link to={r.to} className="ix-pair-name"><b>{r.symbol}</b><small>{r.name !== r.base ? `${r.name} · ` : ''}{r.products.join(' · ')}</small></Link>
                </div>
              </td>
              <td className="r ix-num">{formatPriceValue(r.price)}</td>
              <td className="r"><span className="ix-chg" data-dir={dir(r.change)}>{signed(r.change)}</span></td>
              <td className="c ix-hide-sm"><IxSpark points={r.spark} width={96} height={28} /></td>
              <td className="r ix-num ix-muted ix-hide-sm">{r.volume === null ? '—' : formatCompactUsd(r.volume)}</td>
              <td className="r ix-hide-xs"><Link className="ix-trade" to={r.to}>{t('home.markets.trade')}</Link></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <Link className="ix-table-foot" to="/markets">{t('home.markets.viewAll')}<ArrowRight size={15} aria-hidden="true" /></Link>
    </div>
  </section>;
}
