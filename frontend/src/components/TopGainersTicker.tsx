import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import { TOP_COINS } from '../lib/topCoins';

interface Item {
  /** Slash-separated, e.g. "BTC/USDT" — what onSelect gets called with. */
  pair: string;
  changePercent: number;
}
/** Strip of major-coin 24h movers, restricted to TOP_COINS (see that file's
 * comment on why it's a curated allowlist rather than a live market-cap
 * ranking) so this never surfaces an obscure microcap next to BTC/ETH.
 * Each item is clickable when `onSelect` is passed — it always receives the
 * slash-separated pair (e.g. "SOL/USDT"); the caller decides what "select"
 * means for its own page (switch the spot pair, switch the futures symbol,
 * or navigate away for a pair that page can't trade).
 *
 * `staticStrip` drops the marquee: no duplicated run of items and no
 * "HOT" badge, just one plain list of symbol + 24h change that the user
 * can scroll by hand. The trade terminal asks for this — a constantly
 * moving strip above a live chart and order book is motion competing with
 * the data a trader is actually reading. The animation itself is switched
 * off in CSS (see `.trade-terminal .ticker-track` in TradeTerminal.css);
 * the duplicate run has to go here, since without the animation it would
 * just render every symbol twice. */
export function TopGainersTicker({ onSelect, staticStrip }: { onSelect?: (pair: string) => void; staticStrip?: boolean }) {
  const { lang } = useLanguage();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          if (cancelled) return;
          const filtered = res.tickers
            .filter((tk) => tk.pair.endsWith('/USDT') && TOP_COINS.has(tk.pair.split('/')[0]))
            .map((tk) => ({
              pair: tk.pair,
              changePercent: parseChangePercent(tk.changePercent24h, tk.pair),
              quoteVolume24h: parseFloat(tk.quoteVolume24h || '0'),
            }))
            .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
            .slice(0, 24);
          setItems(filtered);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [lang]);

  const hottest = staticStrip || items.length === 0
    ? null
    : items.reduce((max, it) => (Math.abs(it.changePercent) > Math.abs(max.changePercent) ? it : max), items[0]);
  // Duplicated once so the CSS marquee can loop seamlessly from -50%.
  const loop = staticStrip ? items : [...items, ...items];

  return (
    <div className={`market-ticker${staticStrip ? ' market-ticker-static' : ''}`} aria-label="Market ticker">
      <div className="ticker-track">
        {loop.map((it, i) => {
          const positive = it.changePercent >= 0;
          const display = it.pair.replace('/', '');
          const content = (
            <>
              <strong>{display}</strong>
              <b className={positive ? 'positive' : 'negative'}>
                {positive ? '+' : ''}
                {it.changePercent.toFixed(2)}%
              </b>
              {it.pair === hottest?.pair && <span className="ticker-hot">HOT</span>}
            </>
          );
          return onSelect ? (
            <button
              key={`${it.pair}-${i}`}
              onClick={() => onSelect(it.pair)}
              className="ticker-item ticker-item-button"
            >
              {content}
            </button>
          ) : (
            <span key={`${it.pair}-${i}`} className="ticker-item">
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}
