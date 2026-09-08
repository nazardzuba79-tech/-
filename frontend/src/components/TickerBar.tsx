import { useLanguage } from '../lib/i18n';
import { useMarketTicker } from '../lib/useMarketData';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice, formatAmount, formatCompact } from '../lib/formatNumber';
import { formatSpotBookNumber } from '../lib/spotOrderBook';

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
 * Data is unchanged: live Kraken ticker figures, still refreshed on a 3s
 * cadence. What changed is where they come from — the shared market-data
 * store (lib/marketDataStore) instead of this component's own
 * `setInterval` + per-pair request. Every ticker consumer in the tab now
 * shares ONE poll and ONE request; adding this bar to a page no longer
 * adds a polling loop.
 *
 * Labels stay translated rather than hard-coded English, since the app ships
 * seven languages.
 */
export function TickerBar({ pair, onSelectPair, spotPrecision = false }: { pair: string; onSelectPair?: () => void; spotPrecision?: boolean }) {
  const { t } = useLanguage();
  const [baseAsset, quoteAsset] = pair.split('/');
  const displayPrice = spotPrecision ? formatSpotBookNumber : formatPrice;

  // 3s, the cadence this bar has always used. The store polls at the
  // fastest cadence any live subscriber asks for, so this stays as fresh
  // as before while costing the tab nothing extra.
  const { ticker } = useMarketTicker(pair, 3000);

  // A pair the snapshot does not carry stays null and renders as a dash.
  // It is never coerced to a zero price, and a failed poll keeps the last
  // known good figures on screen rather than blanking them — the store
  // holds the previous snapshot for exactly that reason.
  const stats: Stats | null = ticker
    ? {
        lastPrice: parseFloat(ticker.lastPrice),
        changePercent: parseChangePercent(ticker.changePercent24h, pair),
        high24h: parseFloat(ticker.high24h),
        low24h: parseFloat(ticker.low24h),
        volume24h: parseFloat(ticker.volume24h),
        quoteVolume24h: parseFloat(ticker.quoteVolume24h),
      }
    : null;

  const positive = (stats?.changePercent ?? 0) >= 0;
  const dir = positive ? 'up' : 'down';

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
        <span className={`value price ${dir}`}>{stats ? displayPrice(stats.lastPrice) : '—'}</span>
      </div>
      <div className="ticker-item">
        {/* "Изменение 24ч", not "24ч %" — this cell leads with the absolute
            move and only puts the percentage in brackets after it, so a
            percent-only label made "-817,48" read as if it were itself a
            percentage. The markets table's own column stays "24ч %"; it
            really does show only a percentage. */}
        <span className="label">{t('trade.change24h')}</span>
        <span className={`value change ${dir}`}>
          {stats && absoluteChange !== null
            ? `${positive ? '+' : ''}${displayPrice(absoluteChange)} (${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%)`
            : '—'}
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.high24h')}</span>
        <span className="value">{stats ? displayPrice(stats.high24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.low24h')}</span>
        <span className="value">{stats ? displayPrice(stats.low24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${baseAsset})`}</span>
        <span className="value">{stats ? formatAmount(stats.volume24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${quoteAsset})`}</span>
        <span className="value">{stats ? formatCompact(stats.quoteVolume24h) : '—'}</span>
      </div>

    </div>
  );
}
