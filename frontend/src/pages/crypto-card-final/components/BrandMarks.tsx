import {
  SiApplemusic,
  SiClaude,
  SiNetflix,
  SiOpenai,
  SiSpotify,
  SiTradingview,
  SiYoutube } from
'@icons-pack/react-simple-icons';
import type { ComponentType } from 'react';
import type { ServiceItem } from '../data/services';

type IconLike = ComponentType<{className?: string;}>;

// The exact SVG URL shipped in the archive is recorded in CRYPTO_CARD_ASSETS.md.
const FINANCIAL_TIMES_MARK_URL = '/cards/crypto-card-final/financial-times.svg';

const marks: Record<ServiceItem['mark'], {background: string;color: string;Icon: IconLike;}> = {
  chatgpt: { background: '#0D0D0D', color: '#FFFFFF', Icon: SiOpenai },
  claude: { background: '#D97757', color: '#FFFFFF', Icon: SiClaude },
  netflix: { background: '#0B0B0B', color: '#E50914', Icon: SiNetflix },
  spotify: { background: '#1DB954', color: '#0A0A0B', Icon: SiSpotify },
  apple: { background: '#FA243C', color: '#FFFFFF', Icon: SiApplemusic },
  youtube: { background: '#FFFFFF', color: '#FF0000', Icon: YoutubePremiumMark },
  tradingview: { background: '#131722', color: '#2962FF', Icon: SiTradingview },
  ft: { background: '#FFF1E5', color: '#0F5499', Icon: FinancialTimesMark }
};

function FinancialTimesMark({ className = "" }: {className?: string;}) {
  return <img src={FINANCIAL_TIMES_MARK_URL} alt="" className={`${className} vc-object-contain`} />;
}

function YoutubePremiumMark({ className = "" }: {className?: string;}) {
  return (
    <span className={`vc-flex vc-flex-col vc-items-center vc-justify-center ${className}`} aria-hidden="true">
      <SiYoutube className="vc-h-[58%] vc-w-[72%]" />
      <span className="vc-mt-px vc-text-[3px] vc-font-bold vc-uppercase vc-leading-none vc-tracking-[0.06em] vc-text-[#1A1A1A] sm:vc-text-[4px]">Premium</span>
    </span>);

}

interface BrandMarkProps {
  mark: ServiceItem['mark'];
  className?: string;
  iconClassName?: string;
}

export function BrandMark({ mark, className = "", iconClassName = "vc-h-[58%] vc-w-[58%]" }: BrandMarkProps) {
  const meta = marks[mark];
  const { Icon } = meta;
  return (
    <span
      className={`vc-grid vc-shrink-0 vc-place-items-center ${className}`}
      style={{ backgroundColor: meta.background, color: meta.color }}
      aria-hidden="true">
      
      <Icon className={iconClassName} />
    </span>);

}
