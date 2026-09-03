import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, byVolume, formatPriceValue } from './useHomeMarket';
import { useLanguage } from '../../lib/i18n';

/**
 * The market strip under the hero. Static — no marquee, no auto-scroll, no
 * horizontal scrollbar. It renders only the number of instruments that fit
 * the current width, measured from the real grid, so nothing is ever
 * clipped mid-cell and there is never anything to scroll to.
 *
 * Cells are fixed-width and figures are tabular, so a price going from
 * 4 digits to 5 cannot shift its neighbours.
 */
const CELL_MIN = 168;

export function HomeTicker({ market }: { market: HomeMarket }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(8);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const fits = Math.max(2, Math.floor(el.clientWidth / CELL_MIN));
      setCapacity(Math.min(fits, 8));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = byVolume(market.tickers, capacity);

  return (
    <section aria-label={t('home.ticker.aria')} className="mx-auto w-full max-w-[1460px] px-6">
      <div ref={ref} className="overflow-hidden rounded-[8px] border border-white/6 bg-ink-850">
        {market.tickersStatus === 'loading' && rows.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border-b border-r border-white/5 px-3.5 py-[11px] last:border-r-0 xl:border-b-0">
                <div className="h-[10px] w-14 animate-pulse rounded bg-white/6" />
                <div className="mt-2 h-[12px] w-20 animate-pulse rounded bg-white/6" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-[18px] text-[12px] text-faint">{t('home.marketDataUnavailable')}</div>
        ) : (
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, capacity)}, minmax(0, 1fr))` }}
          >
            {rows.map((t) => {
              const up = t.change >= 0;
              return (
                <Link
                  key={t.pair}
                  to={`/trade?pair=${encodeURIComponent(t.pair)}`}
                  className="flex items-center gap-2.5 border-r border-white/5 px-3.5 py-[11px] transition-colors duration-150 ease-out last:border-r-0 hover:bg-white/[0.03]"
                >
                  <CryptoIcon symbol={t.base} size={22} imageUrl={market.logoOf(t.base)} />
                  <div className="min-w-0 leading-tight tabular-nums">
                    <div className="truncate text-[10.5px] text-home-muted">{t.pair}</div>
                    <div className="font-mono text-[13px] font-medium text-white">{formatPriceValue(t.price)}</div>
                    <div className={`font-mono text-[10px] ${up ? 'text-up' : 'text-down'}`}>
                      {up ? '+' : ''}
                      {t.change.toFixed(2)}%
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
