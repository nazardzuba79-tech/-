import type { ServiceItem } from '../data/services';
import { BrandMark } from './BrandMarks';
import { useCardCopy } from '../useCardCopy';

interface ServiceChipProps {
  service: ServiceItem;
  size?: 'sm' | 'md';
}

export function ServiceChip({ service, size = 'md' }: ServiceChipProps) {
  const { c } = useCardCopy();
  const isSmall = size === 'sm';
  return (
    <div className={`vc-flex vc-items-center vc-gap-2.5 vc-rounded-full vc-border vc-border-white/20 vc-bg-black/70 vc-backdrop-blur-md ${isSmall ? "vc-py-1 vc-pl-1 vc-pr-3" : "vc-py-1.5 vc-pl-1.5 vc-pr-4"}`}>
      <BrandMark mark={service.mark} className={`vc-rounded-full ${isSmall ? "vc-h-7 vc-w-7" : "vc-h-8 vc-w-8"}`} />
      <span className={`vc-font-medium vc-text-white ${isSmall ? "vc-text-[12px]" : "vc-text-[13px]"}`}>{service.mark === 'apple' ? c.appStore : service.name}</span>
    </div>);

}
