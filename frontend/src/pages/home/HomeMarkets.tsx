import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, CreditCardIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { Sparkline } from '../../components/Sparkline';
import { HomeCryptoCard } from './HomeCryptoCard';
import { HomeMarket, HomeTicker, byVolume, formatPriceValue } from './useHomeMarket';
import { loadFavorites } from '../../lib/pairList';
import { Key, useLanguage } from '../../lib/i18n';

/** The futures contracts the backend guarantees are always listed — used
 *  only to split the Фьючерсы tab without a second config round-trip on a
 *  marketing page. */
const CORE_FUTURES = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

/** Tab id -> dictionary key. CFD has no key: it is a product name, not
 *  translated copy, and reads the same in every language the app ships. */
const TABS: { id: Tab; labelKey?: Key; label?: string }[] = [
  { id: 'favorites', labelKey: 'home.markets.tabFavorites' },
  { id: 'all', labelKey: 'home.markets.tabAll' },
  { id: 'spot', labelKey: 'trade.spotTab' },
  { id: 'futures', labelKey: 'nav.futures' },
  { id: 'cfd', label: 'CFD' },
];
type Tab = 'favorites' | 'all' | 'spot' | 'futures' | 'cfd';

export function HomeMarkets({ market }: { market: HomeMarket }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('all');
  // Same favourites store the trading terminal writes, so a visitor who
  // starred pairs in the app sees them here.
  const favorites = useMemo(() => loadFavorites(), []);

  const rows: HomeTicker[] = useMemo(() => {
    const spot = byVolume(market.tickers, 60);
    switch (tab) {
      case 'favorites':
        return spot.filter((r) => favorites.has(r.pair)).slice(0, 8);
      case 'futures':
        return spot.filter((r) => CORE_FUTURES.includes(r.pair)).slice(0, 8);
      case 'cfd':
        return [];
      default:
        return spot.slice(0, 8);
    }
  }, [market.tickers, tab, favorites]);

  return (
    <section className="mx-auto w-full max-w-[1460px] px-6">
      <h2 className="mb-4 text-[21px] font-semibold tracking-[-0.01em] text-white">{t('home.markets.title')}</h2>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
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
                      {tab === 'cfd'
                        ? t('home.cfdSoon')
                        : tab === 'favorites'
                          ? t('home.markets.noFavorites')
                          : market.tickersStatus === 'loading'
                            ? t('home.markets.loading')
                            : t('home.marketDataUnavailable')}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const up = r.change >= 0;
                    return (
                      <tr
                        key={r.pair}
                        className="border-b border-white/5 transition-colors duration-150 ease-out last:border-b-0 hover:bg-white/[0.03]"
                      >
                        <td className="px-4 py-[11px]">
                          <div className="flex items-center gap-2.5">
                            <CryptoIcon symbol={r.base} size={24} imageUrl={market.logoOf(r.base)} />
                            <span className="leading-tight">
                              <span className="block text-[12.5px] font-medium text-white">{r.pair}</span>
                              <span className="block text-[10.5px] text-faint">{r.base}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-[11px] text-right font-mono text-[12.5px] tabular-nums text-white">
                          {formatPriceValue(r.price)}
                        </td>
                        <td
                          className={`px-2 py-[11px] text-right font-mono text-[12.5px] tabular-nums ${up ? 'text-up' : 'text-down'}`}
                        >
                          {up ? '+' : ''}
                          {r.change.toFixed(2)}%
                        </td>
                        <td className="hidden px-2 py-[11px] sm:table-cell">
                          <div className="mx-auto w-[74px]">
                            {/* Sparkline colours itself from its own first
                                and last point, which matches the row's 24h
                                direction because sparkFor drifts by it. */}
                            <Sparkline points={sparkFor(r)} width={74} height={24} />
                          </div>
                        </td>
                        <td className="hidden px-2 py-[11px] text-right font-mono text-[12.5px] tabular-nums text-white/85 sm:table-cell">
                          {r.quoteVolume >= 1e9
                            ? `$${(r.quoteVolume / 1e9).toFixed(2)}B`
                            : `$${(r.quoteVolume / 1e6).toFixed(1)}M`}
                        </td>
                        <td className="px-4 py-[11px] text-right">
                          {/* Real routing: the same ?pair= the terminal reads. */}
                          <Link
                            to={`/trade?pair=${encodeURIComponent(r.pair)}`}
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

        {/* Secondary card panel — deliberately not animated, leaving the
            main card section as the page's single moving reflection. */}
        <aside className="relative flex flex-col overflow-hidden rounded-[8px] border border-white/6 bg-ink-850 p-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_80%_35%,rgba(224,169,63,0.12),transparent_70%)]"
          />
          <div className="relative flex h-full flex-col">
            <h3 className="text-[19px] font-semibold text-white">{t('home.card.name')}</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-home-muted">
              {t('home.card.asideText')}
            </p>
            <div className="my-6 ml-auto">
              <HomeCryptoCard width={200} glow={false} />
            </div>
            <div className="mt-auto flex gap-2.5">
              <span className="flex flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-white/10 bg-ink-800 py-[9px] text-[12px] font-medium text-white">
                Apple Pay
              </span>
              <span className="flex flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-white/10 bg-ink-800 py-[9px] text-[12px] font-medium text-home-muted">
                <CreditCardIcon size={13} /> NFC
              </span>
            </div>
            <Link
              to="/card"
              className="mt-3 flex items-center justify-center gap-2 rounded-[6px] bg-gold-500 py-[10px] text-[13px] font-semibold text-ink-950 transition-colors duration-150 ease-out hover:bg-gold-400 active:translate-y-[1px]"
            >
              {t('home.cta.getCard')}
              <ArrowRightIcon size={14} />
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}

/**
 * A deterministic 7-point shape derived from the row's own 24h change, so
 * the sparkline's direction always agrees with the number beside it. The
 * exchange has no 7-day series on this endpoint, so this is presented as
 * the trend glyph it is rather than being labelled as history.
 */
function sparkFor(r: HomeTicker): number[] {
  const drift = r.change / 100;
  let seed = r.pair.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: 7 }, (_, i) => 1 + (drift * i) / 6 + (rand() - 0.5) * 0.02);
}
