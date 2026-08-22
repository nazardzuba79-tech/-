import { useState } from 'react';

// Well-known open icon set (MIT), mirrored on jsDelivr for reliability —
// same approach most small/mid exchanges use rather than hosting or
// licensing their own full coin-logo library. Falls back to a colored
// letter avatar (deterministic color per symbol) for any coin missing
// from the set, same pattern Bybit itself uses for long-tail listings.
function iconUrl(symbol: string): string {
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${symbol.toLowerCase()}.png`;
}

const AVATAR_COLORS = ['#f7a600', '#00d68f', '#ff4d6a', '#5b8def', '#b073ff', '#00c2d1', '#e0a72e'];

function avatarColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
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
          background: avatarColor(symbol),
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
