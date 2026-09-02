import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice, formatAmount, formatCompact } from '../lib/formatNumber';

/**
 * The futures instrument row, on the same `.ticker-bar` / `.stat` system the
 * spot terminal uses — so switching Торговля -> Фьючерсы reads as the same
 * terminal rather than a second application.
 *
 * What differs is the content, not the chrome. The hierarchy is:
 *
 *   primary     Last price (the .price stat)
 *   derivatives Mark price, Funding rate, Next funding
 *   secondary   Index price, 24h change/high/low/volume
 *
 * Every figure is real:
 *
 * - Last / 24h stats come from the same ticker feed the spot bar uses.
 * - Mark and index price come from /futures/mark-price (MarkPriceService).
 * - The funding rate is the latest settled FundingRateRecord.
 * - Next funding is derived, not invented: funding settles on UTC multiples
 *   of the backend's own FUNDING_INTERVAL_HOURS, which /futures/config now
 *   reports, so the countdown is computed from that boundary rather than a
 *   made-up timer. If the config request fails the row shows "—".
 *
 * Deliberately absent: open interest, long/short ratio and liquidation
 * volume. Nothing in this exchange's data model records them, and a
 * plausible-looking number in a derivatives header is worse than an honest
 * omission — see the note in FuturesPage.
 */
export function FuturesTickerBar({ symbol, onSelectSymbol }: { symbol: string; onSelectSymbol?: () => void }) {
  const { t } = useLanguage();
  const [baseAsset, quoteAsset] = symbol.split('/');
  const [stats, setStats] = useState<{
    lastPrice: number;
    changePercent: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    quoteVolume24h: number;
  } | null>(null);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [indexPrice, setIndexPrice] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [fundingIntervalHours, setFundingIntervalHours] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api
      .getFuturesConfig()
      .then((c) => setFundingIntervalHours(c.fundingIntervalHours))
      .catch(() => {});
  }, []);

  // Ticks the countdown only — the market data below keeps its own 4s poll.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTicker(symbol)
        .then((res) => {
          if (cancelled) return;
          const tk = res.ticker;
          setStats({
            lastPrice: parseFloat(tk.lastPrice),
            changePercent: parseChangePercent(tk.changePercent24h, symbol),
            high24h: parseFloat(tk.high24h),
            low24h: parseFloat(tk.low24h),
            volume24h: parseFloat(tk.volume24h),
            quoteVolume24h: parseFloat(tk.quoteVolume24h),
          });
        })
        .catch(() => {});
      api
        .getFuturesMarkPrice(symbol)
        .then((res) => {
          if (cancelled) return;
          setMarkPrice(parseFloat(res.markPrice));
          setIndexPrice(parseFloat(res.indexPrice));
        })
        .catch(() => {});
      api
        .getFuturesFundingRate(symbol, 1)
        .then((res) => {
          if (cancelled) return;
          const latest = res.history[0];
          setFundingRate(latest ? parseFloat(latest.rate) : null);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  const positive = (stats?.changePercent ?? 0) >= 0;
  const dir = positive ? 'up' : 'down';

  // Funding settles at every UTC multiple of the interval, so the next
  // boundary is a pure function of the clock — the same rule the backend's
  // msUntilNextFundingBoundary applies when it actually settles.
  const nextFunding = (() => {
    if (fundingIntervalHours === null || fundingIntervalHours <= 0) return null;
    const intervalMs = fundingIntervalHours * 60 * 60 * 1000;
    const msLeft = intervalMs - (now % intervalMs);
    const total = Math.floor(msLeft / 1000);
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  })();

  return (
    <div className="ticker-bar">
      <div
        className="pair-selector"
        role={onSelectSymbol ? 'button' : undefined}
        tabIndex={onSelectSymbol ? 0 : undefined}
        onClick={onSelectSymbol}
        onKeyDown={(e) => {
          if (onSelectSymbol && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelectSymbol();
          }
        }}
      >
        <span className="pair-name">{symbol}</span>
        <span className="pair-arrow">▼</span>
      </div>

      <div className="ticker-item">
        <span className="label">{t('trade.lastPrice')}</span>
        <span className={`value price ${dir}`}>{stats ? formatPrice(stats.lastPrice) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.markPrice')}</span>
        <span className="value">{markPrice !== null ? formatPrice(markPrice) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.fundingRate')}</span>
        <span className={`value ${fundingRate !== null && fundingRate < 0 ? 'down' : 'up'}`}>
          {fundingRate !== null ? `${(fundingRate * 100).toFixed(4)}%` : '—'}
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.nextFunding')}</span>
        <span className="value">{nextFunding ?? '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.indexPrice')}</span>
        <span className="value">{indexPrice !== null ? formatPrice(indexPrice) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.change24h')}</span>
        <span className={`value change ${dir}`}>
          {stats ? `${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%` : '—'}
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
    </div>
  );
}
