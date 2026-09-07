import { SiOpenai } from '@icons-pack/react-simple-icons';
import { BanknoteArrowDown, Globe2, ShieldCheck } from 'lucide-react';

export type CardBenefit = 'world' | 'apple' | 'ai' | 'atm' | 'privacy';

const PICTOGRAMS = { world: Globe2, atm: BanknoteArrowDown, privacy: ShieldCheck };

/** One optical frame and consistent line weight; official brand marks stay intact. */
export function CardBenefitIcon({ kind }: { kind: CardBenefit }) {
  const Icon = kind in PICTOGRAMS ? PICTOGRAMS[kind as keyof typeof PICTOGRAMS] : null;
  return <span aria-hidden="true" className="vx-home-card-benefit-icon">
    {kind === 'apple' ? <img src="/cards/crypto-card-final/apple-pay-mark.svg" alt="" width={30} height={19} />
      : kind === 'ai' ? <SiOpenai size={25} className="text-[#edf0f4]" />
      : Icon && <Icon size={25} strokeWidth={1.65} />}
  </span>;
}
