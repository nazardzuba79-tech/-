import { VoltexCard } from './VoltexCard';
import { WatchCardVisual } from './WatchCardVisual';

export function CinematicCardScene({ kind }: { kind: 'hero' | 'final'; label: string }) {
  if (kind === 'final') return <VoltexCard tone="black" />;
  return <WatchCardVisual framing="hero" />;
}
