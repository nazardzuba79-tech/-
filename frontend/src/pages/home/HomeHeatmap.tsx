import { CSSProperties, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRightIcon } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { localeOf, useLanguage } from '../../lib/i18n';
import { HomeMarket, formatPriceValue } from './useHomeMarket';
import { heatmapLayout } from './homeHeatmapLayout';
import { WORLD_MARKET_COPY } from './worldMarketCopy';
import { LiveValue } from './LiveValue';

function percent(value: number): string { return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`; }

export function HomeHeatmap({ market }: { market: HomeMarket }) {
  const { lang, t } = useLanguage();
  const copy = WORLD_MARKET_COPY[lang];
  const id = useId().replace(/:/g, '');
  const { tiles, volumeWeighted } = useMemo(() => heatmapLayout(market.tickers), [market.tickers]);
  const [selectedPair, selectPair] = useState('');
  const selected = tiles.find(tile => tile.ticker.pair === selectedPair)?.ticker ?? tiles[0]?.ticker;
  const volume = (value: number) => Number.isFinite(value) && value > 0
    ? new Intl.NumberFormat(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 }).format(value) : '—';
  const gaining = tiles.filter(({ ticker }) => ticker.change > 0).length;
  const declining = tiles.filter(({ ticker }) => ticker.change < 0).length;
  const unchanged = tiles.length - gaining - declining;

  return (
    <section className="vx-heatmap-section" aria-labelledby={`${id}-title`}>
      <div className="vx-heatmap-heading">
        <div><p className="vx-section-eyebrow"><span />{copy.heatEyebrow}</p><h2 id={`${id}-title`}>{copy.heatTitle}</h2></div>
        <p className="vx-section-description">{selected && !volumeWeighted ? copy.equalSizing : copy.heatDescription}</p>
      </div>
      {selected ? <>
        <div className="vx-heatmap-meta"><span>{tiles.length} {copy.markets}</span><span>{volumeWeighted ? copy.volumeSizing : copy.equalSizing}</span><span className={market.tickersStale ? 'vx-heatmap-stale' : ''}>{market.tickersStale ? `${t('analytics.stale')} · ` : ''}{market.tickerUpdatedAt ? <>{t('home.overview.updated')}: <time dateTime={new Date(market.tickerUpdatedAt).toISOString()}>{new Date(market.tickerUpdatedAt).toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</time></> : null}</span></div>
        <div className="vx-heatmap-body">
          <div className="vx-heatmap-canvas" role="group" aria-label={`${copy.heatTitle}. ${volumeWeighted ? copy.volumeSizing : copy.equalSizing}`}>
            {tiles.map(({ ticker, x, y, width, height }, index) => {
              const small = width < 13 || height < 19;
              const tiny = width < 6 || height < 10;
              const direction = ticker.change > 0 ? 'up' : ticker.change < 0 ? 'down' : 'flat';
              const style = { left: `${x}%`, top: `${y}%`, width: `${width}%`, height: `${height}%`, '--heat-strength': Math.min(0.64, 0.21 + Math.abs(ticker.change) / 24), '--heat-delay': `${index * 30}ms` } as CSSProperties;
              return <button key={ticker.pair} type="button" className={`vx-heat-tile vx-heat-${direction}${small ? ' vx-heat-small' : ''}${tiny ? ' vx-heat-tiny' : ''}${selected.pair === ticker.pair ? ' vx-heat-selected' : ''}`} style={style} aria-label={`${ticker.pair}. ${copy.price}: ${formatPriceValue(ticker.price)}. ${copy.change}: ${percent(ticker.change)}. ${copy.volume}: ${volume(ticker.quoteVolume)}`} aria-pressed={selected.pair === ticker.pair} aria-controls={`${id}-detail`} onMouseEnter={() => selectPair(ticker.pair)} onFocus={() => selectPair(ticker.pair)} onClick={() => selectPair(ticker.pair)}>
                <span className="vx-heat-tile-inner"><span className="vx-heat-symbol">{ticker.base}</span><span className="vx-heat-percent">{percent(ticker.change)}</span><span className="vx-heat-price">{formatPriceValue(ticker.price)} <small>USDT</small></span></span>
              </button>;
            })}
          </div>
          <aside className="vx-heatmap-detail" id={`${id}-detail`}>
            <div className="vx-heatmap-detail-top"><CryptoIcon symbol={selected.base} size={36} imageUrl={market.logoOf(selected.base)} /><div><strong>{selected.base}</strong><span>{selected.pair}</span></div></div>
            <label className="vx-heatmap-select-label" htmlFor={`${id}-select`}>{copy.select}</label>
            <select id={`${id}-select`} className="vx-heatmap-select" value={selected.pair} onChange={event => selectPair(event.target.value)}>{tiles.map(({ ticker }) => <option key={ticker.pair} value={ticker.pair}>{ticker.pair}</option>)}</select>
            <dl><div><dt>{copy.price}</dt><dd><LiveValue key={selected.pair} value={selected.price} /></dd></div><div><dt>{copy.change}</dt><dd className={selected.change > 0 ? 'vx-heat-value-up' : selected.change < 0 ? 'vx-heat-value-down' : ''}>{percent(selected.change)}</dd></div><div><dt>{copy.volume}</dt><dd>{volume(selected.quoteVolume)}</dd></div></dl>
            <Link to={`/trade?pair=${encodeURIComponent(selected.pair)}`} className="vx-heatmap-trade">{copy.trade}<ArrowUpRightIcon size={16} /></Link>
            <p className="vx-heatmap-hint">{copy.detailHint}</p>
          </aside>
        </div>
        <div className="vx-heatmap-legend"><span className="vx-heat-legend-gain"><i />{copy.gain} <b>{gaining}</b></span><span className="vx-heat-legend-loss"><i />{copy.loss} <b>{declining}</b></span>{unchanged > 0 && <span><i />{copy.unchanged} <b>{unchanged}</b></span>}<span className="vx-heatmap-legend-period">24H · USDT</span></div>
      </> : <div className="vx-heatmap-empty" role="status"><span aria-hidden="true" className="vx-heatmap-empty-mark">▦</span><p>{market.tickersStatus === 'loading' ? copy.loading : copy.unavailable}</p></div>}
    </section>
  );
}
