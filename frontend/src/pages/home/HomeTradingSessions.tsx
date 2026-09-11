import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Clock3, Pause, Play } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { MotionStage } from './HomeMotion';
import { buildTradingSessionState } from './tradingSessions';
import { TRADING_SESSIONS_COPY } from './tradingSessionsCopy';

type Region = 'asia' | 'europe' | 'usa';
type Copy = typeof TRADING_SESSIONS_COPY.en;

// Geography only. Trading hours and time zones belong to tradingSessions.ts.
const CENTRES: { name: keyof Copy['cities']; region: Region; x: number; y: number; labelX: number; labelY: number; leader: string }[] = [
  { name: 'New York', region: 'usa', x: 265, y: 111, labelX: 27.8, labelY: 37, leader: 'M265 118V147' },
  { name: 'London', region: 'europe', x: 450, y: 84, labelX: 42, labelY: 12, leader: 'M444 82 422 56H403' },
  { name: 'Frankfurt', region: 'europe', x: 472, y: 87, labelX: 59, labelY: 21, leader: 'M479 87H510' },
  { name: 'Zürich', region: 'europe', x: 471, y: 94, labelX: 50.5, labelY: 39, leader: 'M471 101 486 141 466 160' },
  { name: 'Tokyo', region: 'asia', x: 799, y: 123, labelX: 87, labelY: 17, leader: 'M799 116V91' },
  { name: 'Hong Kong', region: 'asia', x: 735, y: 157, labelX: 81, labelY: 47, leader: 'M735 164V189' },
  { name: 'Singapore', region: 'asia', x: 710, y: 209, labelX: 69, labelY: 65, leader: 'M703 215 674 252 647 270' },
];

// Reused from the previous homepage map; deliberately stylized geography.
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

function countdown(milliseconds: number | null) {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—';
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function HomeTradingSessions({ now: clockOverride }: { now?: Date } = {}) {
  const { lang } = useLanguage();
  const copy = TRADING_SESSIONS_COPY[lang];
  const section = useRef<HTMLElement>(null);
  const id = `vx-sessions-${useId().replace(/:/g, '')}`;
  const [clock, setClock] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const instant = clockOverride?.getTime() ?? clock;
  const state = useMemo(() => buildTradingSessionState(new Date(instant)), [instant]);
  const city = (name: string) => copy.cities[name as keyof Copy['cities']] ?? name;
  const activeIds = new Set(state.activeSessions.map(session => session.id));
  const status = (value: string) => value === 'ACTIVE' ? copy.active : value === 'UPCOMING' ? copy.upcoming : copy.closed;

  useEffect(() => {
    if (clockOverride) return;
    let visible = false;
    let timer: number | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      if (!visible || document.hidden) return;
      const current = Date.now();
      setClock(current);
      // One local, minute-aligned clock. No market requests or polling.
      timer = window.setTimeout(sync, 60_000 - current % 60_000 + 25);
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    if (observer && section.current) observer.observe(section.current);
    if (!observer) { visible = true; sync(); }
    document.addEventListener('visibilitychange', sync);
    return () => { observer?.disconnect(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', sync); };
  }, [clockOverride]);

  return <section id="trading-sessions" ref={section} className="vx-sessions" data-motion-paused={paused} aria-labelledby={`${id}-title`}>
    <header className="vx-sessions-heading">
      <div>
        <p className="vx-sessions-eyebrow"><span />{copy.eyebrow}</p>
        <h2 id={`${id}-title`}>{copy.title}<br /><span>{copy.titleEnd}</span></h2>
      </div>
      <div className="vx-sessions-intro">
        <span className="vx-sessions-crypto"><i aria-hidden="true" />{copy.crypto}</span>
        <p>{copy.description}</p>
      </div>
    </header>

    <MotionStage className="vx-sessions-stage">
      {/* First in DOM so mobile reads current → next → overlap → map. */}
      <aside className="vx-session-dashboard" aria-label={copy.current}>
        <div className="vx-session-current">
          <p className="vx-session-kicker"><span className={activeIds.size ? 'vx-session-dot is-active' : 'vx-session-dot'} />{copy.current}</p>
          <h3>{state.activeSessions.length ? state.activeSessions.map(session => session.label).join(' + ') : copy.noActive}</h3>
          {state.activeSessions.map(session => <div className="vx-current-region" key={session.id} data-current-session={session.id}>
            {state.activeSessions.length > 1 && <span className="vx-current-region-name">{session.label}</span>}
            <dl className="vx-session-hub-times" aria-label={`${session.label} · ${copy.localTime}`}>
              {session.hubs.map(hub => <div key={hub.name}><dt>{city(hub.name)}</dt><dd><time dateTime={new Date(instant).toISOString()} title={hub.zone}>{hub.localTime}</time></dd></div>)}
            </dl>
            <p className="vx-session-countdown">{copy.closes}<strong>{countdown(session.closesInMs)}</strong></p>
          </div>)}
          {!state.activeSessions.length && <span className="vx-session-between"><Clock3 size={16} />{copy.crypto}</span>}
        </div>
        <div className="vx-session-next">
          <p className="vx-session-kicker">{copy.next}<ArrowUpRight size={14} aria-hidden="true" /></p>
          <div><strong>{state.nextSession.label}</strong><span>{copy.opens}<b>{countdown(state.nextSession.nextOpen - state.now)}</b></span></div>
        </div>
        <div className={`vx-session-overlap${state.overlaps.length ? ' is-active' : ''}`}>
          <p className="vx-session-kicker"><span className="vx-overlap-symbol" aria-hidden="true"><i /><i /></span>{state.overlaps.length ? copy.overlap : copy.nextOverlap}</p>
          {state.overlaps.length ? state.overlaps.map(overlap => <div key={overlap.sessionIds.join('-')}>
            <strong>{overlap.label}</strong>
            <p className="vx-session-countdown">{copy.ends}<b>{countdown(overlap.endsInMs)}</b></p>
          </div>) : state.nextOverlap ? <div>
            <strong>{state.nextOverlap.label}</strong>
            <p className="vx-session-countdown">{copy.starts}<b>{countdown(state.nextOverlap.startsInMs)}</b></p>
          </div> : <p>{copy.noOverlap}</p>}
          {state.overlaps.length > 0 && <small>{copy.overlapNote}</small>}
        </div>
      </aside>

      <div className="vx-session-geography">
        <div className="vx-session-map" role="img" aria-label={`${copy.map}: ${state.activeSessions.map(session => session.label).join(' + ') || copy.noActive}`}>
          <svg viewBox="0 0 900 430" fill="none" aria-hidden="true">
            <defs>
              <pattern id={`${id}-dots`} width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#829bb4" /></pattern>
              <linearGradient id={`${id}-land`} x1="450" y1="20" x2="450" y2="420" gradientUnits="userSpaceOnUse"><stop stopColor="#23394c" /><stop offset="1" stopColor="#101c28" /></linearGradient>
              <radialGradient id={`${id}-halo`}><stop stopColor="#d9ac5b" stopOpacity=".16" /><stop offset="1" stopColor="#d9ac5b" stopOpacity="0" /></radialGradient>
            </defs>
            {[85, 160, 235, 310, 385].map(y => <path key={`h${y}`} d={`M20 ${y}H880`} className="vx-session-map-grid" />)}
            {[150, 300, 450, 600, 750].map(x => <path key={`v${x}`} d={`M${x} 20V410`} className="vx-session-map-grid" />)}
            {LAND.map((d, index) => <g key={index}><path d={d} fill={`url(#${id}-land)`} stroke="#66839d" strokeOpacity=".22" /><path d={d} fill={`url(#${id}-dots)`} opacity=".35" /></g>)}
            {[
              { path: 'M265 111Q353 7 450 84', active: activeIds.has('usa') && activeIds.has('europe') },
              { path: 'M450 84Q643 -8 799 123', active: activeIds.has('europe') && activeIds.has('asia') },
              { path: 'M799 123Q757 118 735 157Q731 186 710 209', active: activeIds.has('asia') },
              { path: 'M450 84Q466 71 472 87L471 94', active: activeIds.has('europe') },
            ].map((route, index) => <g key={index} className={`vx-session-map-route${route.active ? ' is-active' : ''}`}><path d={route.path} /><path d={route.path} pathLength="100" className="vx-session-route-signal" /></g>)}
            {CENTRES.map(centre => <g key={centre.name} className={`vx-session-map-node${activeIds.has(centre.region) ? ' is-active' : ''}`}>
              {activeIds.has(centre.region) && <circle cx={centre.x} cy={centre.y} r="68" fill={`url(#${id}-halo)`} />}
              <path d={centre.leader} className="vx-session-map-leader" />
              <circle className="vx-session-node-ring" cx={centre.x} cy={centre.y} r="12" />
              <circle className="vx-session-node-core" cx={centre.x} cy={centre.y} r="3.8" />
            </g>)}
          </svg>
          {CENTRES.map(centre => <span key={centre.name} className={`vx-session-map-label${activeIds.has(centre.region) ? ' is-active' : ''}`} style={{ left: `${centre.labelX}%`, top: `${centre.labelY}%` }} aria-hidden="true">{city(centre.name)}</span>)}
          <div className="vx-session-map-region vx-session-map-americas" data-active={activeIds.has('usa')} aria-hidden="true">USA</div>
          <div className="vx-session-map-region vx-session-map-europe" data-active={activeIds.has('europe')} aria-hidden="true">EUROPE</div>
          <div className="vx-session-map-region vx-session-map-asia" data-active={activeIds.has('asia')} aria-hidden="true">ASIA</div>
        </div>
        <div className="vx-session-map-legend">
          <span><i className="is-active" />{copy.activeKey}</span><span><i />{copy.inactiveKey}</span>
          <button type="button" aria-label={paused ? copy.resume : copy.pause} aria-pressed={paused} title={paused ? copy.resume : copy.pause} onClick={() => setPaused(value => !value)}>{paused ? <Play size={12} /> : <Pause size={12} />}</button>
        </div>
        <div className="vx-session-regions">
          {state.sessions.map(session => <article key={session.id} className={`vx-session-region${session.status === 'ACTIVE' ? ' is-active' : ''}`} data-session-id={session.id} data-status={session.status}>
            <header><h3>{session.label}</h3><span className="vx-session-status">{status(session.status)}</span></header>
            <div className="vx-session-region-clock"><time dateTime={new Date(instant).toISOString()} title={session.zone}>{session.localTime}</time><span title={copy.anchorTime}>{city(session.hubs[0].name)}</span></div>
            <p className="vx-session-region-hubs">{session.hubs.map(hub => city(hub.name)).join(' · ')}</p>
            <p className="vx-session-region-window" title={`${copy.window} · ${session.zone}`}>{session.localHours}<span>{copy.localTime}</span></p>
            <div className="vx-session-progress" role="progressbar" aria-label={`${session.label} · ${copy.elapsed}`} aria-valuenow={Math.round(session.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${session.progress * 100}%` }} /></div>
            <p className="vx-session-countdown">{session.status === 'ACTIVE' ? copy.closes : copy.opens}<strong>{countdown(session.status === 'ACTIVE' ? session.closesInMs : session.opensInMs)}</strong></p>
          </article>)}
        </div>
      </div>
    </MotionStage>
    <p className="vx-sessions-note"><Clock3 size={14} aria-hidden="true" /><span>{copy.note}</span></p>
  </section>;
}
