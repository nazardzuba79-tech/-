import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { Sparkline } from '../../components/Sparkline';
import { HomeMarket, HomeTicker, byVolume, formatPriceValue } from './useHomeMarket';
import { useFavorites } from '../../lib/useFavorites';
import { Key, useLanguage } from '../../lib/i18n';

const TABS: { id: Tab; labelKey?: Key; label?: string }[] = [
  { id: 'favorites', labelKey: 'home.markets.tabFavorites' },
  { id: 'all', labelKey: 'home.markets.tabAll' },
  { id: 'spot', labelKey: 'trade.spotTab' },
  { id: 'futures', labelKey: 'nav.futures' },
  { id: 'cfd', label: 'CFD' },
];
type Tab = 'favorites' | 'all' | 'spot' | 'futures' | 'cfd';
const ROWS_PER_TAB = 8;

interface Row {
  key: string;
  symbol: string;
  base: string;
  price: number;
  change: number;
  quoteVolume: number | null;
  products: string[];
  to: string;
  historyKey: string;
  historyKind: 'spot' | 'cfd';
}

function spotRow(t: HomeTicker, label: (k: Key) => string, extraProducts: string[] = []): Row {
  return {
    key: t.pair,
    symbol: t.pair,
    base: t.base,
    price: t.price,
    change: t.change,
    quoteVolume: t.quoteVolume,
    products: [label('trade.spotTab'), ...extraProducts],
    to: `/trade?pair=${encodeURIComponent(t.pair)}`,
    historyKey: t.pair,
    historyKind: 'spot',
  };
}

function futuresRow(t: HomeTicker, label: (k: Key) => string): Row {
  return {
    key: `perp:${t.pair}`,
    symbol: t.pair,
    base: t.base,
    price: t.price,
    change: t.change,
    quoteVolume: t.quoteVolume,
    products: [label('nav.futures')],
    to: `/futures?pair=${encodeURIComponent(t.pair)}`,
    historyKey: t.pair,
    historyKind: 'spot',
  };
}

export function HomeMarkets({ market }: { market: HomeMarket }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('all');
  const { favorites } = useFavorites();

  const spot = useMemo(() => byVolume(market.tickers, 60), [market.tickers]);
  const tickerByPair = useMemo(() => new Map(spot.map((r) => [r.pair, r])), [spot]);
  const futures = useMemo(
    () => market.futuresSymbols.map((s) => tickerByPair.get(s)).filter((x): x is HomeTicker => !!x),
    [market.futuresSymbols, tickerByPair]
  );

  const cfd = useMemo<Row[]>(() => {
    if (!market.cfd?.configured) return [];
    return market.cfd.tickers.map((c) => {
      const change = Number(c.changePercent24h);
      return {
        key: `cfd:${c.symbol}`,
        symbol: c.symbol,
        base: c.symbol.slice(0, 3),
        price: Number(c.price),
        change: Number.isFinite(change) ? change : 0,
        quoteVolume: null,
        products: ['CFD'],
        to: `/trade?market=cfd&symbol=${encodeURIComponent(c.symbol)}`,
        historyKey: c.symbol,
        historyKind: 'cfd' as const,
      };
    });
  }, [market.cfd]);

  const rows: Row[] = useMemo(() => {
    switch (tab) {
      case 'favorites':
        return spot.filter((r) => favorites.has(r.pair)).slice(0, ROWS_PER_TAB).map((r) => spotRow(r, t));
      case 'spot':
        return spot.slice(0, ROWS_PER_TAB).map((r) => spotRow(r, t));
      case 'futures':
        return futures.slice(0, ROWS_PER_TAB).map((r) => futuresRow(r, t));
      case 'cfd':
        return cfd.slice(0, ROWS_PER_TAB);
      case 'all':
      default: {
        const perp = new Set(futures.map((f) => f.pair));
        const merged: Row[] = spot.map((r) => spotRow(r, t, perp.has(r.pair) ? [t('nav.futures')] : []));
        const spotPairs = new Set(spot.map((r) => r.pair));
        for (const f of futures) if (!spotPairs.has(f.pair)) merged.push(futuresRow(f, t));
        return [...merged, ...cfd].slice(0, ROWS_PER_TAB);
      }
    }
  }, [tab, spot, futures, cfd, favorites, t]);

  function emptyMessage(): string {
    if (tab === 'favorites') return t('home.markets.noFavorites');
    if (tab === 'cfd') {
      if (market.cfdStatus === 'loading') return t('home.markets.loading');
      if (market.cfd && !market.cfd.configured) return t('home.markets.cfdNotConfigured');
      return t('home.marketDataUnavailable');
    }
    if (tab === 'futures') {
      if (market.futuresStatus === 'loading' || market.tickersStatus === 'loading') return t('home.markets.loading');
      return t('home.marketDataUnavailable');
    }
    return market.tickersStatus === 'loading' ? t('home.markets.loading') : t('home.marketDataUnavailable');
  }

  return (
    <section className="mx-auto w-full max-w-[1460px] px-6">
      <h2 className="mb-4 text-[21px] font-semibold tracking-[-0.01em] text-white">{t('home.markets.title')}</h2>

      <div className="overflow-hidden rounded-[8px] border border-white/6 bg-ink-850">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/6 px-3 py-2.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-md px-3 py-[6px] text-[12px] font-medium transition-colors duration-150 ${
                tab === item.id ? 'bg-white/[0.08] text-white' : 'text-home-muted hover:text-white'
              }`}
            >
              {item.labelKey ? t(item.labelKey) : item.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-white/6 text-left text-[11px] text-faint">
                <th scope="col" className="px-4 py-2 font-normal">{t('markets.pair')}</th>
                <th scope="col" className="px-2 py-2 text-right font-normal">{t('markets.price')}</th>
                <th scope="col" className="px-2 py-2 text-right font-normal">{t('trade.change24h')}</th>
                <th scope="col" className="hidden px-2 py-2 text-center font-normal sm:table-cell">{t('home.markets.chart')}</th>
                <th scope="col" className="hidden px-2 py-2 text-right font-normal sm:table-cell">{t('trade.volume24h')}</th>
                <th scope="col" className="px-4 py-2 text-right font-normal">{t('trade.action')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[12px] text-faint">
                    {emptyMessage()}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const up = r.change >= 0;
                  const history = r.historyKind === 'cfd'
                    ? market.cfdPriceHistory?.[r.historyKey]
                    : market.priceHistory[r.historyKey];
                  const spark = history && history.length >= 2 ? history : null;
                  return (
                    <tr
                      key={r.key}
                      className="border-b border-white/5 transition-colors duration-150 ease-out last:border-b-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-[11px]">
                        <div className="flex items-center gap-2.5">
                          <CryptoIcon symbol={r.base} size={24} imageUrl={market.logoOf(r.base)} />
                          <span className="leading-tight">
                            <span className="block text-[12.5px] font-medium text-white">{r.symbol}</span>
                            <span className="block text-[10.5px] text-faint">{r.products.join(' · ')}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-[11px] text-right font-mono text-[12.5px] tabular-nums text-white">
                        {formatPriceValue(r.price)}
                      </td>
                      <td className={`px-2 py-[11px] text-right font-mono text-[12.5px] tabular-nums ${up ? 'text-up' : 'text-down'}`}>
                        {up ? '+' : ''}{r.change.toFixed(2)}%
                      </td>
                      <td className="hidden px-2 py-[11px] sm:table-cell">
                        <div className="mx-auto w-[74px]">
                          {spark
                            ? <Sparkline points={spark} width={74} height={24} />
                            : <span className="block text-center text-[11px] text-faint">—</span>}
                        </div>
                      </td>
                      <td className="hidden px-2 py-[11px] text-right font-mono text-[12.5px] tabular-nums text-white/85 sm:table-cell">
                        {r.quoteVolume === null
                          ? '—'
                          : r.quoteVolume >= 1e9
                            ? `$${(r.quoteVolume / 1e9).toFixed(2)}B`
                            : `$${(r.quoteVolume / 1e6).toFixed(1)}M`}
                      </td>
                      <td className="px-4 py-[11px] text-right">
                        <Link
                          to={r.to}
                          className="inline-block rounded-[6px] border border-white/10 bg-white/[0.04] px-3 py-[6px] text-[11.5px] font-medium text-white transition-colors duration-150 ease-out hover:border-gold-500/50 hover:text-gold-400 active:translate-y-[1px]"
                        >
                          {t('home.markets.trade')}
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-white/6 py-3 text-center">
          <Link
            to="/markets"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-gold-400 transition-colors duration-150 hover:text-gold-500"
          >
            {t('home.markets.viewAll')}
            <ArrowRightIcon size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}
