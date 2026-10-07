// One compositor timeline, shared by all seven tiles. No frame loop or timer.
export const MARKET_STEP_MS = 4000;
export const MARKET_MOVE_MS = 1000;
export const MARKET_CYCLE_MS = MARKET_STEP_MS * 7;

export const MARKET_POSES = [
  { transform: 'translate3d(0, 0, 0) rotateX(0deg) scale(1)', opacity: 1, zIndex: 7 },
  { transform: 'translate3d(0, calc(-1 * var(--card-step)), 0) rotateX(7deg) scale(.96)', opacity: 1, zIndex: 6 },
  { transform: 'translate3d(0, calc(-2 * var(--card-step)), 0) rotateX(12deg) scale(.9)', opacity: .94, zIndex: 5 },
  { transform: 'translate3d(0, calc(-3 * var(--card-step)), 0) rotateX(16deg) scale(.84)', opacity: 0, zIndex: 4 },
  { transform: 'translate3d(0, calc(3 * var(--card-step)), 0) rotateX(-16deg) scale(.84)', opacity: 0, zIndex: 4 },
  { transform: 'translate3d(0, calc(2 * var(--card-step)), 0) rotateX(-12deg) scale(.9)', opacity: .94, zIndex: 5 },
  { transform: 'translate3d(0, var(--card-step), 0) rotateX(-7deg) scale(.96)', opacity: 1, zIndex: 6 },
] as const;

export function marketTileFrames(): Keyframe[] {
  const frames: Keyframe[] = [];
  MARKET_POSES.forEach((pose, index) => {
    frames.push({ ...pose, offset: index / 7 });
    frames.push({ ...pose, offset: (index * MARKET_STEP_MS + MARKET_STEP_MS - MARKET_MOVE_MS) / MARKET_CYCLE_MS, easing: 'cubic-bezier(.22,.68,.25,1)' });
    // The top exit and bottom return remain invisible. The card face
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
  return (2 - index + MARKET_POSES.length) % MARKET_POSES.length;
}
