import { getTraderVisual, type TraderMark } from './traderVisuals';

/** Original, decorative marks for demo strategy aliases. No badges or logos
 * from the reference exchange, and no relationship to account verification. */
function Mark({ kind, initials }: { kind: TraderMark; initials?: string }) {
  switch (kind) {
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
