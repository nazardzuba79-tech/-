import { FuturesTurnover } from './FuturesTurnover';
import { memo, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { FuturesMarketStats, GatewaySection } from '../lib/api';
import { useMarketTicker } from '../lib/useMarketData';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice, formatCompact } from '../lib/formatNumber';
import { useFuturesConfig } from '../lib/futuresConfigStore';

/**
 * The futures instrument row, on the same `.ticker-bar` / `.stat` system the
 * spot terminal uses — so switching Торговля -> Фьючерсы reads as the same
 * terminal rather than a second application.
 *
 * Order runs price -> market -> derivatives:
 *
 *   Last with Mark underneath, 24h change, High, Low, Turnover (quote),
 *   Open interest (base), Funding rate / Next funding.
 *   Index remains in the data flow, but is not a separate visible metric.
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
 * Futures-only styles reflow these blocks on narrow screens without
 * hiding metrics or changing the shared Spot ticker styles.
 */
export function FuturesTickerBar({ symbol, onSelectSymbol }: { symbol: string; onSelectSymbol?: () => void }) {
  const { t } = useLanguage();
  const [baseAsset, quoteAsset] = symbol.split('/');
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [indexPrice, setIndexPrice] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  /** From the one shared read of /futures/config — see
   *  lib/futuresConfigStore. `null` while unknown or after a failed read,
   *  which is what makes the countdown render "—" rather than a made-up
   *  interval, exactly as before. */
  const fundingIntervalHours = useFuturesConfig().config?.fundingIntervalHours ?? null;
  /**
   * Tracked external derivatives statistics — turnover and open interest.
   *
   * These are the two MARKET-REFERENCE figures in this header, and they
   * describe other venues' perpetual markets, not VOLTEX's book. Mark
   * price, funding and the countdown beside them stay VOLTEX's own and
   * are read from the futures services exactly as before.
   */
  const [derivatives, setDerivatives] = useState<GatewaySection<FuturesMarketStats> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Every figure below is re-read for the symbol currently selected, so
    // the whole row always describes one instrument — there is no path
    // where a stat is left over from the previously selected contract.
    setMarkPrice(null);
    setIndexPrice(null);
    setFundingRate(null);
    // Cleared on every symbol change, so BTC's turnover and open interest
    // can never sit under an ETH header while the new read is in flight.
    setDerivatives(null);

    // Everything in this loop is a VOLTEX financial value read from the
    // futures services, and is deliberately unchanged: mark price, the
    // index price and the settled funding rate. No external venue's
    // derivatives metric is read here, and none may substitute for these.
    //
    // VOLTEX's OWN open interest is no longer read here: the header's
    // "Open Interest" cell asks about the MARKET, and this venue's book
    // was never an answer to that question. `/futures/open-interest` and
    // its client method are untouched — internal risk and the Analytics
    // VOLTEX section still read them.
    function load() {
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

  useEffect(() => {
    let cancelled = false;
    setDerivatives(null);
    function load() {
      api
        .getFuturesMarketStats(baseAsset)
        .then((res) => {
          if (!cancelled) setDerivatives(res);
        })
        // A failed read leaves the previous value alone; the section's own
        // `available` flag is what decides whether a figure renders.
        .catch(() => {});
    }
    load();
    // Slower than the 4s VOLTEX loop on purpose: a rolling 24h turnover
    // and an open-interest snapshot do not move on that timescale, and
    // the server caches them for 15-30s anyway.
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [baseAsset]);

  const stats24h = derivatives?.available ? derivatives.value : null;

  // Reference spot ticker for this contract's underlying, from the shared
  // snapshot at the same 4s cadence this bar always used. A contract with
  // no matching reference ticker yields null and renders as a dash — never
  // a zero price, and never the previously selected contract's numbers,
  // because the lookup is keyed on the current symbol.
  const { ticker } = useMarketTicker(symbol, 4000);
  const stats: {
    lastPrice: number;
    changePercent: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    quoteVolume24h: number;
  } | null = ticker
    ? {
        lastPrice: parseFloat(ticker.lastPrice),
        changePercent: parseChangePercent(ticker.changePercent24h, symbol),
        high24h: parseFloat(ticker.high24h),
        low24h: parseFloat(ticker.low24h),
        volume24h: parseFloat(ticker.volume24h),
        quoteVolume24h: parseFloat(ticker.quoteVolume24h),
      }
    : null;

  const positive = (stats?.changePercent ?? 0) >= 0;
  const dir = positive ? 'up' : 'down';

  return (
    <div className="ticker-bar futures-ticker-bar">
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

      <div className="ticker-item futures-primary-price">
        <span className={`value price ${dir}`} aria-label={t('trade.lastPrice')}>{stats ? formatPrice(stats.lastPrice) : '—'}</span>
        <span className="futures-secondary-price">
          <span className="label">{t('futures.markPrice')}: </span>
          <span className="value">{markPrice !== null ? formatPrice(markPrice) : '—'}</span>
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.headerChange24h')}</span>
        <span className={`value change ${dir}`}>
          {stats ? `${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%` : '—'}
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.headerHigh24h')}</span>
        <span className="value">{stats ? formatPrice(stats.high24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.headerLow24h')}</span>
        <span className="value">{stats ? formatPrice(stats.low24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        {/* Derivatives-market turnover, not this exchange's own and no
            longer the spot quote volume that used to sit here, which
            described a different market entirely.

            NO SOURCE LINE, deliberately: the customer-facing terminal
            shows no upstream infrastructure. Provenance is not lost — the
            response still carries `turnoverVenues`, which admin
            diagnostics, logs and the test suite read. It simply does not
            reach the exchange's own UI.

            The label is the contract's QUOTE currency, which is the
            currency the figure is actually denominated in: these are
            USDT-margined perpetuals and the upstream figure is the
            quote-currency turnover, never a converted one. */}
        <span className="label">{`${t('futures.headerTurnover24h')} (${quoteAsset})`}</span>
        <FuturesTurnover pair={symbol} aggregate={stats24h?.turnover24hUsd ?? null} stale={Boolean(derivatives?.available && derivatives.stale)} />
      </div>
      <div className="ticker-item">
        {/* Derivatives-market open interest, in base units when the
            contributing venues reported base units. When none did, this
            falls back to the notional AND relabels, so the unit on screen
            is always the unit of the number. Units are never mixed.

            No source line here either, for the same reason as the cell
            above: the contributor lists stay in the payload and out of the
            customer-facing UI. */}
        {(() => {
          const base = stats24h?.openInterestBase ?? null;
          const notional = stats24h?.openInterestUsd ?? null;
          const showBase = base !== null;
          return (
            <>
              <span className="label">{`${t('futures.openInterest')} (${showBase ? baseAsset : quoteAsset})`}</span>
              <span className={`value${derivatives?.available && derivatives.stale ? ' is-stale' : ''}`}>
                {showBase
                  ? base.toLocaleString('en-US', { maximumSignificantDigits: 12 })
                  : notional !== null
                    ? formatCompact(notional)
                    : '—'}
              </span>
            </>
          );
        })()}
      </div>
      <div className="ticker-item futures-funding">
        <span className="label">{t('futures.headerFunding')}</span>
        <span className="futures-funding-values">
          <span className={`value ${fundingRate !== null && fundingRate < 0 ? 'down' : 'up'}`}>
            {fundingRate !== null ? `${(fundingRate * 100).toFixed(4)}%` : '—'}
          </span>
          <span className="label"> / </span>
          <NextFundingCountdown intervalHours={fundingIntervalHours} />
        </span>
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
