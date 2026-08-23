import { useState } from 'react';

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

export function CryptoIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
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
      src={iconUrl(symbol)}
      alt={symbol}
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0 }}
      onError={() => setFailed(true)}
    />
  );
}
