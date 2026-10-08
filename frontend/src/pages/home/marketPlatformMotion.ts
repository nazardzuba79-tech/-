// One orbital market scene, as in the owner's approved hero image: a large
// centre medallion, the rest on a tilted elliptical orbit above the platform.
// Every asset follows the same closed path, offset by one step:
//   centre (hold) -> eased exit to the lower-left of the orbit -> one smooth
//   lap up the left, behind the centre over the top, down the right ->
//   eased rise from the lower right back into the centre.
// The incoming and outgoing medallions swap together, so the centre is never
// empty or doubled. Positions are design pixels of a 460x690 stage that CSS
// scales as one object. Transform, opacity and translate (depth) only: one
// compositor animation per medallion, no frame loop or timer.
export const MARKET_STEP_MS = 2500;
export const MARKET_SWAP_MS = 1200;
export const ORBIT_ASSETS = 9;
export const MARKET_CYCLE_MS = MARKET_STEP_MS * ORBIT_ASSETS;
export const ORBIT = {
  width: 460, height: 690, centreX: 230, centreY: 290,
  coin: 170, rx: 144, ry: 222, tiltDeg: 8, depth: 100,
  frontScale: .64, backScale: .55, turnDeg: 14, perspective: 900,
  centreDepth: 150, incomingDepth: 175, outgoingDepth: 60, float: 5,
} as const;
export const EXIT_EASING = 'cubic-bezier(.45,.05,.55,.85)';
export const ENTRY_EASING = 'cubic-bezier(.3,.12,.35,1)';
export type OrbitProfile = 'desktop' | 'mobile';

const rad = (degrees: number) => degrees * Math.PI / 180;
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const ORBIT_MS = MARKET_CYCLE_MS - MARKET_STEP_MS - MARKET_SWAP_MS;

// Medallions travel at constant speed along the ellipse (equal arc length),
// so neighbours stay evenly spaced on the tall sides and the tight ends alike.
const ARC_SAMPLES = 720;
const arcTable: number[] = [0];
for (let i = 1; i <= ARC_SAMPLES; i++) {
  const a = rad(360 * (i - 1) / ARC_SAMPLES), b = rad(360 * i / ARC_SAMPLES);
  arcTable.push(arcTable[i - 1] + Math.hypot(ORBIT.rx * (Math.cos(b) - Math.cos(a)), ORBIT.ry * (Math.sin(b) - Math.sin(a))));
}
export const ORBIT_PERIMETER = arcTable[ARC_SAMPLES];
/** Orbit angle at a fraction of the perimeter measured from 0deg (the right). */
export function angleAtArc(fraction: number) {
  const laps = Math.floor(fraction), target = (fraction - laps) * ORBIT_PERIMETER;
  let lo = 0, hi = ARC_SAMPLES;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arcTable[mid] < target) lo = mid; else hi = mid; }
  const span = arcTable[hi] - arcTable[lo] || 1;
  return 360 * laps + 360 * (lo + (target - arcTable[lo]) / span) / ARC_SAMPLES;
}
const arcAtAngle = (degrees: number) => { const turns = Math.floor(degrees / 360), i = (degrees - 360 * turns) / 360 * ARC_SAMPLES, lo = Math.floor(i); return turns + (arcTable[lo] + (arcTable[Math.min(lo + 1, ARC_SAMPLES)] - arcTable[lo]) * (i - lo)) / ORBIT_PERIMETER; };

/** The gap where the orbit meets the centre equals the spacing between
 * neighbours, so the orbit always reads as evenly filled. */
export const ORBIT_GAP = MARKET_STEP_MS / (MARKET_CYCLE_MS - MARKET_SWAP_MS);
const FRONT_ARC = arcAtAngle(90);
const EXIT_ARC = FRONT_ARC + ORBIT_GAP / 2;
const ENTRY_ARC = EXIT_ARC + 1 - ORBIT_GAP;
export const EXIT_DEG = angleAtArc(EXIT_ARC);
export const ENTRY_DEG = angleAtArc(ENTRY_ARC);

export interface OrbitPose { x: number; y: number; z: number; scale: number; turn: number; opacity: number }

/** A point on the tilted orbit; 90deg is the front (nearest, largest). */
export function orbitPose(degrees: number, profile: OrbitProfile = 'desktop'): OrbitPose {
  const ex = ORBIT.rx * Math.cos(rad(degrees)), ey = ORBIT.ry * Math.sin(rad(degrees));
  const tilt = rad(ORBIT.tiltDeg), near = (1 + Math.sin(rad(degrees))) / 2;
  const opacity = profile === 'mobile'
    // Phones keep the centre and the front of the orbit: two to four helpers.
    ? Math.min(1, Math.max(0, (Math.sin(rad(degrees)) - .25) / .2))
    // Desktop keeps every medallion opaque (as in the approved image): depth
    // reads through scale and overlap, and opaque layers composite cleanly.
    : 1;
  return {
    x: round(ex * Math.cos(tilt) - ey * Math.sin(tilt)),
    y: round(ex * Math.sin(tilt) + ey * Math.cos(tilt)),
    z: round(ORBIT.depth * Math.sin(rad(degrees))),
    scale: round(ORBIT.backScale + (ORBIT.frontScale - ORBIT.backScale) * near, 4),
    turn: round(-ORBIT.turnDeg * Math.cos(rad(degrees)), 2),
    opacity: round(opacity, 3),
  };
}
const centrePose = (lift = 0): OrbitPose => ({ x: 0, y: lift ? -lift : 0, z: ORBIT.centreDepth, scale: 1, turn: 0, opacity: 1 });

export function orbitTransform(pose: OrbitPose) {
  return `translate3d(${pose.x}px, ${pose.y}px, 0px) perspective(${ORBIT.perspective}px) rotateY(${pose.turn}deg) scale(${pose.scale})`;
}
const depth = (z: number) => `0px 0px ${round(z, 1)}px`;

/** One full cycle for one medallion; every medallion shares it, offset by one step. */
export function marketTileFrames(profile: OrbitProfile = 'desktop'): Keyframe[] {
  const T = MARKET_CYCLE_MS, S = MARKET_STEP_MS, m = MARKET_SWAP_MS;
  const at = (ms: number) => round(ms / T, 6);
  const frames: Keyframe[] = [];
  const pose = (ms: number, value: OrbitPose, easing?: string) => frames.push({ offset: at(ms), transform: orbitTransform(value), opacity: value.opacity, ...(easing ? { easing } : {}) });
  const z = (ms: number, value: number) => frames.push({ offset: at(ms), translate: depth(value) });
  pose(0, centrePose(), 'ease-in-out');
  pose((S - m) / 2, centrePose(ORBIT.float), 'ease-in-out');
  pose(S - m, centrePose(), EXIT_EASING);
  const segments = 48;
  const along = (i: number) => angleAtArc(EXIT_ARC + (ENTRY_ARC - EXIT_ARC) * i / segments);
  for (let i = 0; i <= segments; i++) pose(S + ORBIT_MS * i / segments, orbitPose(along(i), profile), i === segments ? ENTRY_EASING : 'linear');
  pose(T, centrePose());
  // Depth decides overlap during the swap: the incoming medallion moves in
  // front at once, the outgoing one steps behind it.
  z(0, ORBIT.centreDepth);
  z(S - m, ORBIT.centreDepth);
  z(S - m * .85, ORBIT.outgoingDepth);
  z(S, orbitPose(EXIT_DEG).z);
  for (let i = 1; i < segments; i++) z(S + ORBIT_MS * i / segments, orbitPose(along(i)).z);
  z(T - m, orbitPose(ENTRY_DEG).z);
  z(T - m * .85, ORBIT.incomingDepth);
  z(T, ORBIT.centreDepth);
  return frames.sort((a, b) => Number(a.offset) - Number(b.offset));
}

/** Steps into the shared cycle at which asset `index` starts; index 0 holds the centre. */
export function initialMarketPose(index: number) {
  return ((ORBIT_ASSETS - index) % ORBIT_ASSETS + ORBIT_ASSETS) % ORBIT_ASSETS;
}

/** Where asset `index` rests in the complete static composition (reduced motion, no WAAPI). */
export function restingPose(index: number, profile: OrbitProfile = 'desktop'): OrbitPose {
  const local = initialMarketPose(index) * MARKET_STEP_MS;
  if (local < MARKET_STEP_MS) return centrePose();
  return orbitPose(angleAtArc(EXIT_ARC + (ENTRY_ARC - EXIT_ARC) * Math.min(1, (local - MARKET_STEP_MS) / ORBIT_MS)), profile);
}

/** Analytic pose of asset `index` at `ms` into the shared clock (swap legs
 * linear). Used by tests and QA to reason about spacing and visibility. */
export function orbitPoseAt(index: number, ms: number, profile: OrbitProfile = 'desktop'): OrbitPose & { phase: 'centre' | 'exit' | 'orbit' | 'entry' } {
  const T = MARKET_CYCLE_MS, S = MARKET_STEP_MS, m = MARKET_SWAP_MS;
  const local = ((ms + initialMarketPose(index) * S) % T + T) % T;
  const mix = (a: OrbitPose, b: OrbitPose, t: number): OrbitPose => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, scale: a.scale + (b.scale - a.scale) * t, turn: a.turn + (b.turn - a.turn) * t, opacity: a.opacity + (b.opacity - a.opacity) * t });
  if (local < S - m) return { ...centrePose(), phase: 'centre' };
  if (local < S) return { ...mix(centrePose(), orbitPose(EXIT_DEG, profile), (local - (S - m)) / m), phase: 'exit' };
  if (local < T - m) return { ...orbitPose(angleAtArc(EXIT_ARC + (ENTRY_ARC - EXIT_ARC) * (local - S) / ORBIT_MS), profile), phase: 'orbit' };
  return { ...mix(orbitPose(ENTRY_DEG, profile), centrePose(), (local - (T - m)) / m), phase: 'entry' };
}
