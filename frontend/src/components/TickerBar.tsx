import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice, formatAmount, formatCompact } from '../lib/formatNumber';
import { krakenSocket, SocketStatus } from '../lib/krakenSocket';

// Spot trading is 0% on this exchange — the same figure the registration
// page and the marketing FAQ already state, and the same FEE_RATE the
// order form charges. Shown here because it is real, not because the
// space needed filling.
const SPOT_MAKER_FEE = 0;
const SPOT_TAKER_FEE = 0;

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
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [baseAsset, quoteAsset] = pair.split('/');
  // Real market status, from the same live feed the connection banner
  // watches — not a decorative "online" pill.
  const [socketStatus, setSocketStatus] = useState<SocketStatus>(krakenSocket.getStatus());

  useEffect(() => krakenSocket.subscribeStatus(setSocketStatus), []);

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
        <span className={`value price ${dir}`}>{stats ? formatPrice(stats.lastPrice) : '—'}</span>
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
            ? `${positive ? '+' : ''}${formatPrice(absoluteChange)} (${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%)`
            : '—'}
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.high24h')}</span>
        <span className="value">{stats ? formatPrice(stats.high24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.low24h')}</span>
        <span className="value">{stats ? formatPrice(stats.low24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${baseAsset})`}</span>
        <span className="value">{stats ? formatAmount(stats.volume24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${quoteAsset})`}</span>
        <span className="value">{stats ? formatCompact(stats.quoteVolume24h) : '—'}</span>
      </div>

      {/* Contextual instrument data, in the reference's own .spot-metrics
          slot at the end of this row.

          This page trades spot (and CFD in its own mode), so what belongs
          here is spot-specific: the real 0% maker/taker this exchange
          charges, and the live status of the market feed. There is
          deliberately NO funding rate, mark price or open interest — those
          are perpetual-contract figures and would be fabricated on a spot
          instrument. The futures terminal has its own ticker bar
          (FuturesTickerBar) and already shows the real funding rate there.

          Nothing else is added just to fill the space: this exchange has
          no per-market minimum order size, so no minimum is shown rather
          than inventing one. */}
      <div className="spot-metrics">
        <div>
          <span>{t('trade.makerFee')}</span>
          <strong>{SPOT_MAKER_FEE.toFixed(2)}%</strong>
        </div>
        <div>
          <span>{t('trade.takerFee')}</span>
          <strong>{SPOT_TAKER_FEE.toFixed(2)}%</strong>
        </div>
        <div>
          <span>{t('trade.marketStatus')}</span>
          <strong className={socketStatus === 'connected' ? 'live' : 'degraded'}>
            {socketStatus === 'connected' ? t('trade.marketLive') : t('trade.marketDelayed')}
          </strong>
        </div>
      </div>
    </div>
  );
}

