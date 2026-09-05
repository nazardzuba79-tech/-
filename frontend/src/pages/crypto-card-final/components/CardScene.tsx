import { useId } from 'react';

const SCENES = {
  pos: {
    src: '/cards/crypto-card-final/beb1109b-fa4d-4739-804c-6e1cb6d5d170.jpg',
    alt: 'Бесконтактная оплата картой VOLTEX через современный POS-терминал',
    transform: 'matrix(1 -0.055 0.018 1 520 347)', width: 170, height: 88,
    hand: 'M 510 361 C 527 358 548 359 553 372 C 559 386 547 394 521 403 L 510 405 Z',
  },
  atm: {
    src: '/cards/crypto-card-final/e02dd952-015e-4a66-851e-4561ff0cc446.jpg',
    alt: 'Карта VOLTEX у бесконтактного NFC-считывателя банкомата',
    transform: 'translate(617 452) rotate(-7)', width: 126, height: 79,
    hand: 'M 710 478 C 717 466 731 469 745 479 L 759 507 L 736 532 C 724 525 716 521 708 510 C 704 499 707 488 710 478 Z',
  },
};

/** One source coordinate system keeps the card attached to the hand when
 * object-cover crops change. Original scene/master pixels are never repainted. */
export function CardScene({ kind }: { kind: keyof typeof SCENES }) {
  const scene = SCENES[kind];
  const mask = `card-hand-${useId().replace(/:/g, '')}`;
  return <svg viewBox="0 0 1200 896" preserveAspectRatio="xMidYMid slice" role="img" aria-label={scene.alt} className="vc-absolute vc-inset-0 vc-h-full vc-w-full">
    <image href={scene.src} width="1200" height="896" />
    <defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="896"><rect width="1200" height="896" fill="white" /><path d={scene.hand} fill="black" /></mask></defs>
    <g mask={`url(#${mask})`} data-card-slot={`black-signature-${kind}`}>
      <g transform={scene.transform}>
        <svg width={scene.width} height={scene.height} viewBox="106 78 1369 834" preserveAspectRatio="none" overflow="hidden">
          <image href="/cards/crypto-card-final/voltex-black-signature-final.png" width="1580" height="996" />
        </svg>
      </g>
    </g>
  </svg>;
}
