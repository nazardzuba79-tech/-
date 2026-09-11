import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, byVolume } from './useHomeMarket';
import { LiveValue } from './LiveValue';
import { useLanguage } from '../../lib/i18n';
import { homeLiveCopy } from './homeLiveCopy';

/** Two visual copies of the same received quotes; only one accessible link set.
 *  No requests, subscriptions or price simulation live in this component. */
export function HomeTicker({ market }: { market: HomeMarket }) {
  const { lang, t } = useLanguage();
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const rows = byVolume(market.tickers, 12);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const visible = () => node.dataset.hidden = String(document.hidden);
    visible();
    document.addEventListener('visibilitychange', visible);
    const observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => {
        node.dataset.offscreen = String(!entries.some(entry => entry.isIntersecting));
      }) : null;
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  const copy = homeLiveCopy[lang];

  return (
    <section ref={ref} aria-label={t('home.ticker.aria')} className="vx-market-tape"
      data-paused={paused} data-stale={market.tickersStale}>
      <div className="vx-tape-label">
        <span className={`vx-feed-dot ${market.tickersStale ? 'vx-feed-stale' : market.tickersStatus !== 'ok' ? 'vx-feed-neutral' : ''}`} aria-hidden="true" />
        <span>{market.tickersStale ? t('analytics.stale') : t('nav.markets')}</span>
        <span className="vx-tape-frequency" title={copy.refresh}>15s</span>
      </div>
      <div className="vx-tape-window">
        {rows.length === 0 ? (
          <div className="vx-tape-empty">
            {market.tickersStatus === 'loading' ? t('home.markets.loading') : t('home.marketDataUnavailable')}
          </div>
        ) : (
          <div className="vx-tape-track">
            {[false, true].map(copy => (
              <div key={String(copy)} className="vx-tape-group" aria-hidden={copy || undefined}>
                {rows.map(row => (
                  <Link key={row.pair} tabIndex={copy ? -1 : undefined}
                    to={`/trade?pair=${encodeURIComponent(row.pair)}`} className="vx-tape-quote">
                    <CryptoIcon symbol={row.base} size={24} imageUrl={market.logoOf(row.base)} />
                    <span className="vx-tape-instrument">
                      <span>{row.pair}</span>
                      <LiveValue value={row.price} className="vx-tape-price" />
                    </span>
                    <LiveValue value={row.change}
                      format={value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
                      className={row.change >= 0 ? 'text-up' : 'text-down'} />
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="vx-tape-toggle" aria-label={paused ? copy.resume : copy.pause}
        aria-pressed={paused} onClick={() => setPaused(value => !value)}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </section>
  );
}
