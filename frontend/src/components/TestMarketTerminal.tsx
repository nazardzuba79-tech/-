import { useEffect, useRef, useState } from 'react';
import { localeOf, useLanguage } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { TerminalChart } from './TerminalChart';
import { testMarketStore } from '../lib/testMarketStore';
import { testMarketCandleLoader } from '../lib/testMarketCandles';
import { countdownParts, formatListingMoment, formatTestAxisPrice, formatTestPrice, type TestAsset } from '../lib/testMarkets';
import './TestMarketTerminal.css';

/**
 * The chart area of the Spot terminal for an upcoming listing (VOLTORA,
 * VTA/USDT). Everything else on the page — ticker bar, order book, order
 * form — is the ordinary Spot terminal; only the chart has nothing to draw
 * before the first trade, so it shows the listing card and its countdown
 * instead, then the chart once the server says the market is live.
 */

/** Server "now", ticking once a second while there is a countdown to draw. */
function useServerNow(clockOffsetMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now() + clockOffsetMs);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now() + clockOffsetMs);
    const timer = window.setInterval(() => setNow(Date.now() + clockOffsetMs), 1000);
    return () => window.clearInterval(timer);
  }, [clockOffsetMs, active]);
  return now;
}

export function TestMarketChart({ pair, asset, loaded, clockOffsetMs }: {
  pair: string; asset: TestAsset | null; loaded: boolean; clockOffsetMs: number;
}) {
  const { t, lang } = useLanguage();
  const listingAt = asset ? Date.parse(asset.listingAt) : NaN;
  const preListing = !asset || asset.state.phase === 'pre-listing';
  const counting = preListing && asset?.listingArmed === true && Number.isFinite(listingAt);
  const now = useServerNow(clockOffsetMs, counting);
  const reachedRef = useRef(false);
  const left = counting ? listingAt - now : NaN;

  // The listing moment: ask the server once; the chart appears when it
  // says the market is live, never on the browser's say-so alone.
  useEffect(() => {
    if (!counting || !Number.isFinite(left)) { reachedRef.current = false; return; }
    if (left <= 0 && !reachedRef.current) {
      reachedRef.current = true;
      void testMarketStore.refresh();
    }
  }, [counting, left]);

  if (asset && !preListing) {
    return <TerminalChart pair={pair} chrome="terminal" drawingTools market="spot" compactTools candleLoader={testMarketCandleLoader}
      tradingView={false} priceScaleMode="logarithmic" priceFormatter={formatTestAxisPrice} />;
  }

  const parts = countdownParts(Number.isFinite(left) ? left : 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  const cells: [number, string][] = [
    [parts.days, t('listing.days')], [parts.hours, t('listing.hours')], [parts.minutes, t('listing.minutes')], [parts.seconds, t('listing.seconds')],
  ];
  const startsAt = asset ? formatListingMoment(asset.listingAt, localeOf(lang)) : '';

  return (
    <section className="vta-prelisting" aria-label={`${asset?.name ?? 'VOLTORA'} ${pair}`} data-state={asset ? 'pre-listing' : 'loading'}>
      <div className="vta-prelisting-card">
        <div className="vta-prelisting-mark"><CryptoIcon symbol={pair.split('/')[0]} size={64} /></div>
        <h2 className="vta-prelisting-name">{asset?.name ?? 'VOLTORA'}</h2>
        <div className="vta-prelisting-pair">{pair}</div>
        {asset ? (
          <>
            {counting && (
              <>
                <p className="vta-prelisting-when">{t('listing.untilStart')}</p>
                <div className="vta-countdown" role="timer"
                  aria-label={`${t('listing.untilStart')}: ${cells.map(([value, label]) => `${value} ${label}`).join(', ')}`}>
                  {cells.map(([value, label]) => (
                    <div className="vta-countdown-cell" key={label}>
                      <strong>{pad(value)}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <dl className="vta-prelisting-facts">
              <div><dt>{t('listing.startTime')}</dt><dd>{startsAt}</dd></div>
              <div><dt>{t('listing.initialPrice')}</dt><dd>{formatTestPrice(asset.initialPrice)} {asset.quote}</dd></div>
            </dl>
          </>
        ) : !loaded ? (
          <p className="vta-prelisting-when">{t('trade.loading')}</p>
        ) : null}
      </div>
    </section>
  );
}
