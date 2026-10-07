// One compositor timeline, shared by all seven tiles. No frame loop or timer.
export const MARKET_STEP_MS = 4000;
export const MARKET_MOVE_MS = 1000;
export const MARKET_CYCLE_MS = MARKET_STEP_MS * 7;

// A shallow S-shaped orbit connects the copy and laptop. The face stays readable
// as the previous lead recedes and the next coin comes forward.
export const MARKET_POSES = [
  { transform: 'translate3d(0, 0, 0) rotateX(0deg) rotateY(-8deg) scale(1)', opacity: 1 },
  { transform: 'translate3d(calc(-1 * var(--orbit-near-x)), calc(-1 * var(--orbit-near-y)), 0) rotateX(5deg) rotateY(14deg) scale(.625)', opacity: 1 },
  { transform: 'translate3d(var(--orbit-far-x), calc(-1 * var(--orbit-far-y)), 0) rotateX(8deg) rotateY(-18deg) scale(.4)', opacity: 'var(--orbit-far-opacity)' },
  { transform: 'translate3d(var(--orbit-back-x), calc(-1 * var(--orbit-back-y)), 0) rotateX(10deg) rotateY(-24deg) scale(.3)', opacity: 0 },
  { transform: 'translate3d(calc(-1 * var(--orbit-back-x)), var(--orbit-back-y), 0) rotateX(-10deg) rotateY(24deg) scale(.3)', opacity: 0 },
  { transform: 'translate3d(calc(-1 * var(--orbit-far-x)), var(--orbit-far-y), 0) rotateX(-8deg) rotateY(18deg) scale(.4)', opacity: 'var(--orbit-far-opacity)' },
  { transform: 'translate3d(var(--orbit-near-x), var(--orbit-near-y), 0) rotateX(-5deg) rotateY(-14deg) scale(.625)', opacity: 1 },
] as const;

export function marketTileFrames(): Keyframe[] {
  const frames: Keyframe[] = [];
  MARKET_POSES.forEach((pose, index) => {
    frames.push({ ...pose, offset: index / 7 });
    frames.push({ ...pose, offset: (index * MARKET_STEP_MS + MARKET_STEP_MS - MARKET_MOVE_MS) / MARKET_CYCLE_MS, easing: 'cubic-bezier(.22,.68,.25,1)' });
    // An outgoing neighbour disappears before the incoming one becomes visible.
    // These opacity-only keys leave the transform interpolation uninterrupted,
    // and keep at most five coins on desktop and three on mobile, even mid-move.
    if (index === 1 || index === 5) {
      frames.push({ opacity: 'var(--orbit-far-opacity)', offset: (index * MARKET_STEP_MS + MARKET_STEP_MS - MARKET_MOVE_MS / 2) / MARKET_CYCLE_MS });
    }
    if (index === 2 || index === 4) {
      frames.push({ opacity: 0, offset: (index * MARKET_STEP_MS + MARKET_STEP_MS - MARKET_MOVE_MS / 2) / MARKET_CYCLE_MS });
    }
    // Reposition only while fully behind the scene. There is no visible reset
    // between the last and first coin of the repeating compositor timeline.
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
