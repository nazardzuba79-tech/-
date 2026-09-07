import { SiOpenai } from '@icons-pack/react-simple-icons';

export type CardBenefit = 'world' | 'apple' | 'ai' | 'atm' | 'privacy';

/** Brand assets retain their original paths; product pictograms share one
 * graphite/champagne material palette and a 34px optical frame. */
export function CardBenefitIcon({ kind }: { kind: CardBenefit }) {
  if (kind === 'apple') return <img src="/cards/crypto-card-final/apple-pay-mark.svg" alt="" width={28} height={18} />;
  if (kind === 'ai') return <span aria-hidden="true" className="flex h-[32px] w-[32px] items-center justify-center rounded-[9px] border border-white/15 bg-white/[0.06] text-white"><SiOpenai size={23} /></span>;
  return <svg width="34" height="34" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="38" height="38" rx="11" fill="#181D23" stroke="#3A4149" />
    {kind === 'world' && <>
      <circle cx="17" cy="17" r="10" fill="#29333C" stroke="#D6DFE5" strokeWidth="1.3" />
      <ellipse cx="17" cy="17" rx="4.5" ry="10" stroke="#8E9EA9" />
      <path d="M7 17h20M9 11h16M9 23h12" stroke="#8E9EA9" />
      <rect x="18" y="22" width="16" height="11" rx="2.5" fill="#D6BD82" stroke="#171D24" strokeWidth="1.5" />
      <path d="M20 26h12M21 30h4" stroke="#453B29" strokeWidth="1.5" />
    </>}
    {kind === 'atm' && <>
      <rect x="9" y="7" width="22" height="26" rx="3" fill="#303B45" stroke="#D6DFE5" strokeWidth="1.3" />
      <rect x="12" y="10" width="16" height="9" rx="1.5" fill="#151D24" />
      <path d="M14 14h6M14 16h10M12 23h16" stroke="#A9BBC6" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 23h12v10H14z" fill="#D6BD82" />
      <circle cx="20" cy="28" r="2" stroke="#65552D" />
      <path d="M16 25h1M23 31h1" stroke="#65552D" />
    </>}
    {kind === 'privacy' && <>
      <path d="M20 7 31 11v9c0 7-7 11-11 13-4-2-11-6-11-13v-9Z" fill="#303B45" stroke="#D6DFE5" strokeWidth="1.3" />
      <g stroke="#D6BD82" strokeWidth="1.4" strokeLinecap="round">
        <path d="M14 20v-2a6 6 0 0 1 12 0v3M17 25c1-2 0-5 0-7a3 3 0 0 1 6 0v4c0 2-1 4-2 5M20 18v4c0 2-1 4-2 5M14 23v2M26 24l-1 3" />
      </g>
    </>}
  </svg>;
}
