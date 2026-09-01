import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf, Lang } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';

interface Stats {
  lastPrice: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
}

/**
 * The terminal's ticker bar, built to the supplied reference's `.ticker-bar`
 * markup: a pair selector followed by six `.ticker-item`s — last price, 24h
 * change, high, low, base volume, quote volume — in that order, with the
 * reference's own sizes and colours (see TradeTerminal.css).
 *
 * Data is unchanged: live Kraken ticker figures, the same 3s poll as before.
 * Labels stay translated rather than hard-coded English, since the app ships
 * seven languages.
 */
export function TickerBar({ pair, onSelectPair }: { pair: string; onSelectPair?: () => void }) {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [baseAsset, quoteAsset] = pair.split('/');

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTicker(pair)
        .then((res) => {
          if (cancelled) return;
          const tk = res.ticker;
          setStats({
            lastPrice: parseFloat(tk.lastPrice),
            changePercent: parseChangePercent(tk.changePercent24h, pair),
            high24h: parseFloat(tk.high24h),
            low24h: parseFloat(tk.low24h),
            volume24h: parseFloat(tk.volume24h),
            quoteVolume24h: parseFloat(tk.quoteVolume24h),
          });
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pair]);

  const positive = (stats?.changePercent ?? 0) >= 0;
  const dir = positive ? 'up' : 'down';
  const num = (v: number, digits = 2) => v.toLocaleString(localeOf(lang), { maximumFractionDigits: digits });

  // The reference prints the change as an absolute move and a percentage.
  // The absolute move is derived from the same two live figures rather than
  // fetched separately, so it can never disagree with the percentage.
  const absoluteChange =
    stats !== null ? stats.lastPrice - stats.lastPrice / (1 + stats.changePercent / 100) : null;

  return (
    <div className="ticker-bar">
      <div
        className="pair-selector"
        role={onSelectPair ? 'button' : undefined}
        tabIndex={onSelectPair ? 0 : undefined}
        onClick={onSelectPair}
        onKeyDown={(e) => {
          if (onSelectPair && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelectPair();
          }
        }}
      >
        <span className="pair-name">{pair}</span>
        <span className="pair-arrow">▼</span>
      </div>

      <div className="ticker-item">
        <span className="label">{t('trade.lastPrice')}</span>
        <span className={`value price ${dir}`}>{stats ? num(stats.lastPrice) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('markets.change24h')}</span>
        <span className={`value ${dir}`}>
          {stats && absoluteChange !== null
            ? `${positive ? '+' : ''}${num(absoluteChange)} (${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%)`
            : '—'}
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.high24h')}</span>
        <span className="value">{stats ? num(stats.high24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.low24h')}</span>
        <span className="value">{stats ? num(stats.low24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${baseAsset})`}</span>
        <span className="value">{stats ? num(stats.volume24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${quoteAsset})`}</span>
        <span className="value">{stats ? compact(stats.quoteVolume24h, lang) : '—'}</span>
      </div>

      {/* The reference's right-hand cluster is a margin-mode chip and two
          icon buttons. Only the fullscreen one has anything real behind it
          on a spot terminal — cross-margin does not exist here, so a chip
          claiming "Cross 20x" would be decoration. */}
      <div className="ticker-actions">
        <button
          className="btn-icon"
          title={t('trade.fullscreen')}
          onClick={() => {
            const el = document.querySelector('.trade-terminal');
            if (!el) return;
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else el.requestFullscreen?.().catch(() => {});
          }}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}

function compact(n: number, lang: Lang): string {
  return n.toLocaleString(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 });
}
