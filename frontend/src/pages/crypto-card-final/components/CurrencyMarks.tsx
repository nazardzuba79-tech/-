import { SiBitcoin, SiEthereum, SiTether } from '@icons-pack/react-simple-icons';
import { CH, CN, EU, GB, RU, US } from 'country-flag-icons/react/3x2';
import type { ComponentType } from 'react';

type IconLike = ComponentType<{className?: string;}>;

const flags: Record<string, IconLike> = { USD: US, EUR: EU, GBP: GB, CHF: CH, RUB: RU, CNY: CN };

const cryptoMeta: Record<string, {color: string;Icon: IconLike;}> = {
  BTC: { color: '#F7931A', Icon: SiBitcoin },
  ETH: { color: '#627EEA', Icon: SiEthereum },
  USDT: { color: '#26A17B', Icon: SiTether },
  TON: { color: '#0098EA', Icon: TonMark },
  TRX: { color: '#EF0027', Icon: TronMark }
};

interface CurrencyMarkProps {
  code: string;
  type: 'fiat' | 'crypto';
  className?: string;
}

export function CurrencyMark({ code, type, className = "" }: CurrencyMarkProps) {
  if (type === 'fiat') {
    const Flag = flags[code];
    return (
      <span className={`vc-relative vc-block vc-shrink-0 vc-overflow-hidden vc-rounded-full vc-bg-white/10 ${className}`} aria-hidden="true">
        {Flag ? <Flag className="vc-absolute vc-left-1/2 vc-top-1/2 vc-h-full vc-w-auto vc-min-w-full -vc-translate-x-1/2 -vc-translate-y-1/2" /> : null}
      </span>);

  }

  const meta = cryptoMeta[code];
  if (!meta) return null;
  const { Icon } = meta;
  return (
    <span className={`vc-grid vc-shrink-0 vc-place-items-center vc-rounded-full vc-text-white ${className}`} style={{ backgroundColor: meta.color }} aria-hidden="true">
      <Icon className="vc-h-[54%] vc-w-[54%] vc-shrink-0" />
    </span>);

}

// The Open Network mark: diamond outline with the central stem and inner V.
function TonMark({ className = "" }: {className?: string;}) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.9 7h14.2L12 21 4.9 7Z" />
      <path d="M12 7v14" />
      <path d="m4.9 7 7.1 6.7L19.1 7" />
    </svg>);

}

// TRON mark: faceted triangular emblem.
function TronMark({ className = "" }: {className?: string;}) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.4 4.9 20.6 8.3 12.3 20.5 3.4 4.9Z" />
      <path d="m3.4 4.9 12 5.2-3.1 10.4" />
      <path d="m15.4 10.1 5.2-1.8" />
    </svg>);

}
