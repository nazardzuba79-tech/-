import { CARD_MASTER, VoltexCard } from './VoltexCard';

/** Hardware photography and the unchanged approved master are independent layers.
 * The full 1580:996 card canvas fits inside the blank frontal display; no mask,
 * crop, perspective warp or generated lettering touches the card itself. */
export function CinematicCardScene({ kind }: { kind: 'hero' | 'final'; label: string }) {
  if (kind === 'final') return <VoltexCard tone="black" />;
  return <svg viewBox="0 0 1254 1254" preserveAspectRatio="xMidYMid slice" role="img" aria-label="VOLTEX Black Signature" className="crypto-card-art" data-card-cinematic="smartwatch">
    <image href="/cards/crypto-card-final/voltex-smartwatch-scene.png" width="1254" height="1254" />
    <image href={CARD_MASTER.black} x="384" y="462" width="486" height={486 * 996 / 1580}
      preserveAspectRatio="xMidYMid meet" data-card-slot="black-signature-watch" />
  </svg>;
}
