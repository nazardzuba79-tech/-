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
import './CfdInstrumentIcon.css';

/** flag-icons (MIT) square flags, bundled: a few hundred bytes each, inlined by the build. */
const FLAG_SRC: Record<string, string> = { eu, us, gb, jp, au, ca, ch, nz };

function Flag({ code, className }: { code: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const flag = isCfdCurrency(code) ? CURRENCY_FLAG[code] : null;
  const src = flag ? FLAG_SRC[flag] : undefined;
  // A flag that cannot be shown becomes the currency code: never a broken image.
  if (!src || failed) return <span className={`${className} cfd-flag-fallback`}>{code.slice(0, 3)}</span>;
  return <img className={className} src={src} alt="" width={16} height={16} draggable={false} decoding="async" onError={() => setFailed(true)} />;
}

function Mark({ asset }: { asset: CfdAssetIdentity }) {
  if (asset.assetClass === 'forex') return <>
    <Flag code={asset.base} className="cfd-flag cfd-flag-base" />
    <Flag code={asset.quote} className="cfd-flag cfd-flag-quote" />
  </>;
  if (asset.assetClass === 'metals') return <span className="cfd-element">{asset.mark}</span>;
  // Energy: a barrel for WTI (Cushing, Oklahoma delivery), a drop for Brent (North Sea), with the benchmark's name.
  return <>
    <svg viewBox="0 0 32 32" focusable="false" className="cfd-energy-glyph">
      {asset.symbol === 'WTIUSD'
        ? <><ellipse cx="16" cy="9.4" rx="6.2" ry="2.4" /><path d="M9.8 9.4v12.4c0 1.4 2.8 2.5 6.2 2.5s6.2-1.1 6.2-2.5V9.4M9.8 15.6c0 1.4 2.8 2.5 6.2 2.5s6.2-1.1 6.2-2.5" /></>
        : <path d="M16 6.6c-1.8 3.2-6.1 8.1-6.1 12.4a6.1 6.1 0 0 0 12.2 0c0-4.3-4.3-9.2-6.1-12.4Z" />}
    </svg>
    <span className="cfd-energy-label">{asset.mark === 'Brent' ? 'BRN' : asset.mark}</span>
  </>;
}

/**
 * One mark per CFD instrument from the asset registry (lib/cfdAssetIdentity):
 * the two currencies' flags for a pair, the element symbol for a metal, the
 * benchmark for oil. Decorative — the symbol and the name sit beside it.
 * An instrument the registry does not know gets its first three letters.
 */
export function CfdInstrumentIcon({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const asset = cfdAsset(symbol);
  const kind = asset?.assetClass ?? 'unknown';
  return <span className={`cfd-instrumentIcon cfd-instrumentIcon-${symbol} cfd-mark-${kind}${compact ? ' cfd-instrumentIcon--compact' : ''}`} aria-hidden="true" data-cfd-mark={asset?.mark ?? ''}>
    {asset ? <Mark asset={asset} /> : <span className="cfd-element">{symbol.slice(0, 3)}</span>}
  </span>;
}
