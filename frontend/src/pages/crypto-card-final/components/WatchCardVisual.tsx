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
export function WatchCardVisual({ framing = 'product' }: { framing?: 'product' | 'homepage' } = {}) {
  const id = `watch-${useId().replace(/:/g, '')}`;
  // Homepage retains the source's complete right/bottom edge. The nearly
  // identical width preserves watch scale; /card keeps its approved framing.
  const homepage = framing === 'homepage';
  const width = homepage ? 932 : 928;
  const height = homepage ? 1006 : 925;
  return <svg viewBox={`516 80 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
    role="img" aria-label="VOLTEX Black Signature · RUB / USD / GBP / CHF / EUR · BTC / ETH / USDT / TON / USDC"
    data-card-cinematic="wrist-watch"
    style={{ display: 'block', width: '100%', height: 'auto', ...(homepage ? { overflow: 'visible' } : {}) }}>
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
      {homepage && <linearGradient id={`${id}-left-contour`} gradientUnits="userSpaceOnUse" x1="473" y1="465" x2="539" y2="483">
        <stop stopColor="#211a12" stopOpacity="0" />
        <stop offset=".45" stopColor="#211a12" stopOpacity=".65" />
        <stop offset="1" stopColor="#211a12" />
      </linearGradient>}
      <mask id={`${id}-vertical-mask`} maskUnits="userSpaceOnUse" x="516" y="80" width={width} height={height}>
        <rect x="516" y="80" width={width} height={height} fill={`url(#${id}-vertical)`} />
      </mask>
      <mask id={`${id}-edges`} maskUnits="userSpaceOnUse" x={homepage ? 390 : 516} y={homepage ? 20 : 80} width={homepage ? 1058 : width} height={homepage ? 1066 : height} data-watch-edge-mask="true">
        <rect x="516" y="80" width={width} height={height} fill={`url(#${id}-horizontal)`} mask={`url(#${id}-vertical-mask)`} />
        {BADGES.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={`url(#${id}-badge-opacity)`} />)}
        {/* Protect the original wrist, fingers and nails at full opacity.
            The 88% solid core covers skin; feathering falls on surrounding
            background, not across the hand. No bitmap pixels are changed. */}
        {homepage && <ellipse data-watch-hand-opacity="true" cx="1450" cy="720" rx="360" ry="820" fill={`url(#${id}-badge-opacity)`} />}
        {/* Reveal a little more of the existing left wrist/sleeve, without
            moving or shrinking the watch or exposing the old photo lettering. */}
        {homepage && <ellipse data-watch-left-wrist-opacity="true" cx="610" cy="750" rx="180" ry="270" fill={`url(#${id}-badge-opacity)`} />}
        {/* Extend only the revealed original backdrop to the owner's outline.
            These feathered islands avoid the baked-in lettering at upper left;
            existing full-opacity hand/watch/badge protection stays unchanged. */}
        {homepage && <ellipse data-watch-top-background="true" cx="930" cy="200" rx="415" ry="180" fill={`url(#${id}-badge-opacity)`} />}
        {homepage && <ellipse data-watch-left-background="true" cx="650" cy="790" rx="260" ry="290" fill={`url(#${id}-badge-opacity)`} />}
        {/* Join the original backdrop beside CHF to the upper/lower reveal.
            x=516 keeps every baked-in letter outside the feathered island. */}
        {homepage && <ellipse data-watch-chf-background="true" cx="580" cy="470" rx="64" ry="190" fill={`url(#${id}-badge-opacity)`} />}
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
    {/* One continuous, softly feathered backdrop edge underneath the photo,
        not a patch on the badge or hand. The original photo stays untouched. */}
    {homepage && <path data-watch-left-contour="true" d="M594 150 C555 245 540 304 518 374 C485 474 447 588 418 690 L660 690 L700 150Z" fill={`url(#${id}-left-contour)`} />}
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
