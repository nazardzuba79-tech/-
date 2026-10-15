import { useState } from 'react';
import { cfdAsset, CURRENCY_FLAG, isCfdCurrency, type CfdAssetIdentity } from '../lib/cfdAssetIdentity';
import eu from '../assets/cfd-flags/eu.svg';
import us from '../assets/cfd-flags/us.svg';
import gb from '../assets/cfd-flags/gb.svg';
import jp from '../assets/cfd-flags/jp.svg';
import au from '../assets/cfd-flags/au.svg';
import ca from '../assets/cfd-flags/ca.svg';
import ch from '../assets/cfd-flags/ch.svg';
import nz from '../assets/cfd-flags/nz.svg';
import gold from '../assets/cfd-marks/gold.svg';
import silver from '../assets/cfd-marks/silver.svg';
import platinum from '../assets/cfd-marks/platinum.svg';
import palladium from '../assets/cfd-marks/palladium.svg';
import wti from '../assets/cfd-marks/wti.svg';
import brent from '../assets/cfd-marks/brent.svg';
import './CfdInstrumentIcon.css';

/** flag-icons (MIT) square flags, bundled: a few hundred bytes each, inlined by the build. */
const FLAG_SRC: Record<string, string> = { eu, us, gb, jp, au, ca, ch, nz };
/** VOLTEX's own commodity marks (assets/cfd-marks, drawn for this terminal): ingot stacks for the
 * precious metals, a crude-oil drop for the two benchmarks. Shown the way exchanges and TradingView
 * show a commodity pair: the asset's mark with the quote currency's flag over its corner. */
const COMMODITY_SRC: Record<string, string> = { XAUUSD: gold, XAGUSD: silver, XPTUSD: platinum, XPDUSD: palladium, WTIUSD: wti, XBRUSD: brent };

function Flag({ code, className }: { code: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const flag = isCfdCurrency(code) ? CURRENCY_FLAG[code] : null;
  const src = flag ? FLAG_SRC[flag] : undefined;
  // A flag that cannot be shown becomes the currency code: never a broken image.
  if (!src || failed) return <span className={`${className} cfd-flag-fallback`}>{code.slice(0, 3)}</span>;
  return <img className={className} src={src} alt="" width={16} height={16} draggable={false} decoding="async" onError={() => setFailed(true)} />;
}

function CommodityMark({ symbol, fallback }: { symbol: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  const src = COMMODITY_SRC[symbol];
  if (!src || failed) return <span className="cfd-flag cfd-flag-base cfd-flag-fallback">{fallback}</span>;
  return <img className="cfd-flag cfd-flag-base cfd-commodity" src={src} alt="" width={16} height={16} draggable={false} decoding="async" onError={() => setFailed(true)} />;
}

function Mark({ asset }: { asset: CfdAssetIdentity }) {
  // Owner (2026-10-15): metals and oil read like on other exchanges — the asset's own mark, then the
  // quote currency's flag; currency pairs keep their two flags.
  const base = asset.assetClass === 'forex'
    ? <Flag code={asset.base} className="cfd-flag cfd-flag-base" />
    : <CommodityMark symbol={asset.symbol} fallback={asset.mark.slice(0, 3)} />;
  return <>{base}<Flag code={asset.quote} className="cfd-flag cfd-flag-quote" /></>;
}

/**
 * One mark per CFD instrument from the asset registry (lib/cfdAssetIdentity):
 * the two currencies' flags for a pair, the commodity's mark and the quote
 * currency's flag for a metal or oil. Decorative — the symbol and the name sit beside it.
 * An instrument the registry does not know gets its first three letters.
 */
export function CfdInstrumentIcon({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const asset = cfdAsset(symbol);
  const kind = asset?.assetClass ?? 'unknown';
  return <span className={`cfd-instrumentIcon cfd-instrumentIcon-${symbol} cfd-mark-${kind}${compact ? ' cfd-instrumentIcon--compact' : ''}`} aria-hidden="true" data-cfd-mark={asset?.mark ?? ''}>
    {asset ? <Mark asset={asset} /> : <span className="cfd-element">{symbol.slice(0, 3)}</span>}
  </span>;
}
