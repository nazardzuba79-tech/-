import { getTraderVisual, type TraderMark } from './traderVisuals';

/** Original, decorative marks for demo strategy aliases. No badges or logos
 * from the reference exchange, and no relationship to account verification. */
function Mark({ kind, initials }: { kind: TraderMark; initials?: string }) {
  switch (kind) {
    // Individually drawn, full-colour identities. No shared portrait template:
    // screenprint, pixel sprites, paper cut-outs and ink each retain their own
    // silhouette/palette. The outer avatar component alone owns sizing/cropping.
    case 'coffee-creature':
      return <g stroke="#463b35" strokeWidth="1.7"><path d="M7 52 18 41l28 2 12 14v7H7" fill="#537e79" stroke="none" /><path d="M15 23h30v16c0 18-30 17-30-1Z" fill="#fff4d7" /><path d="M45 27c16-3 14 18 0 17" fill="none" strokeWidth="4" /><ellipse cx="30" cy="23" rx="15" ry="4" fill="#73513b" /><path d="m24 32 4 1m6-1 4-1m-11 10q5 4 10-2M22 16c-5-5 4-5 1-10m11 10c4-5-4-6 0-11" fill="none" /><path d="m12 50 10 3m17-1 10-2" stroke="#a5c6bc" strokeWidth="3" /></g>;
    case 'sleepy-tiger':
      return <g stroke="#3e312d" strokeWidth="1.5"><path d="M13 27C2 10 17 4 24 18m17 0C53 2 63 20 51 29" fill="#ba632f" /><path d="M11 34C9 9 52 8 54 34c3 30-43 30-43 0" fill="#e59143" /><path d="M17 34q7 3 13 0m7 0 11-2" strokeWidth="2.6" /><path d="m29 18 4 8 4-9M13 28l9 3m-10 9 10 2m31-16-9 4m10 9-10 3" fill="none" strokeWidth="3" /><ellipse cx="33" cy="46" rx="15" ry="9" fill="#f5d6a3" stroke="none" /><path d="m28 42 10-1-5 5Z" fill="#3e312d" /><path d="m33 46-1 5 5-1" fill="none" /><path d="M9 60h47" stroke="#76847b" strokeWidth="9" /></g>;
    case 'kiwi-bird':
      return <g stroke="none"><path d="M0 55 64 49v15H0" fill="#839557" /><ellipse cx="29" cy="39" rx="21" ry="19" fill="#76664c" /><path d="M15 24q22-11 27 4L19 52q-10-9-4-28" fill="#99855d" /><path d="m45 30 17 8-20 1" fill="#dfb36e" /><circle cx="39" cy="29" r="6" fill="#f3e9c6" /><circle cx="40" cy="30" r="2.5" fill="#25272a" /><path d="m18 20 6-9 4 10 7-6 2 9" fill="#687244" /><path d="m18 35 8 6-5 7M23 57l-5 5m16-6 6 5" fill="none" stroke="#504933" strokeWidth="2" /><circle cx="8" cy="14" r="3" fill="#a6b773" /></g>;
    case 'pixel-dragon':
      return <g shapeRendering="crispEdges" stroke="none"><path d="M12 28h8V16h8v-8h8v8h16v8h8v16H44v8h-8v8H12v-8H4V32h8" fill="#354f48" /><path d="M20 28h8V16h8v8h16v8h-8v8H32v8H16V36h4" fill="#7ea582" /><path d="M28 36h8v12h-8v8H12v-8h12Z" fill="#e5c46e" /><path d="M36 24h8v8h-8" fill="#f2efcf" /><path d="M40 24h4v4h-4M52 36h8v4h-8" fill="#283531" /><path d="M12 36H4V24h8V12h8v20h-8" fill="#aa6855" /><path d="M48 52h4v4h-4M56 48h4v4h-4" fill="#8eab7a" /></g>;
    case 'moon-owl':
      return <g stroke="none"><circle cx="47" cy="16" r="11" fill="#dfcf91" /><circle cx="51" cy="12" r="10" fill="#18293d" /><path d="M6 61 60 55" stroke="#755b54" strokeWidth="4" /><path d="m13 20 11 8 16-2 9-9 3 31-18 14-22-12Z" fill="#63758d" /><path d="m13 20 21 21 15-24-3 33-12 12-17-13Z" fill="#8896a1" /><ellipse cx="24" cy="36" rx="10" ry="11" fill="#ded6bc" /><ellipse cx="42" cy="34" rx="9" ry="10" fill="#ded6bc" /><ellipse cx="27" cy="37" rx="3" ry="5" fill="#29374a" /><ellipse cx="40" cy="35" rx="2.5" ry="4" fill="#29374a" /><path d="m29 43 8-1-3 8Z" fill="#d4a666" /><path d="m23 53 3 4m7-4 2 4m7-6-1 4" stroke="#dad4c3" strokeWidth="1.4" /><circle cx="13" cy="9" r="1" fill="#e7e2c6" /></g>;
    case 'chrome-visor':
      return <g stroke="none"><path d="M5 64 18 49h28l15 15" fill="#596479" /><path d="M14 25 21 12l21-4 11 17-5 23-14 10-18-11Z" fill="#bccbd0" /><path d="m21 12 8 17-13 18-2-22Z" fill="#718698" /><path d="m29 29 13-21 11 17-5 23-14 10Z" fill="#e1ded1" /><path d="m17 25 32-4 1 15-29 7Z" fill="#171d2e" /><path d="m20 28 25-3 1 7-23 5Z" fill="#ef9562" /><path d="m22 29 12-2" stroke="#ffdec2" strokeWidth="2" /><path d="m28 48 12-2" stroke="#65798a" strokeWidth="2" /><path d="M17 10 13 6M55 43l4 2" stroke="#748492" /></g>;
    case 'prism-face':
      return <g stroke="none"><path d="M9 23 29 6l21 8 9 25-19 19-24-8Z" fill="#8050a2" /><path d="m9 23 26-5-8 24-11 8Z" fill="#f29483" /><path d="m29 6 6 12 15-4" fill="#ebbb77" /><path d="m35 18 24 21-32 3Z" fill="#5fa4bc" /><path d="m27 42 13 16 19-19" fill="#44458b" /><path d="m16 28 10-2-5 7m19-8 9 4-8 3" fill="#1b274c" /><path d="m32 31 2 9-5 1m1 6 10-1" fill="none" stroke="#fbe3cb" strokeWidth="1.7" /><path d="m4 55 6 3m43 2 7-2" stroke="#a7649e" strokeWidth="2" /></g>;
    case 'pixel-sentinel':
      return <g shapeRendering="crispEdges" stroke="none"><path d="M0 16h64v2H0m0 30h64v2H0" fill="#463356" /><path d="M16 14h28v7h8v28h-8v8H16v-8H8V28h8Z" fill="#8d79c0" /><path d="M24 7h12v7H24M16 21h28v7H16" fill="#bca4e7" /><path d="M16 28h32v14H16Z" fill="#191d3a" /><path d="M20 32h8v4h-8m16-4h8v4h-8" fill="#b4f0d8" /><path d="M24 46h12v4H24" fill="#f4c689" /><path d="M12 56h40v8H12" fill="#57638b" /><path d="M56 9h4v4h-4M4 48h4v4H4" fill="#c8a9e4" /></g>;
    case 'neon-orbit':
      return <g stroke="none"><circle cx="31" cy="32" r="19" fill="#472b74" /><path d="M15 19q27-10 34 15L28 50Z" fill="#8553ac" /><path d="m27 13 15 19-18 18-8-28" fill="#443277" /><ellipse cx="32" cy="33" rx="28" ry="9" transform="rotate(-33 32 33)" stroke="#ef9e9d" strokeWidth="2.4" fill="none" /><path d="m24 28 4-1m11-2 4-1m-11 5-2 8 6-1" stroke="#c1def1" strokeWidth="1.8" fill="none" /><path d="m30 42 8-2" stroke="#ecb7c5" strokeWidth="1.4" /><circle cx="55" cy="14" r="3" fill="#eec791" /><circle cx="13" cy="53" r="1.5" fill="#d1c4eb" /></g>;
    case 'ink-reader':
      return <g stroke="#343637" strokeWidth="1.3"><path d="M7 64c3-17 16-17 21-20h10c9 4 20 7 23 20" fill="#7e8c7e" stroke="none" /><path d="m25 42 1 11 14 1-5-14" fill="#d4b794" /><path d="M19 24c0-19 30-19 28 5l-3 10-12 10-12-11Z" fill="#dfc7a8" /><path d="M17 30c-8-20 2-22 12-25 22-2 26 12 19 25l-5-14-17 5-5 14Z" fill="#343637" /><path d="m26 30 5 1m7-2 6-1m-9 3-1 7 4-1m-10 5 10 1" fill="none" /><path d="M9 59 25 54l7 8 7-10 17 8" fill="#dfd5c1" stroke="none" /><path d="m8 19 5-3m42 16 4-2" opacity=".3" /></g>;
    case 'coral-editor':
      return <g stroke="none"><path d="M0 51 23 44l22 3 19 17H0" fill="#273f51" /><path d="m25 34-1 17 16 5 1-17" fill="#935f49" /><path d="M18 20 39 13l13 17-10 16-18-2-10-13Z" fill="#b48262" /><path d="m33 18 6-5 13 17-10 16-12-9Z" fill="#d3a27c" /><path d="M13 30C2 6 42-2 48 18l-9-2-8 8-10-1-1 12Z" fill="#332d31" /><path d="M20 26h12v9H20m15-11 13 1v8H35m-3-5h3" fill="none" stroke="#e7d7ad" strokeWidth="2" /><path d="m36 34 5 3-5 2m-9 1 10 3" stroke="#533b37" strokeWidth="1.4" fill="none" /><path d="m12 53 12-4 3 9-8 6" fill="#5f8b96" /></g>;
    case 'aqua-pilot':
      return <g stroke="none"><path d="M4 64 17 45l25-1 19 20" fill="#8bbbc2" /><path d="M22 39v11l14 6 8-9-5-11" fill="#c88877" /><path d="M14 23 32 13l16 9-4 19-14 9-11-13Z" fill="#f0b19a" /><path d="m35 17 13 5-4 19-14 9 2-18Z" fill="#c98989" /><path d="m9 31 3-19L28 5l21 7 7 18-13-7-6-8-8 13-6-8-8 16Z" fill="#182439" /><path d="m17 16 10-6 10 1-15 9Z" fill="#50b5c8" /><path d="m20 30 8-2-3 6m10-6 7-1-3 6" fill="#173a51" /><path d="m29 34-1 5 4-1m-7 6 9-1" fill="none" stroke="#784954" strokeWidth="1.2" /><path d="m17 49 7 12 6-10m13-5-7 12 17 6" fill="#d5e3d7" /><circle cx="50" cy="40" r="2" fill="#cfa866" /></g>;
    case 'quant':
      return <><path d="m32 13 17 10v19L32 52 15 42V23Z" strokeWidth="2" /><path d="m24 26 8-5 9 5v11l-9 5-8-5Z" strokeWidth="3" /><path d="m35 36 12 13" strokeWidth="4" /><path d="M19 23 32 15" opacity=".35" strokeWidth="4" /></>;
    case 'red-dot':
      return <><circle cx="33" cy="25" r="11" fill="currentColor" stroke="none" /><path d="M17 44h30M23 49h18" strokeWidth="2" opacity=".7" /><circle cx="32" cy="32" r="23" strokeWidth=".8" opacity=".3" /></>;
    case 'globe':
      return <><circle cx="32" cy="32" r="19" strokeWidth="1.8" /><ellipse cx="32" cy="32" rx="9" ry="19" strokeWidth="1.4" /><path d="M14 26h36M14 38h36M32 13v38" strokeWidth="1.2" /><path d="m14 43 34-22" strokeWidth="3" /></>;
    case 'mountain':
      return <><path d="m10 44 15-25 9 16 6-10 14 19Z" fill="currentColor" stroke="none" /><path d="m25 20 2 22 7-7Z" fill="#293238" stroke="none" /><path d="M12 49h40" strokeWidth="1.3" opacity=".55" /><circle cx="45" cy="15" r="3" fill="currentColor" stroke="none" /></>;
    case 'mandala':
      return <><g strokeWidth="1.4">{[0, 45, 90, 135].map(angle => <ellipse key={angle} cx="32" cy="32" rx="9" ry="21" transform={`rotate(${angle} 32 32)`} />)}</g><circle cx="32" cy="32" r="5" fill="currentColor" stroke="none" /></>;
    case 'coffee':
      return <><path d="M17 28h27v8a13.5 13.5 0 0 1-27 0Z" fill="currentColor" stroke="none" /><path d="M44 29h3a6 6 0 0 1 0 12h-5M15 49h33M26 14c-5 4 5 5 0 10M35 13c-5 4 5 5 0 10" strokeWidth="2.2" /></>;
    case 'atlas':
      return <><circle cx="32" cy="32" r="23" opacity=".35" strokeWidth="1" /><path d="m16 46 16-29 16 29M23 36h18" strokeWidth="3.5" /><path d="M11 28c12-7 30-7 42 0" strokeWidth="1.2" opacity=".6" /></>;
    case 'river':
      return <><path d="M15 18c7-6 13 6 20 0s13 6 16 0M13 31c7-6 13 6 20 0s13 6 18 0M13 44c7-6 13 6 20 0s13 6 18 0" strokeWidth="3.5" /><path d="M20 13v39" opacity=".18" strokeWidth="10" /></>;
    case 'constellation':
      return <><path d="m17 19 25 3-6 16-16 7-3-26 19 19 12 11" opacity=".55" strokeWidth="1.2" /><g fill="currentColor" stroke="none">{[[17, 19, 3.4], [42, 22, 2.8], [36, 38, 3.7], [20, 45, 2.2], [48, 49, 2], [45, 12, 1], [12, 34, 1.2]].map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}</g></>;
    case 'tiger':
      return <><path d="m14 15 11 6 7-3 7 3 11-6-1 25-17 13-17-13Z" strokeWidth="2" /><path d="m17 28 9 3m21-3-9 3M27 39h10l-5 6ZM26 20l6 10 6-10" strokeWidth="2.5" /><path d="M20 38h4m16 0h4" strokeWidth="2" /></>;
    case 'flow':
      return <><path d="M18 16c2 9 8 15 15 17l-5 18 8-2 6-35-9 17C25 28 24 18 18 16Z" fill="currentColor" stroke="none" /><path d="M13 44c12-5 27-5 39-2" opacity=".6" strokeWidth="1.2" /></>;
    case 'leaf':
      return <><path d="M15 44C13 22 31 13 50 15c0 18-8 34-27 32" fill="currentColor" fillOpacity=".18" strokeWidth="2" /><path d="m16 49 26-26M24 40l-1-11m9 3 10 1" strokeWidth="2.5" /></>;
    case 'delta':
      return <><path d="m32 14 22 37H10Z" strokeWidth="2.2" /><path d="m32 27 12 20H20Z" fill="currentColor" stroke="none" /><path d="M17 55h30" strokeWidth="1" opacity=".5" /></>;
    case 'nexa':
      return <><path d="M17 47V17l30 30V17" strokeWidth="4.5" /><circle cx="17" cy="17" r="4" fill="currentColor" stroke="none" /><circle cx="47" cy="47" r="4" fill="currentColor" stroke="none" /></>;
    case 'kite':
      return <><path d="m34 11 18 21-22 12-15-19Z" fill="currentColor" fillOpacity=".22" strokeWidth="1.8" /><path d="m34 11-4 33m-15-19 37 7M30 44c-15 0-4 10-16 10" strokeWidth="1.5" /></>;
    case 'zen':
      return <><path d="M44 16c-19-13-38 10-29 27 6 12 25 12 33 2 8-9 3-23-3-27" strokeWidth="5" /><circle cx="34" cy="31" r="3" fill="currentColor" stroke="none" /></>;
    case 'lion':
      return <><path d="m32 10 17 8 7 18-12 17H21L8 36l7-18Z" strokeWidth="1.8" /><path d="m22 24 10 4 10-4 3 13-13 11-13-11Z" fill="currentColor" fillOpacity=".2" strokeWidth="1.6" /><path d="m25 34 3 1m8 0 3-1m-11 6h8l-4 5Z" strokeWidth="2.5" /></>;
    case 'blocks':
      return <><path d="m12 21 13-7 13 7-13 8Zm13 8v14l-13-7V21m26 0v14l-13 8m5-9 13-7 13 7-13 8Zm13 8v14l-13-7V34m26 0v14l-13 8" strokeWidth="1.7" /></>;
    case 'dragon':
      return <><path d="m13 43 8-5-2-11 11-11 13 2 8 10-11 1-8-6-5 7 10 10-1 10-15 2 7-8" strokeWidth="2.2" /><path d="m30 16 1-7 7 9m5 0 4-6 1 12" strokeWidth="1.7" /><circle cx="40" cy="23" r="1.7" fill="currentColor" stroke="none" /></>;
    case 'whale':
      return <><path d="M11 34c0-11 22-16 30-7l7 2 5-7 1 16-10-2c-4 18-32 16-33-2Z" fill="currentColor" fillOpacity=".28" strokeWidth="1.8" /><circle cx="21" cy="31" r="2" fill="currentColor" stroke="none" /><path d="M25 17v-6m-4 5-4-4m12 4 4-4M13 51h30" strokeWidth="1.7" /></>;
    case 'lightning':
      return <><path d="M35 10 16 35h14l-3 19 21-29H34Z" fill="currentColor" stroke="none" /><path d="M16 14 11 20m36 24 5-7" strokeWidth="1.7" opacity=".6" /></>;
    case 'owl':
      return <><path d="m14 15 11 7h14l11-7-1 28-17 11-17-11Z" strokeWidth="1.7" /><circle cx="24" cy="33" r="8" strokeWidth="2" /><circle cx="40" cy="33" r="8" strokeWidth="2" /><circle cx="24" cy="33" r="2.8" fill="currentColor" stroke="none" /><circle cx="40" cy="33" r="2.8" fill="currentColor" stroke="none" /><path d="m29 44 3 4 3-4" strokeWidth="2" /></>;
    case 'monogram':
      return <><circle cx="32" cy="32" r="23" strokeWidth=".8" opacity=".35" /><text x="32" y="40" fill="currentColor" stroke="none" fontSize="23" fontWeight="600" letterSpacing="-1.6" fontFamily="Georgia, serif" textAnchor="middle">{initials}</text></>;
  }
}

export function TraderAvatarArt({ traderId }: { traderId: string }) {
  const visual = getTraderVisual(traderId);
  if (!visual.mark) return null;
  return <svg viewBox="0 0 64 64" width="100%" height="100%" fill="none"
    aria-hidden="true" focusable="false" style={{ display: 'block', color: visual.accent }}>
    <circle cx="32" cy="32" r="32" fill={visual.background} />
    <circle cx="32" cy="32" r="31" stroke="currentColor" strokeWidth="1" opacity=".18" />
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <Mark kind={visual.mark} initials={visual.initials} />
    </g>
  </svg>;
}
