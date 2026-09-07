import { useId } from 'react';

export const WATCH_CARD_IMAGE = '/cards/crypto-card-final/voltex-watch-wrist-original.png';

// Full-opacity islands protect the original badge faces from the outer fade.
// Coordinates refer to the unchanged 1448 × 1086 owner photograph.
const BADGES = [
  [718, 196, 82], [630, 324, 79], [600, 464, 83], [637, 609, 85], [729, 737, 87],
  [1189, 204, 74], [1282, 335, 85], [1334, 482, 85], [1297, 626, 85], [1226, 756, 86],
];

/** Original photo, uniformly scaled. Only outer opacity and a precisely placed
 * CHF vector face change; the central watch/card and other badges stay sharp. */
export function WatchCardVisual() {
  const id = `watch-${useId().replace(/:/g, '')}`;
  return <svg viewBox="516 80 928 925" preserveAspectRatio="xMidYMid meet"
    role="img" aria-label="VOLTEX Black Signature · RUB / USD / GBP / CHF / EUR · BTC / ETH / USDT / TON / USDC"
    data-card-cinematic="wrist-watch"
    style={{ display: 'block', width: '100%', height: 'auto' }}>
    <defs>
      <linearGradient id={`${id}-horizontal`}>
        <stop stopColor="black" /><stop offset=".16" stopColor="white" />
        <stop offset=".84" stopColor="white" /><stop offset="1" stopColor="black" />
      </linearGradient>
      <linearGradient id={`${id}-vertical`} x2="0" y2="1">
        <stop stopColor="black" /><stop offset=".14" stopColor="white" />
        <stop offset=".84" stopColor="white" /><stop offset="1" stopColor="black" />
      </linearGradient>
      <radialGradient id={`${id}-badge-opacity`}>
        <stop offset=".88" stopColor="white" /><stop offset="1" stopColor="white" stopOpacity="0" />
      </radialGradient>
      <mask id={`${id}-vertical-mask`} maskUnits="userSpaceOnUse" x="516" y="80" width="928" height="925">
        <rect x="516" y="80" width="928" height="925" fill={`url(#${id}-vertical)`} />
      </mask>
      <mask id={`${id}-edges`} maskUnits="userSpaceOnUse" x="516" y="80" width="928" height="925" data-watch-edge-mask="true">
        <rect x="516" y="80" width="928" height="925" fill={`url(#${id}-horizontal)`} mask={`url(#${id}-vertical-mask)`} />
        {BADGES.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={`url(#${id}-badge-opacity)`} />)}
      </mask>
      <radialGradient id={`${id}-chf-face`} cx=".32" cy=".22" r=".9">
        <stop stopColor="#353239" /><stop offset=".5" stopColor="#1B1D22" /><stop offset="1" stopColor="#111318" />
      </radialGradient>
      <radialGradient id={`${id}-chf-edge`}>
        <stop offset=".88" stopColor="#1B1D22" />
        <stop offset=".94" stopColor="#6F2634" />
        <stop offset="1" stopColor="#6F2634" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-chf-rim`} x2=".8" y2="1">
        <stop stopColor="#c7a587" /><stop offset=".42" stopColor="#6F2634" /><stop offset="1" stopColor="#8b4851" />
      </linearGradient>
    </defs>
    <g mask={`url(#${id}-edges)`}>
      <image href={WATCH_CARD_IMAGE} width="1448" height="1086" preserveAspectRatio="xMidYMid meet" />
      {/* Covers the original CHF face/rim only, never another currency. */}
      <g data-watch-badge="CHF" aria-hidden="true">
        <circle cx="600" cy="464" r="81" fill={`url(#${id}-chf-edge)`} />
        <circle cx="600" cy="464" r="72" fill={`url(#${id}-chf-face)`} stroke={`url(#${id}-chf-rim)`} strokeWidth="2.5" />
        <text x="547" y="470" fill="#fff" fontFamily="Inter, sans-serif" fontSize="25" fontWeight="600">CHF</text>
        <rect x="613" y="440" width="42" height="42" rx="8" fill="#ce263b" />
        <path d="M630 447h8v10h10v8h-10v10h-8v-10h-10v-8h10z" fill="#fff" />
      </g>
    </g>
  </svg>;
}
