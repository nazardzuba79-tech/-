import { useMemo } from 'react';
import { LogoMark } from '../../components/Logo';
import { CryptoIcon } from '../../components/CryptoIcon';
import { HomeMarket, HomeCandle, formatPriceValue, formatCompactUsd } from './useHomeMarket';
import { Key, localeOf, useLanguage } from '../../lib/i18n';
import { LiveValue } from './LiveValue';
import { homeLiveCopy } from './homeLiveCopy';
import { globalHeroCopy } from './globalHeroCopy';

const MINI_NAV: Key[] = ['nav.markets', 'nav.trade', 'nav.futures', 'nav.copyTrading'];
const quantity = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 6 });
const receivedValue = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) ? Number(value) : undefined;

/** Real external depth, normalized only to draw proportional background bars. */
function OrderBookRows({ rows, side, maximum }: {
  rows: { price: string; quantity: string }[]; side: 'ask' | 'bid'; maximum: number;
}) {
  return <>{rows.map(row => (
    <div key={row.price} className={`vx-book-row vx-book-${side}`}>
      <span className="vx-book-depth" style={{ width: `${(receivedValue(row.quantity) ?? 0) / (maximum || 1) * 100}%` }} />
      <LiveValue value={receivedValue(row.price)} />
      <LiveValue value={receivedValue(row.quantity)} format={quantity} />
    </div>
  ))}</>;
}

/** A tiny SVG renderer for received OHLC values, without a chart framework. */
function PreviewCandles({ candles, label, livePrice }: { candles: HomeCandle[]; label: string; livePrice?: number }) {
  const min = Math.min(...candles.map(candle => candle.low), livePrice ?? Infinity);
  const max = Math.max(...candles.map(candle => candle.high), livePrice ?? -Infinity);
  const padding = Math.max((max - min) * 0.12, max * 0.00001, 1e-8);
  const low = min - padding;
  const span = max - min + padding * 2;
  const y = (price: number) => 174 - ((price - low) / span) * 158;
  const step = 540 / candles.length;
  const last = candles[candles.length - 1];
  const volumeMax = Math.max(0, ...candles.map(candle => receivedValue(candle.volume) ?? 0));
  const timeIndices = [...new Set([0, Math.floor((candles.length - 1) / 2), candles.length - 1])];
  const timeLabel = (time: number) => new Date(time < 1e12 ? time * 1000 : time)
    .toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <svg viewBox="0 0 600 240" preserveAspectRatio="none" role="img" aria-label={label} className="vx-real-candles">
      {[0.2, 0.4, 0.6, 0.8].map(fraction => {
        const price = low + span * fraction;
        return <g key={fraction}>
          <line x1="0" y1={y(price)} x2="548" y2={y(price)} className="vx-chart-grid" />
          <text x="598" y={y(price) + 3} textAnchor="end">{formatPriceValue(price)}</text>
        </g>;
      })}
      {candles.map((candle, i) => {
        const x = 4 + i * step + step / 2;
        const up = candle.close >= candle.open;
        const volume = receivedValue(candle.volume);
        const volumeHeight = volume !== undefined && volume >= 0 && volumeMax > 0 ? volume / volumeMax * 29 : 0;
        return <g key={candle.time} className={up ? 'vx-candle-up' : 'vx-candle-down'}>
          <line className="vx-candle-wick" x1="0" y1="0" x2="0" y2="1" vectorEffect="non-scaling-stroke"
            style={{ transform: `translate(${x}px, ${y(candle.high)}px) scaleY(${Math.max(.65, y(candle.low)-y(candle.high))})` }} />
          <rect x={x - step * 0.28} y={y(Math.max(candle.open, candle.close))}
            width={step * 0.56} height={Math.max(0.65, Math.abs(y(candle.open) - y(candle.close)))} />
          {volume !== undefined && volume >= 0 && <rect className="vx-candle-volume" opacity=".38"
            x={x - step * 0.28} y={217 - volumeHeight} width={step * 0.56} height={volumeHeight}>
            <title>{quantity(volume)}</title>
          </rect>}
        </g>;
      })}
      <g className="vx-last-price-line" style={{ transform: `translateY(${y(livePrice ?? last.close)}px)` }}>
        <line x1="0" x2="548" y1="0" y2="0" stroke={last.close >= last.open ? '#2ebd85' : '#f0616d'} strokeWidth=".6" strokeDasharray="3 4" />
        <rect x="548" y="-7" width="52" height="14" rx="2" fill={last.close >= last.open ? '#195e48' : '#69383f'}/>
        <text x="597" y="2.5" textAnchor="end" style={{ fill: '#e8f4ef', fontSize: 7 }}>{formatPriceValue(livePrice ?? last.close)}</text>
      </g>
      <line className="vx-chart-grid" x1="0" x2="548" y1="221" y2="221" />
      {timeIndices.map(index => <text key={candles[index].time} className="vx-chart-time"
        x={index === 0 ? 4 : index === candles.length - 1 ? 544 : 274} y="235"
        textAnchor={index === 0 ? 'start' : index === candles.length - 1 ? 'end' : 'middle'}>
        {timeLabel(candles[index].time)}
      </text>)}
      <text className="vx-chart-time" x="598" y="235" textAnchor="end">UTC</text>
    </svg>
  );
}

/** The homepage owns all requests. This terminal only renders received snapshots. */
export function TerminalPreview({ market }: { market: HomeMarket }) {
  const { lang, t } = useLanguage();
  const copy = homeLiveCopy[lang];
  const motionCopy = globalHeroCopy[lang];
  const feed = market.hero;
  const lead = feed?.pair ? market.tickers.find(row => row.pair === feed.pair) : undefined;
  const price = receivedValue(feed?.livePrice) ?? receivedValue(lead?.price);
  const pair = feed?.pair ?? 'BTC/USDT';
  const base = lead?.base ?? pair.split('/')[0];
  const quote = lead?.quote ?? pair.split('/')[1] ?? 'USDT';
  const tradeHref = `/trade?pair=${encodeURIComponent(pair)}`;
  const up = (lead?.change ?? 0) >= 0;
  const book = feed?.book;
  const maximum = Math.max(0, ...(book ? [...book.asks, ...book.bids].map(row => receivedValue(row.quantity) ?? 0) : []));
  const candles = useMemo(() => (feed?.candles ?? []).filter(candle =>
    [candle.time, candle.open, candle.high, candle.low, candle.close].every(value => Number.isFinite(value))
    && candle.time >= 0 && candle.high >= candle.low && candle.low >= 0), [feed?.candles]);
  const trades = feed?.trades ?? [];
  const stale = market.tickersStale || feed?.stale;
  const timeOf = (timestamp: number) => new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
    .toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <div id="home-live-terminal" className="vx-live-terminal" data-stale={!!stale}>
      <div className="vx-terminal-appbar">
        <span className="vx-terminal-logo"><LogoMark size={14} /> VOLTEX</span>
        <div className="vx-terminal-nav">
          {MINI_NAV.map((item, index) => <span key={item} className={index === 1 ? 'vx-selected' : ''}>{t(item)}</span>)}
        </div>
        <span className="vx-terminal-feed" title={feed?.streaming ? motionCopy.live : copy.refresh}>
          <span className={`vx-feed-dot ${stale ? 'vx-feed-stale' : !feed?.updatedAt ? 'vx-feed-neutral' : ''}`} aria-hidden="true" />
          {stale ? t('analytics.stale') : feed?.streaming ? motionCopy.live : copy.feed}
        </span>
      </div>
      <div className="vx-terminal-instrument">
        <div className="vx-terminal-pair">
          <CryptoIcon symbol={base} size={21} imageUrl={market.logoOf(base)} />
          <strong>{pair}</strong>
          <LiveValue value={price} className={up ? 'text-up' : 'text-down'} />
        </div>
        <div className="vx-terminal-stats">
          <span><small>{t('home.preview.change24h')}</small>
            <LiveValue value={lead?.change} className={up ? 'text-up' : 'text-down'}
              format={value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`} /></span>
          <span><small>{t('home.preview.high24h')}</small><LiveValue value={lead?.high} /></span>
          <span><small>{t('home.preview.low24h')}</small><LiveValue value={lead?.low} /></span>
          <span><small>{t('home.preview.volume24h')}</small><LiveValue value={lead?.quoteVolume} format={formatCompactUsd} /></span>
        </div>
      </div>
      <div className="vx-terminal-workspace vx-terminal-reference-workspace">
        <section className="vx-terminal-center">
          <div className="vx-terminal-timeframe">
            <span className="vx-selected">15m</span><span>OHLC</span>
            <span>{market.tickerSource ? market.tickerSource.toUpperCase() : copy.feed}</span>
          </div>
          <div className="vx-terminal-chart">
            {candles.length > 0
              ? <PreviewCandles candles={candles} livePrice={receivedValue(feed?.livePrice)} label={`${pair} · ${copy.candles}`} />
              : <div className="vx-terminal-empty">{feed?.candlesStatus === 'loading'
                ? t('home.markets.loading') : t('home.dataUnavailable')}</div>}
            {feed?.candlesStatus === 'error' && candles.length > 0
              && <span className="vx-terminal-stale-label">{t('analytics.stale')}</span>}
          </div>
        </section>
        <aside className="vx-terminal-book">
          <div className="vx-terminal-pane-title">{t('trade.orderBook')}</div>
          <div className="vx-book-heading"><span>{t('markets.price')}</span><span>{t('home.preview.qty')}</span></div>
          {book ? <>
            <OrderBookRows rows={[...book.asks].reverse()} side="ask" maximum={maximum} />
            <div className="vx-book-mid">
              <LiveValue value={price} className={up ? 'text-up' : 'text-down'} />
            </div>
            <OrderBookRows rows={book.bids} side="bid" maximum={maximum} />
          </> : <div className="vx-terminal-empty">
            {feed?.bookStatus === 'loading' ? t('home.markets.loading') : t('home.dataUnavailable')}
          </div>}
          <div className="vx-terminal-book-note">
            {feed?.bookStatus === 'error' && book ? t('analytics.stale') : feed?.streaming ? motionCopy.live : copy.refresh}
          </div>
        </aside>
        <aside className="vx-terminal-order-entry" aria-label={t('nav.trade')}>
          <div className="vx-terminal-order-tabs">
            <a className="vx-terminal-buy" href={tradeHref}>{t('trade.buy')} {base}</a>
            <a className="vx-terminal-sell" href={tradeHref}>{t('trade.sell')} {base}</a>
          </div>
          <div className="vx-terminal-order-market">{t('trade.marketOrder')}<span>{quote}</span></div>
          <dl className="vx-terminal-order-fields">
            <div><dt>{t('trade.price')}</dt><dd><LiveValue value={price} /></dd></div>
            <div><dt>{t('trade.quantity')}</dt><dd>— <small>{base}</small></dd></div>
          </dl>
          <a className="vx-terminal-open-trade" href={tradeHref}>{t('home.cta.openTerminal')}</a>
          <div className="vx-terminal-available"><span>{t('trade.available')}</span><span>— {quote}</span></div>
          <div className="vx-terminal-order-note">{t('trade.placeOrderPrompt')}</div>
        </aside>
      </div>
      <div className="vx-terminal-trades vx-terminal-public-trades">
        <div className="vx-terminal-pane-title">
          {t('trade.trades')}
          <span>{feed?.tradesStatus === 'error' && trades.length > 0 ? t('analytics.stale') : pair}</span>
        </div>
        <div className="vx-trade-row vx-trade-heading vx-reference-trade-row">
          <span>{t('trade.time')}</span><span>{t('markets.pair')}</span><span>{t('trade.side')}</span>
          <span>{t('markets.price')}</span><span>{t('home.preview.qty')}</span>
        </div>
        {trades.length > 0 ? trades.slice(0, 4).map(trade => (
          <div key={trade.id} className="vx-trade-row vx-trade-received vx-reference-trade-row">
            <time dateTime={new Date(trade.time < 1e12 ? trade.time * 1000 : trade.time).toISOString()}>{timeOf(trade.time)}</time>
            <span>{pair}</span>
            <span className={trade.side === 'BUY' ? 'text-up' : 'text-down'}>{t(trade.side === 'BUY' ? 'trade.buy' : 'trade.sell')}</span>
            <LiveValue value={receivedValue(trade.price)} /><LiveValue value={receivedValue(trade.quantity)} format={quantity} />
          </div>
        )) : <div className="vx-terminal-empty vx-terminal-empty-small">
          {feed?.tradesStatus === 'loading' ? t('home.markets.loading') : t('home.dataUnavailable')}
        </div>}
      </div>
      <div className="vx-terminal-status">
        <span>{pair} · {copy.candles}</span>
        <span>{market.tickerUpdatedAt ? timeOf(market.tickerUpdatedAt) : '—'} · {copy.refresh}</span>
      </div>
    </div>
  );
}
