import { FuturesTurnover } from './FuturesTurnover';
import { memo, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { FuturesMarketStats, GatewaySection } from '../lib/api';
import { useFuturesReference } from '../lib/useFuturesReference';
import { referenceNumber } from '../lib/futuresReference';
import { useLanguage } from '../lib/i18n';
import { formatPrice, formatCompact } from '../lib/formatNumber';
import { useFuturesConfig } from '../lib/futuresConfigStore';
import { List as ListIcon } from 'lucide-react';
import { CryptoIcon } from './CryptoIcon';
import { useAssetMetadata } from '../lib/assetMetadataStore';

/**
 * The futures instrument row, on the same `.ticker-bar` / `.stat` system the
 * spot terminal uses — so switching Торговля -> Фьючерсы reads as the same
 * terminal rather than a second application.
 *
 * Order runs price -> market -> derivatives:
 *
 *   Last with Mark and Index underneath, 24h change, High, Low,
 *   Turnover (quote), Open interest (base), Funding rate / Next funding,
 *   and the calculator trigger pinned to the right edge.
 *
 * Index used to be fetched and then dropped — in the data flow, not on the
 * strip. It is shown now because a mark price quoted without the index it
 * is anchored to cannot be judged: the gap between the two is the whole
 * question a perpetual trader is asking when they look at either. It
 * shares the price block with the mark rather than taking a cell of its
 * own, because the strip has no room for a ninth labelled cell — measured,
 * not guessed: as one it pushed funding 100px past the right edge at 1366.
 * Nothing new is fetched for it; it arrives on the same
 * /futures/mark-price response the mark does.
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
export function FuturesTickerBar({ symbol, onSelectSymbol, marketsOpen = false, archive = false, onOpenCalculator }:
  { symbol: string; onSelectSymbol?: () => void; marketsOpen?: boolean; archive?: boolean; onOpenCalculator?: () => void }) {
  const { t } = useLanguage();
  const [baseAsset, quoteAsset] = symbol.split('/');
  /**
   * The instrument's own name, for the line under the pair.
   *
   * The reference puts "Bitcoin" under "BTCUSDT", and this is where that
   * name comes from: the same catalogue the market list and the icons read,
   * through the same batched store — `CryptoIcon` below already asks for
   * this symbol, and the store coalesces both asks into ONE request inside
   * its 50ms window, so the caption costs no extra network.
   *
   * A symbol the catalogue does not cover is simply absent, and the caption
   * renders nothing rather than a guess. Its line keeps its height either
   * way (see `.pair-asset`), so nothing shifts when the name arrives.
   */
  const assetName = useAssetMetadata([baseAsset])[baseAsset.toUpperCase()]?.name ?? null;
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

  const ticker = useFuturesReference().get(symbol);
  const stats: {
    lastPrice: number;
    changePercent: number | null;
    high24h: number | null;
    low24h: number | null;
  } | null = ticker
    ? {
        lastPrice: ticker.lastPrice!,
        changePercent: referenceNumber(ticker.changePercent24h),
        high24h: referenceNumber(ticker.high24h),
        low24h: referenceNumber(ticker.low24h),
      }
    : null;

  /**
   * The 24h move in QUOTE currency, beside the percent — `+387.10 (+0.87%)`.
   *
   * DERIVED, not invented, and not a second source of truth. The feed
   * publishes the last price and the 24h percent but no previous close
   * (`LiveQuote` has no such field, and the collector does not carry Bybit's
   * `prevPrice24h`), so the open is recovered by exact algebra from the two
   * figures that ARE published:
   *
   *   open = last / (1 + p/100)   =>   last - open = last * p / (100 + p)
   *
   * It is therefore the same number the provider's own absolute change is,
   * to the precision of the percent it publishes — no extra request and no
   * second definition of "24h change" that could disagree with the percent
   * printed next to it.
   *
   * Null whenever it cannot be computed honestly: no percent, a
   * non-finite last price, or a -100% move, where the open is zero and the
   * division is undefined. The percent still renders on its own then.
   */
  const absoluteChange24h = (() => {
    const percent = stats?.changePercent ?? null;
    const last = stats?.lastPrice ?? null;
    if (percent === null || last === null || !Number.isFinite(last)) return null;
    const denominator = 100 + percent;
    if (denominator === 0) return null;
    const move = (last * percent) / denominator;
    return Number.isFinite(move) ? move : null;
  })();

  const positive = (stats?.changePercent ?? 0) >= 0;
  const dir = positive ? 'up' : 'down';

  return (
    <div className="ticker-bar futures-ticker-bar">
      {/* Two ways in, on purpose. The caret on the pair is the one this
          terminal always had; a trader who has not met it reads the pair as
          a label, not a control. The list glyph beside it is the affordance
          the reference terminal leads with, and it is unmistakably a button.
          Both do the same thing — open the market list with its search
          focused — so neither is a second code path. */}
      {/* ONE compositional node, as in the reference: the list button, the
          instrument's artwork and its name stack sit inside a single
          container rather than as three loose children of the header's
          flex row. That is the whole difference between "elements on a
          line" and a block — the gaps inside the cluster are its own, and
          the header's much larger gap now falls only BETWEEN the cluster
          and the first statistic. */}
      <div className="pair-cluster">
      {onSelectSymbol && (
        <button
          type="button"
          className="pair-markets-btn"
          /* `data-market-entry` is how the page's outside-click handler
             recognises the two entry points. Without it, pressing the
             button that opened the chooser closed it on pointerdown and
             re-opened it on click, so it could never be shut from the
             control that opened it. */
          data-market-entry
          aria-label={t('nav.markets')}
          title={t('nav.markets')}
          aria-expanded={marketsOpen}
          onClick={onSelectSymbol}
        >
          <ListIcon size={16} />
        </button>
      )}
      <div
        className="pair-selector"
        data-market-entry={onSelectSymbol ? '' : undefined}
        role={onSelectSymbol ? 'button' : undefined}
        tabIndex={onSelectSymbol ? 0 : undefined}
        aria-expanded={onSelectSymbol ? marketsOpen : undefined}
        onClick={onSelectSymbol}
        onKeyDown={(e) => {
          if (onSelectSymbol && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelectSymbol();
          }
        }}
      >
        {/* The instrument's own artwork, resolved by the same component the
            market list uses, so the identity block reads as one unit:
            logo + pair + the selector's caret. */}
        <CryptoIcon symbol={baseAsset} size={archive ? 24 : 28} />
        {/* Pair over asset name, the reference's two-line identity. The
            stack is what lets the artwork grow: at 28px a single line of
            text beside it reads as under-weighted, and two do not. */}
        <span className="pair-identity">
          <span className="pair-name">{symbol}{archive && <small className="archive-perpetual">{t('futures.perpetual')}</small>}</span>
          <span className="pair-asset">{archive ? `${assetName ?? baseAsset} ${quoteAsset}` : assetName}</span>
        </span>
        <span className="pair-arrow" aria-hidden="true" />
      </div>
      </div>

      <div className={archive ? 'archive-ticker-metrics' : undefined} style={archive ? undefined : { display: 'contents' }}>
      <div className="ticker-item futures-primary-price">
        <span className={`value price ${dir}`} aria-label={t('trade.lastPrice')}>{stats ? formatPrice(stats.lastPrice) : '—'}{archive && stats?.changePercent != null && <span className="archive-price-direction" aria-hidden="true">{positive ? ' ↑' : ' ↓'}</span>}</span>
        {/* Mark price, as the number alone. The label is dropped from the
            face of the terminal — the figure directly under the last price
            is the mark everywhere this design is used — but it stays in the
            accessible name, so the cell is still self-describing to a
            screen reader. */}
        {archive ? <span className={`archive-price-change ${dir}`} title={t('futures.headerChange24h')}>
          {stats?.changePercent != null ? `${absoluteChange24h !== null ? `${positive ? '+' : ''}${formatPrice(absoluteChange24h)} ` : ''}(${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%)` : '—'}
        </span> : (<span className="futures-secondary-price">
          <span className="value" title={t('futures.markPrice')} aria-label={t('futures.markPrice')}>
            {markPrice !== null ? formatPrice(markPrice) : '—'}
          </span>
          <span className="futures-price-sep" aria-hidden="true">·</span>
          <span className="value" data-metric="index" title={t('futures.indexPrice')} aria-label={t('futures.indexPrice')}>
            {indexPrice !== null ? formatPrice(indexPrice) : '—'}
          </span>
        </span>)}
      </div>
      {archive ? <div className="ticker-item archive-index-mark">
        <span className="label">{t('futures.markPrice')} / {t('futures.indexPrice')}</span>
        <span className="value archive-mark-index"><span aria-label={t('futures.markPrice')}>{markPrice !== null ? formatPrice(markPrice) : '—'}</span><span aria-hidden="true"> / </span><span data-metric="index" aria-label={t('futures.indexPrice')}>{indexPrice !== null ? formatPrice(indexPrice) : '—'}</span></span>
      </div> : <div className="ticker-item">
        <span className="label">{t('futures.headerChange24h')}</span>
        <span className={`value change ${dir}`}>
          {stats?.changePercent != null
            ? `${absoluteChange24h !== null ? `${positive ? '+' : ''}${formatPrice(absoluteChange24h)} ` : ''}(${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%)`
            : '—'}
        </span>
      </div>}
      <div className="ticker-item">
        <span className="label">{t('futures.headerHigh24h')}</span>
        <span className="value">{stats?.high24h != null ? formatPrice(stats.high24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('futures.headerLow24h')}</span>
        <span className="value">{stats?.low24h != null ? formatPrice(stats.low24h) : '—'}</span>
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
        <FuturesTurnover pair={symbol} aggregate={stats24h?.turnover24hUsd ?? null} stale={Boolean(derivatives?.available && derivatives.stale)} fullPrecision={archive} />
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
      {onOpenCalculator ? (
        <button
          type="button"
          className="ticker-calc-btn"
          data-open-calculator="true"
          onClick={onOpenCalculator}
          title={t('calc.title')}
          aria-label={t('calc.title')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v4M8 19h4" />
          </svg>
          <span className="ticker-calc-label">{t('calc.open')}</span>
        </button>
      ) : null}
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
