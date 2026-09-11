import { CSSProperties, useId } from 'react';

// Abstract decoration, not a map, live feed or connectivity claim.
const points = [[114,230],[225,168],[305,80],[410,135],[508,82],[688,100],[827,72],
  [950,180],[1070,248],[922,336],[823,431],[696,394],[584,453],[440,411],[274,375],[170,319],
  [348,266],[492,205],[739,223],[785,314],[563,339],[996,390],[194,96],[1090,113]];

export function HomeInstitutionNetwork() {
  const id = `vx-eco-net-${useId().replace(/:/g, '')}`;
  return (
    <svg className="vx-eco-network" viewBox="0 0 1200 520" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-fade`}><stop stopColor="white" /><stop offset=".66" stopColor="white" stopOpacity=".8" /><stop offset="1" stopColor="white" stopOpacity="0" /></radialGradient>
        <mask id={`${id}-mask`}><rect width="1200" height="520" fill={`url(#${id}-fade)`} /></mask>
        <linearGradient id={`${id}-arc`} x1="170" y1="80" x2="950" y2="420" gradientUnits="userSpaceOnUse"><stop stopColor="#70b5d8" stopOpacity=".04" /><stop offset=".45" stopColor="#6ba6c1" stopOpacity=".38" /><stop offset="1" stopColor="#b5a076" stopOpacity=".06" /></linearGradient>
        <pattern id={`${id}-grid`} width="60" height="52" patternUnits="userSpaceOnUse"><path d="M60 0H0V52" stroke="#6e9cb6" strokeOpacity=".09" strokeWidth=".7" /></pattern>
      </defs>
      <g mask={`url(#${id}-mask)`}>
        <rect className="vx-eco-network-grid" x="-60" y="-52" width="1320" height="624" fill={`url(#${id}-grid)`} />
        <g stroke={`url(#${id}-arc)`} strokeWidth=".8">
          <ellipse cx="600" cy="260" rx="400" ry="157" transform="rotate(-12 600 260)" />
          <ellipse cx="600" cy="260" rx="322" ry="194" transform="rotate(19 600 260)" />
          <ellipse cx="600" cy="260" rx="190" ry="239" transform="rotate(60 600 260)" />
          <path d="M108 292C326 40 808 490 1092 188M177 158C456 437 814 18 1035 348" />
        </g>
        <g stroke="#79a9c3" strokeOpacity=".13" strokeWidth=".65">
          <path d="M114 230L225 168L305 80L410 135L508 82L688 100L827 72L950 180L1070 248L922 336L823 431L696 394L584 453L440 411L274 375L170 319Z" />
          <path d="M225 168L348 266L410 135L492 205L508 82M492 205L739 223L688 100M739 223L950 180L785 314L922 336M348 266L274 375L563 339L440 411M563 339L696 394L785 314L823 431M194 96L305 80M950 180L1090 113M922 336L996 390" />
        </g>
        <g stroke="#93bfd2" strokeWidth="1" strokeOpacity=".32" className="vx-eco-data-paths">
          <path d="M114 230L225 168L410 135L492 205L739 223L950 180L1070 248" pathLength="100" />
          <path d="M170 319L274 375L440 411L563 339L785 314L922 336L996 390" pathLength="100" />
        </g>
        {points.map(([x,y], index) => <g key={`${x}-${y}`} className="vx-eco-data-node" style={{ '--vx-node-delay': `${-index * .71}s` } as CSSProperties}>
          <circle cx={x} cy={y} r="6" fill="#79afc8" opacity=".045" />
          <circle cx={x} cy={y} r="1.5" fill={index > 10 ? '#b4a084' : '#8abbd2'} opacity=".6" />
        </g>)}
        <g stroke="#6f9bb1" strokeOpacity=".16" strokeWidth=".8">
          <path d="M50 260H165M1035 260H1150M600 18V62M600 458V502M72 255V265M84 257V263M96 257V263M1104 257V263M1116 257V263M1128 255V265" />
          <circle cx="600" cy="260" r="90" strokeDasharray="1 11" />
          <path d="M512 228A94 94 0 0 1 617 168M688 292A94 94 0 0 1 583 352" />
        </g>
      </g>
    </svg>
  );
}
