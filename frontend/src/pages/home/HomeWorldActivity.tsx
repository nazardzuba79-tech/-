import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { localeOf, useLanguage } from '../../lib/i18n';
import { WORLD_MARKET_COPY } from './worldMarketCopy';

const CENTRES = [
  { code: 'NYC', zone: 'America/New_York', lon: -74.006, lat: 40.713 },
  { code: 'LON', zone: 'Europe/London', lon: -0.128, lat: 51.507 },
  { code: 'ZRH', zone: 'Europe/Zurich', lon: 8.542, lat: 47.377 },
  { code: 'FRA', zone: 'Europe/Berlin', lon: 8.682, lat: 50.111 },
  { code: 'DXB', zone: 'Asia/Dubai', lon: 55.270, lat: 25.205 },
  { code: 'SIN', zone: 'Asia/Singapore', lon: 103.820, lat: 1.352 },
  { code: 'HKG', zone: 'Asia/Hong_Kong', lon: 114.169, lat: 22.319 },
  { code: 'TYO', zone: 'Asia/Tokyo', lon: 139.692, lat: 35.690 },
];

const project = (lon: number, lat: number) => ({ x: (lon + 180) * 2.5, y: (85 - lat) * 2.5 });
// A deliberately stylized, decorative world silhouette; coordinates of the
// financial centres use the same simple equirectangular projection.
const LAND = [
  'M33 95 63 59 124 44 158 53 187 42 234 70 281 77 316 108 284 127 271 155 255 163 239 193 208 201 195 229 177 222 169 199 145 189 129 173 116 147 88 125 63 130Z',
  'M233 231 259 226 281 236 306 259 323 271 315 293 299 313 291 346 276 376 261 399 248 390 244 354 231 325 218 296 218 261Z',
  'M299 26 335 13 360 38 343 71 313 79 299 53Z',
  'M425 83 447 78 451 55 466 43 479 66 472 90 493 82 508 95 527 91 546 102 534 126 510 135 490 132 479 142 459 130 438 136 419 122Z',
  'M423 150 448 139 480 141 504 158 527 185 540 202 522 224 511 264 488 297 471 309 456 287 451 258 433 238 417 213 402 188Z',
  'M506 75 548 50 598 44 634 39 688 47 728 58 758 64 802 72 836 96 819 114 791 109 768 124 760 142 734 154 711 152 695 174 677 191 662 224 648 237 634 209 618 192 602 186 586 198 568 191 553 165 527 152 533 129 514 114Z',
  'M540 172 565 172 589 193 579 211 560 217 547 202Z',
  'M684 215 696 231 713 249 726 259 717 267 700 253 692 235Z',
  'M720 256 748 263 760 276 744 281 721 270Z',
  'M746 305 776 286 808 287 825 309 843 327 836 354 810 365 784 352 760 355 744 337Z',
  'M796 118 805 137 796 155 783 165 781 156 790 143Z',
  'M529 277 537 285 533 311 524 319 523 294Z',
  'M856 362 868 357 866 380 851 394 845 389Z',
];

export function HomeWorldActivity() {
  const { lang } = useLanguage();
  const copy = WORLD_MARKET_COPY[lang];
  const id = useId().replace(/:/g, '');
  const section = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [active, setActive] = useState(1);
  const [moving, setMoving] = useState(false);
  const formatters = useMemo(() => CENTRES.map(({ zone }) => ({
    time: new Intl.DateTimeFormat(localeOf(lang), { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    date: new Intl.DateTimeFormat(localeOf(lang), { timeZone: zone, day: 'numeric', month: 'short' }),
  })), [lang]);

  useEffect(() => {
    let visible = false;
    let timer: number | undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      window.clearTimeout(timer);
      const awake = visible && !document.hidden;
      setMoving(awake && !media.matches);
      if (!awake) return;
      setNow(Date.now());
      // One minute-aligned clock, only while this section is visible.
      timer = window.setTimeout(sync, 60_000 - Date.now() % 60_000 + 50);
    };
    const observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }) : null;
    if (observer && section.current) observer.observe(section.current);
    if (!observer) { visible = true; sync(); }
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', sync);
    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', sync);
    };
  }, []);

  const current = project(CENTRES[active].lon, CENTRES[active].lat);
  return (
    <section ref={section} className={`vx-world-section${moving ? ' vx-world-moving' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="vx-world-heading">
        <div>
          <p className="vx-section-eyebrow"><span />{copy.worldEyebrow}</p>
          <h2 id={`${id}-title`}>{copy.worldTitle}</h2>
        </div>
        <p className="vx-section-description">{copy.worldDescription}</p>
      </div>
      <div className="vx-world-stage">
        <div className="vx-world-map" aria-hidden="true">
          <svg viewBox="0 0 900 430" fill="none">
            <defs>
              <pattern id={`${id}-dots`} x="0" y="0" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.05" fill="#748396" /></pattern>
              <linearGradient id={`${id}-land`} x1="400" y1="40" x2="400" y2="420" gradientUnits="userSpaceOnUse"><stop stopColor="#26384b" /><stop offset="1" stopColor="#101820" /></linearGradient>
              <radialGradient id={`${id}-halo`}><stop stopColor="#c99736" stopOpacity=".15" /><stop offset="1" stopColor="#c99736" stopOpacity="0" /></radialGradient>
            </defs>
            <ellipse cx="475" cy="200" rx="375" ry="230" fill={`url(#${id}-halo)`} />
            {[85, 160, 235, 310, 385].map(y => <path key={`h${y}`} d={`M20 ${y}H880`} className="vx-world-gridline" />)}
            {[150, 300, 450, 600, 750].map(x => <path key={`v${x}`} d={`M${x} 20V410`} className="vx-world-gridline" />)}
            {LAND.map((d, index) => <g key={index}><path d={d} fill={`url(#${id}-land)`} stroke="#6b839b" strokeOpacity=".16" /><path d={d} fill={`url(#${id}-dots)`} opacity=".38" /></g>)}
            {CENTRES.map((centre, index) => {
              const point = project(centre.lon, centre.lat);
              return <g key={centre.code} className={index === active ? 'vx-world-node vx-world-node-active' : 'vx-world-node'}>
                {index === active && <circle className="vx-world-node-ring" cx={point.x} cy={point.y} r="15" />}
                <circle cx={point.x} cy={point.y} r={index === active ? 4 : 2.6} fill={index === active ? '#f1c469' : '#b7a37b'} />
              </g>;
            })}
            <path d={`M${current.x} ${current.y + 10}v28h${active > 5 ? -70 : 70}`} stroke="#ceaa65" strokeOpacity=".6" />
            <text x={current.x + (active > 5 ? -72 : 72)} y={current.y + 42} textAnchor={active > 5 ? 'end' : 'start'} fill="#e8d2a6" fontSize="11" letterSpacing="2">{CENTRES[active].code}</text>
          </svg>
          <div className="vx-world-featured-clock"><span>{copy.centres[active]}</span><strong>{formatters[active].time.format(now)}</strong><small>{copy.localTime} · {formatters[active].date.format(now)}</small></div>
        </div>
        <div className="vx-world-cities" aria-label={copy.localTime}>
          {CENTRES.map((centre, index) => <button key={centre.code} type="button" className={`vx-world-city${active === index ? ' vx-world-city-selected' : ''}`} aria-pressed={active === index} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}>
            <span className="vx-world-city-code">{centre.code}</span>
            <span className="vx-world-city-name">{copy.centres[index]}<small>{formatters[index].date.format(now)}</small></span>
            <time dateTime={new Date(now).toISOString()}>{formatters[index].time.format(now)}</time>
          </button>)}
        </div>
      </div>
      <p className="vx-world-note"><span aria-hidden="true">◷</span>{copy.clockNote}</p>
    </section>
  );
}
