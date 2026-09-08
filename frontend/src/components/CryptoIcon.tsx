import { useEffect, useState } from 'react';
import { assetMetadataStore } from '../lib/assetMetadataStore';

/**
 * Icon resolution, in order:
 *
 *   1. Canonical asset metadata from the Market Data Gateway's asset
 *      registry — CoinGecko's own logo for that coin, looked up by
 *      canonical id rather than by ticker. Batched: a 500-row table costs
 *      ONE metadata request, never one per row (see lib/assetMetadataStore).
 *   2. A caller-supplied `imageUrl`, for call sites that already hold one.
 *   3. The explicit overrides below, for coins the static set is missing.
 *   4. The jsDelivr cryptocurrency-icons set.
 *   5. A deterministic letter avatar.
 *
 * Tiers 3-5 are the original pipeline, unchanged — they were already the
 * right answer for a coin the catalogue does not cover, and they need no
 * network of their own. What is new is tier 1: identity now comes from the
 * registry, so a ticker collision resolves to the right coin's logo
 * instead of whichever one happened to own the string.
 */

// Well-known open icon set (MIT), mirrored on jsDelivr for reliability —
// same approach most small/mid exchanges use rather than hosting or
// licensing their own full coin-logo library. Falls back to a colored
// letter avatar (deterministic color per symbol) for any coin missing
// from the set, same pattern Bybit itself uses for long-tail listings.
//
// A few coins get an explicit override instead of the generic set: TON
// (Toncoin) was added to major exchanges after that dataset's last big
// refresh and isn't reliably present there, so it's pointed at the Trust
// Wallet assets repo instead — a widely mirrored, de-facto-standard source
// for a coin's official logo.
const ICON_URL_OVERRIDES: Record<string, string> = {
  TON: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png',
};

function iconUrl(symbol: string): string {
  const override = ICON_URL_OVERRIDES[symbol.toUpperCase()];
  if (override) return override;
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${symbol.toLowerCase()}.png`;
}

export const AVATAR_COLORS = [
  '#f7a600', // amber
  '#00d68f', // green
  '#ff4d6a', // red/coral
  '#5b8def', // blue
  '#b073ff', // purple
  '#00c2d1', // cyan
  '#f472b6', // pink
  '#facc15', // yellow
  '#38bdf8', // sky
  '#fb923c', // orange
];

// Exported so anything showing a per-asset color swatch (e.g. the wallet's
// portfolio donut chart) uses the exact same deterministic color a coin's
// icon falls back to — one color-per-symbol mapping, not two that drift.
export function avatarColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export interface AssetColor {
  /** Solid brand color — also the start color for a gradient asset. */
  solid: string;
  /** Present only for assets whose brand mark is itself a gradient (SOL). */
  gradientTo?: string;
}

// Real brand colors for the coins this exchange actually deposits/withdraws
// (see config/chains.ts) plus the handful of others prominent enough to
// warrant their own look in the portfolio donut, rather than a hashed
// placeholder color. Anything else still gets a deterministic color via
// avatarColor() below — never a missing/blank swatch.
const BRAND_COLORS: Record<string, AssetColor> = {
  BTC: { solid: '#F7931A' },
  ETH: { solid: '#4F46E5' },
  USDT: { solid: '#0ECB81' },
  // A vivid, distinct hue rather than the old near-neutral grey — that
  // read fine on a dark panel but disappeared entirely on a light one.
  XRP: { solid: '#E1147D' },
  // Real USDC blue instead of plain white, which vanished against a light
  // card background.
  USDC: { solid: '#2775CA' },
  SOL: { solid: '#9945FF', gradientTo: '#00D9C0' },
  TON: { solid: '#0088CC' },
  TRX: { solid: '#FF0013' },
};

export function assetColor(symbol: string): AssetColor {
  return BRAND_COLORS[symbol.toUpperCase()] ?? { solid: avatarColor(symbol) };
}

/**
 * The registry logo for one symbol, if the batched store already holds it.
 *
 * Subscribes once per icon but re-renders only when THIS symbol's logo
 * actually changes, so a 500-row table does not re-render every row every
 * time one batch lands.
 */
function useRegistryLogo(symbol: string, enabled: boolean): string | null {
  const [logo, setLogo] = useState<string | null>(() =>
    enabled ? assetMetadataStore.get(symbol)?.logoUrl ?? null : null
  );

  useEffect(() => {
    if (!enabled) {
      setLogo(null);
      return;
    }
    const read = () => assetMetadataStore.get(symbol)?.logoUrl ?? null;
    setLogo(read());
    assetMetadataStore.request([symbol]);
    return assetMetadataStore.subscribe(() => {
      const next = read();
      // Guarded: identical values must not schedule a render.
      setLogo((prev) => (prev === next ? prev : next));
    });
  }, [symbol, enabled]);

  return logo;
}

export function CryptoIcon({
  symbol,
  size = 20,
  imageUrl,
}: {
  symbol: string;
  size?: number;
  /** A real per-coin logo URL when the caller already has one (e.g. the
   * CoinGecko rankings fetch's own `image` field) — CoinGecko's set covers
   * far more of this app's newer/smaller listings than the static
   * jsDelivr set below, which hasn't been updated in years. Falls through
   * to that jsDelivr icon, then the letter avatar, on any load failure. */
  imageUrl?: string | null;
}) {
  // Only consult the registry when the caller has not already supplied a
  // logo — no point spending a lookup on a question already answered.
  const registryLogo = useRegistryLogo(symbol, !imageUrl);
  const preferredUrl = imageUrl ?? registryLogo;

  const [preferredFailed, setPreferredFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  // A reused instance (symbol/imageUrl changing under the same element,
  // rather than a fresh mount) must re-attempt both tiers instead of
  // staying stuck on whichever one last failed for a different coin.
  useEffect(() => {
    setPreferredFailed(false);
    setFallbackFailed(false);
  }, [symbol, preferredUrl]);

  const usingFallback = !preferredUrl || preferredFailed;

  if (usingFallback && fallbackFailed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: assetColor(symbol).solid,
          color: 'var(--on-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.5,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {symbol[0]}
      </div>
    );
  }

  return (
    <img
      src={usingFallback ? iconUrl(symbol) : preferredUrl!}
      alt={symbol}
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
      onError={() => (usingFallback ? setFallbackFailed(true) : setPreferredFailed(true))}
    />
  );
}
