import { useId } from 'react';
import { useCardCopy } from '../useCardCopy';
import { CARD_MASTER } from './VoltexCard';

const SCENES = {
  pos: {
    src: '/cards/crypto-card-final/beb1109b-fa4d-4739-804c-6e1cb6d5d170.jpg',
    transform: 'translate(517 313) rotate(-3.15)', width: 196,
    hand: 'M 508 355 C 525 356 542 361 550 369 C 558 378 554 389 545 394 L 524 402 L 516 431 L 505 434 Z',
  },
  atm: {
    src: '/cards/crypto-card-final/e02dd952-015e-4a66-851e-4561ff0cc446.jpg',
    transform: 'translate(542 400) rotate(-6)', width: 208,
    hand: 'M 708 497 C 709 488 716 478 723 476 C 729 469 741 466 751 470 C 766 471 779 478 793 481 L 824 483 L 824 554 L 715 554 Z',
  },
};

// This viewport removes only the transparent studio margin around the complete
// approved master. Both scenes use the same face ratio and rigid rotation.
const CARD_FACE = { width: 1369, height: 834 };

/** One source coordinate system keeps the master attached to the real grip as
 * responsive crops change. A small hand mask restores only foreground fingers. */
export function CardScene({ kind }: { kind: keyof typeof SCENES }) {
  const { c } = useCardCopy();
  const scene = SCENES[kind];
  const mask = `card-hand-${useId().replace(/:/g, '')}`;
  return <svg viewBox="0 0 1200 896" preserveAspectRatio="xMidYMid slice" role="img" aria-label={kind === 'pos' ? c.paymentAlt : c.atmAlt} data-payment-scene={kind} className="vc-absolute vc-inset-0 vc-h-full vc-w-full">
    <image href={scene.src} width="1200" height="896" />
    <defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="896"><rect width="1200" height="896" fill="white" /><path d={scene.hand} fill="black" /></mask></defs>
    <g mask={`url(#${mask})`} data-card-slot={`black-signature-${kind}`}>
      <g transform={scene.transform}>
        <svg width={scene.width} height={scene.width * CARD_FACE.height / CARD_FACE.width} viewBox="106 78 1369 834" preserveAspectRatio="xMidYMid meet" overflow="hidden">
          <image href={CARD_MASTER.black} width="1580" height="996" />
        </svg>
      </g>
    </g>
  </svg>;
}
