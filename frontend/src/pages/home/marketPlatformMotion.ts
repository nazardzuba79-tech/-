// One orbital market scene, as in the owner's approved hero image: a large
// centre medallion and the other medallions on one vertical ring seen in
// perspective. The ring is turned about its vertical axis, so its front
// (left) is nearer and larger and its back (right) smaller and dimmer; the
// medallions rise on the front and descend behind. The ring opens at the
// bottom, above the platform's light, where the centre swaps happen.
// Every asset follows the same closed path, offset by one step:
//   centre (hold) -> eased drop to the lower-left end of the ring -> one lap
//   up the front, over the top, down the back to the lower-right end ->
//   a dip into the platform's light and an eased rise into the centre.
// The outgoing medallion leaves first and the incoming one follows a beat
// later on the other side of the light, so the two never cross; the dip
// also keeps the incoming medallion clear of the one descending behind it. Positions
// are design pixels of a 520x900 stage that CSS scales as one object.
// Transform, opacity and translate (depth) only: one compositor animation
// per medallion, no frame loop or timer.
export const MARKET_STEP_MS = 2500;
export const MARKET_SWAP_MS = 1400;
export const ORBIT_ASSETS = 8;
export const MARKET_CYCLE_MS = MARKET_STEP_MS * ORBIT_ASSETS;
export const ORBIT = {
  width: 520, height: 900, centreX: 260, centreY: 330,
  coin: 180, helper: 110, rx: 170, ry: 228, ringY: -40, depth: 164, focal: 1400,
  turnDeg: 12, backFade: .3, centreDepth: 200, incomingDepth: 235, outgoingDepth: 90, float: 5,
  /** Share of the swap window after which the incoming medallion starts, and
   * before whose end the outgoing one has landed: they move on opposite sides. */
  swapStagger: .45,
  /** Control points of the swap curves (design px from the centre): the
   * outgoing medallion swings down through the light before it lands on the
   * ring's lower-left end, the incoming one dips through the light from the
   * lower-right end before it rises. Both stay clear of the ring's ends. */
  exitDip: { x: -50, y: 130 },
  entryDip: { x: 10, y: 180 },
  platform: { width: 470, top: 623, left: 25 },
} as const;
export const EXIT_EASING = 'cubic-bezier(.45,.05,.55,.85)';
export const ENTRY_EASING = 'cubic-bezier(.3,.12,.35,1)';
export type OrbitProfile = 'desktop' | 'mobile';

const rad = (degrees: number) => degrees * Math.PI / 180;
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
/** CSS cubic-bezier(x1,y1,x2,y2) timing function, evaluated in JS so a
 * sampled curve can carry one easing over its whole length. */
export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number) {
  const axis = (a: number, b: number, t: number) => ((1 - t) ** 3) * 0 + 3 * ((1 - t) ** 2) * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) { const cx = axis(x1, x2, t); if (Math.abs(cx - x) < 1e-5) break; if (cx < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return axis(y1, y2, t);
  };
}
const exitEase = cubicBezierEasing(.45, .05, .55, .85);
const entryEase = cubicBezierEasing(.3, .12, .35, 1);
const SWAP_SAMPLES = 12;
/** The outgoing medallion lands on the ring this long into the cycle. */
export const EXIT_END_MS = MARKET_STEP_MS - MARKET_SWAP_MS * ORBIT.swapStagger;
/** The incoming medallion leaves the ring this long into the cycle. */
export const ENTRY_START_MS = MARKET_CYCLE_MS - MARKET_SWAP_MS * (1 - ORBIT.swapStagger);
const ORBIT_MS = ENTRY_START_MS - EXIT_END_MS;

// Medallions travel at constant speed along the projected ellipse (equal arc
// length), so neighbours stay evenly spaced on the tall sides and the tight
// ends alike. Angle 0 is the bottom of the ring; it increases up the front.
const ARC_SAMPLES = 720;
const arcTable: number[] = [0];
for (let i = 1; i <= ARC_SAMPLES; i++) {
  const a = rad(360 * (i - 1) / ARC_SAMPLES), b = rad(360 * i / ARC_SAMPLES);
  arcTable.push(arcTable[i - 1] + Math.hypot(ORBIT.rx * (Math.sin(b) - Math.sin(a)), ORBIT.ry * (Math.cos(b) - Math.cos(a))));
}
export const ORBIT_PERIMETER = arcTable[ARC_SAMPLES];
/** Ring angle at a fraction of the perimeter measured from the bottom. */
export function angleAtArc(fraction: number) {
  const laps = Math.floor(fraction), target = (fraction - laps) * ORBIT_PERIMETER;
  let lo = 0, hi = ARC_SAMPLES;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arcTable[mid] < target) lo = mid; else hi = mid; }
  const span = arcTable[hi] - arcTable[lo] || 1;
  return 360 * laps + 360 * (lo + (target - arcTable[lo]) / span) / ARC_SAMPLES;
}

/** The ring's opening at the bottom is two slots wide: the medallions on the
 * ring stay one slot apart, and the two swapping medallions have the room of
 * one slot each on either side of the platform's light. */
export const ORBIT_GAP = 2 * MARKET_STEP_MS / (ORBIT_MS + 2 * MARKET_STEP_MS);
export const ORBIT_SLOT = ORBIT_GAP / 2;
const EXIT_ARC = ORBIT_GAP / 2;
const ENTRY_ARC = EXIT_ARC + 1 - ORBIT_GAP;
export const EXIT_DEG = angleAtArc(EXIT_ARC);
export const ENTRY_DEG = angleAtArc(ENTRY_ARC);

export interface OrbitPose { x: number; y: number; z: number; scale: number; turn: number; opacity: number }

/** A point on the ring; 90deg is the front (nearest, largest, left of centre). */
export function orbitPose(degrees: number, profile: OrbitProfile = 'desktop'): OrbitPose {
  const s = Math.sin(rad(degrees)), c = Math.cos(rad(degrees));
  const z = ORBIT.depth * s;
  const near = ORBIT.focal / (ORBIT.focal - z);
  const opacity = profile === 'mobile'
    // Phones keep the centre and the lower part of the ring: two or three helpers.
    ? Math.min(1, Math.max(0, (c - .25) / .3))
    // Desktop fades the far side so the near medallions lead the composition.
    : 1 - ORBIT.backFade * Math.min(1, Math.max(0, (-z / ORBIT.depth - .2) / .8));
  return {
    x: round(-ORBIT.rx * s * near),
    y: round(ORBIT.ringY + ORBIT.ry * c * near),
    z: round(z),
    scale: round(ORBIT.helper / ORBIT.coin * near, 4),
    turn: round(ORBIT.turnDeg * s, 2),
    opacity: round(opacity, 3),
  };
}
const centrePose = (lift = 0): OrbitPose => ({ x: 0, y: lift ? -lift : 0, z: ORBIT.centreDepth, scale: 1, turn: 0, opacity: 1 });
const mixPose = (a: OrbitPose, b: OrbitPose, t: number): OrbitPose => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, scale: a.scale + (b.scale - a.scale) * t, turn: a.turn + (b.turn - a.turn) * t, opacity: a.opacity + (b.opacity - a.opacity) * t });

function curvePose(from: OrbitPose, control: { x: number; y: number }, to: OrbitPose, u: number): OrbitPose {
  const w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
  const linear = mixPose(from, to, u);
  return { x: round(w0 * from.x + w1 * control.x + w2 * to.x), y: round(w0 * from.y + w1 * control.y + w2 * to.y), z: round(linear.z), scale: round(linear.scale, 4), turn: round(linear.turn, 2), opacity: round(linear.opacity, 3) };
}
/** The outgoing medallion at `t` (0..1, unit time): an eased curve from the
 * centre, down through the light, out to the ring's lower-left end. */
export function exitPose(t: number, profile: OrbitProfile = 'desktop'): OrbitPose {
  return curvePose(centrePose(), ORBIT.exitDip, orbitPose(EXIT_DEG, profile), exitEase(t));
}
/** The incoming medallion at `t` (0..1, unit time): an eased curve from the
 * ring's lower-right end, down through the light, up into the centre. */
export function entryPose(t: number, profile: OrbitProfile = 'desktop'): OrbitPose {
  return curvePose(orbitPose(ENTRY_DEG, profile), ORBIT.entryDip, centrePose(), entryEase(t));
}

export function orbitTransform(pose: OrbitPose) {
  return `translate3d(${pose.x}px, ${pose.y}px, 0px) perspective(900px) rotateY(${pose.turn}deg) scale(${pose.scale})`;
}
const depth = (z: number) => `0px 0px ${round(z, 1)}px`;

/** Projected ring path (design px, relative to the centre medallion) for the
 * decorative orbit line, so the line matches the medallions' real path. */
export function ringPath(samples = 96) {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < samples; i++) { const pose = orbitPose(360 * i / samples); points.push([pose.x, pose.y]); }
  return points;
}

/** One full cycle for one medallion; every medallion shares it, offset by one step. */
export function marketTileFrames(profile: OrbitProfile = 'desktop'): Keyframe[] {
  const T = MARKET_CYCLE_MS, S = MARKET_STEP_MS, m = MARKET_SWAP_MS;
  const at = (ms: number) => round(ms / T, 6);
  const frames: Keyframe[] = [];
  const pose = (ms: number, value: OrbitPose, easing?: string) => frames.push({ offset: at(ms), transform: orbitTransform(value), opacity: value.opacity, ...(easing ? { easing } : {}) });
  const z = (ms: number, value: number) => frames.push({ offset: at(ms), translate: depth(value) });
  pose(0, centrePose(), 'ease-in-out');
  pose((S - m) / 2, centrePose(ORBIT.float), 'ease-in-out');
  // Swap legs are sampled with their easing applied, so each is one smooth
  // motion along its path (the incoming path is a curve).
  for (let i = 0; i < SWAP_SAMPLES; i++) pose(S - m + (EXIT_END_MS - (S - m)) * i / SWAP_SAMPLES, exitPose(i / SWAP_SAMPLES, profile), 'linear');
  const segments = 48;
  const along = (i: number) => angleAtArc(EXIT_ARC + (ENTRY_ARC - EXIT_ARC) * i / segments);
  for (let i = 0; i <= segments; i++) pose(EXIT_END_MS + ORBIT_MS * i / segments, orbitPose(along(i), profile), 'linear');
  for (let i = 1; i <= SWAP_SAMPLES; i++) pose(ENTRY_START_MS + (T - ENTRY_START_MS) * i / SWAP_SAMPLES, i === SWAP_SAMPLES ? centrePose() : entryPose(i / SWAP_SAMPLES, profile), 'linear');
  // Depth decides overlap near the centre: the incoming medallion moves in
  // front at once, the outgoing one steps behind the light.
  const lead = m * ORBIT.swapStagger / 2;
  z(0, ORBIT.centreDepth);
  z(S - m, ORBIT.centreDepth);
  z(S - m + lead, ORBIT.outgoingDepth);
  z(EXIT_END_MS, orbitPose(EXIT_DEG).z);
  for (let i = 1; i < segments; i++) z(EXIT_END_MS + ORBIT_MS * i / segments, orbitPose(along(i)).z);
  z(ENTRY_START_MS, orbitPose(ENTRY_DEG).z);
  z(ENTRY_START_MS + lead, ORBIT.incomingDepth);
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
  return orbitPose(angleAtArc(EXIT_ARC + (ENTRY_ARC - EXIT_ARC) * Math.min(1, (local - EXIT_END_MS) / ORBIT_MS)), profile);
}

/** Analytic pose of asset `index` at `ms` into the shared clock. Used by
 * tests and QA to reason about spacing and visibility. */
export function orbitPoseAt(index: number, ms: number, profile: OrbitProfile = 'desktop'): OrbitPose & { phase: 'centre' | 'exit' | 'orbit' | 'entry' } {
  const T = MARKET_CYCLE_MS, S = MARKET_STEP_MS, m = MARKET_SWAP_MS;
  const local = ((ms + initialMarketPose(index) * S) % T + T) % T;
  if (local < S - m) return { ...centrePose(), phase: 'centre' };
  if (local < EXIT_END_MS) return { ...exitPose((local - (S - m)) / (EXIT_END_MS - (S - m)), profile), phase: 'exit' };
  if (local < ENTRY_START_MS) return { ...orbitPose(angleAtArc(EXIT_ARC + (ENTRY_ARC - EXIT_ARC) * (local - EXIT_END_MS) / ORBIT_MS), profile), phase: 'orbit' };
  return { ...entryPose((local - ENTRY_START_MS) / (T - ENTRY_START_MS), profile), phase: 'entry' };
}
