// One compositor timeline, shared by all seven tiles. No frame loop or timer.
export const MARKET_STEP_MS = 4000;
export const MARKET_MOVE_MS = 1000;
export const MARKET_CYCLE_MS = MARKET_STEP_MS * 7;

export const MARKET_POSES = [
  { transform: 'translate3d(0, 0, 0) rotateY(0deg) scale(1)', opacity: 1, zIndex: 7 },
  { transform: 'translate3d(calc(-1 * var(--near)), 16px, 0) rotateY(20deg) scale(.625)', opacity: 1, zIndex: 6 },
  { transform: 'translate3d(calc(-1 * var(--middle)), 28px, 0) rotateY(28deg) scale(.51)', opacity: 1, zIndex: 5 },
  { transform: 'translate3d(calc(-1 * var(--edge)), 38px, 0) rotateY(34deg) scale(.4)', opacity: .65, zIndex: 4 },
  { transform: 'translate3d(var(--edge), 38px, 0) rotateY(-34deg) scale(.4)', opacity: .65, zIndex: 4 },
  { transform: 'translate3d(var(--middle), 28px, 0) rotateY(-28deg) scale(.51)', opacity: 1, zIndex: 5 },
  { transform: 'translate3d(var(--near), 16px, 0) rotateY(-20deg) scale(.625)', opacity: 1, zIndex: 6 },
] as const;

export function marketTileFrames(): Keyframe[] {
  const frames: Keyframe[] = [];
  MARKET_POSES.forEach((pose, index) => {
    frames.push({ ...pose, offset: index / 7 });
    frames.push({ ...pose, offset: (index * MARKET_STEP_MS + MARKET_STEP_MS - MARKET_MOVE_MS) / MARKET_CYCLE_MS, easing: 'cubic-bezier(.22,.68,.25,1)' });
    // The farthest tile crosses behind the scene while invisible. Its face
    // never turns away, and no visible tile jumps on the last-to-first wrap.
    if (index === 3) {
      frames.push({ ...pose, opacity: 0, offset: 15.25 / 28 });
      frames.push({ ...pose, opacity: 0, offset: 15.49 / 28 });
      frames.push({ ...MARKET_POSES[4], opacity: 0, offset: 15.5 / 28 });
      frames.push({ ...MARKET_POSES[4], opacity: 0, offset: 15.75 / 28 });
    }
  });
  frames.push({ ...MARKET_POSES[0], offset: 1 });
  return frames;
}

export function initialMarketPose(index: number) {
  return (MARKET_POSES.length - index) % MARKET_POSES.length;
}
