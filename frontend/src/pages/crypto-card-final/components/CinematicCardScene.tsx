import { useId } from 'react';

const ART = '/cards/crypto-card-final/';
const SCENES = {
  hero: {
    width: 1388, height: 1006, source: 'voltex-cards-phone-hero.webp',
    phone: '1020,0 1388,0 1388,1006 720,1006 902,439',
    // These masks exclude the precomposed card faces. Only the phone is reused.
    covered: '440,338 1115,491 985,920 438,777',
    titanium: 'matrix(4.71 1.4 -3.1475 6.5574 641 360)',
    black: 'matrix(5.35 1.27 -3.1967 5.7213 238 224)',
  },
  final: {
    width: 1122, height: 1168, source: 'voltex-cards-phone-register.webp',
    phone: '844,0 1122,0 1122,1040 976,1110 616,999 674,494 704,384 754,214 792,74',
    covered: '430,655 1028,765 945,1168 419,1020',
    titanium: 'matrix(4.56 0.97 -1.8525 6.3 565 673)',
    black: 'matrix(5.43 0.89 -2.2295 5.9672 158 527)',
  },
} as const;

/** Approved phone composition + the exact same binary card masters as the
 * comparison. Only external placement, clipping of source canvas margins,
 * tilt and shadow are applied; no master pixels or asset files are rewritten. */
export function CinematicCardScene({ kind, label }: { kind: keyof typeof SCENES; label: string }) {
  const scene = SCENES[kind];
  const id = useId().replace(/:/g, '');
  return <svg viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" aria-label={label} className="crypto-card-art" data-card-cinematic={kind}>
    <defs>
      <clipPath id={`phone-${id}`}><polygon points={scene.phone} /></clipPath>
      <mask id={`phone-face-${id}`} maskUnits="userSpaceOnUse" width={scene.width} height={scene.height}>
        <rect width={scene.width} height={scene.height} fill="white" />
        <polygon points={scene.covered} fill="black" />
      </mask>
      <clipPath id={`titanium-edge-${id}`}><rect width="100" height="61" rx="4" /></clipPath>
      <clipPath id={`black-edge-${id}`}><rect width="100" height="61" rx="4" /></clipPath>
    </defs>
    <image href={`${ART}${scene.source}`} width={scene.width} height={scene.height} clipPath={`url(#phone-${id})`} mask={`url(#phone-face-${id})`} />
    <g transform={scene.titanium} style={{ filter: 'drop-shadow(0 1px 1px #080810)' }} data-card-slot="titanium-cinematic">
      <g clipPath={`url(#titanium-edge-${id})`}>
        <svg width="100" height="61" viewBox="54 44 1472 908" preserveAspectRatio="none">
          <image href={`${ART}voltex-titanium-final.png`} width="1580" height="996" />
        </svg>
      </g>
    </g>
    <g transform={scene.black} style={{ filter: 'drop-shadow(0 1px 1.5px #272047)' }} data-card-slot="black-signature-cinematic">
      <g clipPath={`url(#black-edge-${id})`}>
        <svg width="100" height="61" viewBox="108 80 1364 824" preserveAspectRatio="none">
          <image href={`${ART}voltex-black-signature-final.png`} width="1580" height="996" />
        </svg>
      </g>
    </g>
  </svg>;
}
