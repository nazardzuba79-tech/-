import { memo, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice, formatAmount, formatCompact } from '../lib/formatNumber';

/**
 * The futures instrument row, on the same `.ticker-bar` / `.stat` system the
 * spot terminal uses — so switching Торговля -> Фьючерсы reads as the same
 * terminal rather than a second application.
 *
 * Order runs price -> market -> derivatives:
 *
 *   Last, Mark, Index, 24h change, High, Low, Volume (base), Volume (quote),
 *   Open interest, Funding rate, Next funding.
 *
 * Funding sits at the end deliberately. It is important, but it is a
 * once-per-8h settlement, and putting it immediately after mark price
 * pushed the prices a trader reads continuously out to the right.
 *
 * Every figure is real:
 *
 * - Last / 24h stats come from the same ticker feed the spot bar uses.
 * - Mark and index price come from /futures/mark-price (MarkPriceService).
 * - Open interest is this exchange's own position book aggregated by
 *   /futures/open-interest. No external feed could report it, and a
 *   contract nobody has traded yet honestly reports zero.
 * - The funding rate is the latest settled FundingRateRecord.
 * - Next funding is derived, not invented: funding settles on UTC multiples
 *   of the backend's own FUNDING_INTERVAL_HOURS, which /futures/config
 *   reports, so the countdown is computed from that boundary rather than a
 *   made-up timer. If the config request fails the row shows "—".
 *
 * Still deliberately absent: long/short ratio and liquidation volume.
 * Nothing in this exchange's data model records either.
 *
 * `prio-2`/`prio-3` mark which stats may collapse on narrower desktops —
 * last, mark, index, 24h change and funding always stay. See the
 * .ticker-bar rules in TradeTerminal.css; nothing here ever scrolls
 * sideways.
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
  const [openInterest, setOpenInterest] = useState<{ size: number; value: number | null } | null>(null);
  const [fundingIntervalHours, setFundingIntervalHours] = useState<number | null>(null);

  useEffect(() => {
    api
      .getFuturesConfig()
      .then((c) => setFundingIntervalHours(c.fundingIntervalHours))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Every figure below is re-read for the symbol currently selected, so
    // the whole row always describes one instrument — there is no path
    // where a stat is left over from the previously selected contract.
    setStats(null);
    setMarkPrice(null);
    setIndexPrice(null);
    setFundingRate(null);
    setOpenInterest(null);

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
      api
        .getFuturesOpenInterest(symbol)
        .then((res) => {
          if (cancelled) return;
          setOpenInterest({
            size: parseFloat(res.openInterest),
            value: res.openInterestValue !== null ? parseFloat(res.openInterestValue) : null,
          });
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
        <span className="label">{t('futures.indexPrice')}</span>
        <span className="value">{indexPrice !== null ? formatPrice(indexPrice) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.change24h')}</span>
        <span className={`value change ${dir}`}>
          {stats ? `${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%` : '—'}
        </span>
      </div>
      <div className="ticker-item prio-3">
        <span className="label">{t('trade.high24h')}</span>
        <span className="value">{stats ? formatPrice(stats.high24h) : '—'}</span>
      </div>
      <div className="ticker-item prio-3">
        <span className="label">{t('trade.low24h')}</span>
        <span className="value">{stats ? formatPrice(stats.low24h) : '—'}</span>
      </div>
      <div className="ticker-item prio-3">
        <span className="label">{`${t('trade.volume24h')} (${baseAsset})`}</span>
        <span className="value">{stats ? formatAmount(stats.volume24h) : '—'}</span>
      </div>
      <div className="ticker-item prio-2">
        <span className="label">{`${t('trade.volume24h')} (${quoteAsset})`}</span>
        <span className="value">{stats ? formatCompact(stats.quoteVolume24h) : '—'}</span>
      </div>
      <div className="ticker-item prio-2">
        <span className="label">{t('futures.openInterest')}</span>
        <span className="value">
          {openInterest === null
            ? '—'
            : openInterest.value !== null
              ? formatCompact(openInterest.value)
              : `${formatAmount(openInterest.size)} ${baseAsset}`}
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.fundingRate')}</span>
        <span className={`value ${fundingRate !== null && fundingRate < 0 ? 'down' : 'up'}`}>
          {fundingRate !== null ? `${(fundingRate * 100).toFixed(4)}%` : '—'}
        </span>
      </div>
      <div className="ticker-item prio-2">
        <span className="label">{t('futures.nextFunding')}</span>
        <NextFundingCountdown intervalHours={fundingIntervalHours} />
      </div>
    </div>
  );
}

/**
 * Split out and memoised so the one-second tick repaints this single cell
 * instead of the whole instrument row — otherwise every price, volume and
 * funding figure above would re-render once a second for a clock.
 */
const NextFundingCountdown = memo(function NextFundingCountdown({ intervalHours }: { intervalHours: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalHours === null || intervalHours <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [intervalHours]);

  // Funding settles at every UTC multiple of the interval, so the next
  // boundary is a pure function of the clock — the same rule the backend's
  // msUntilNextFundingBoundary applies when it actually settles.
  if (intervalHours === null || intervalHours <= 0) return <span className="value">—</span>;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const total = Math.floor((intervalMs - (now % intervalMs)) / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return <span className="value">{`${hh}:${mm}:${ss}`}</span>;
});
