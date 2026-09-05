import './voltexPhysicalCard.css';

export type VoltexPhysicalCardVariant = 'black-signature' | 'titanium';

export const PHYSICAL_CARD_NAMES: Record<VoltexPhysicalCardVariant, string> = {
  'black-signature': 'VOLTEX Black Signature',
  titanium: 'VOLTEX Titanium',
};

/** Card-face pixels live exclusively in the raster assets. Presentation only. */
export function VoltexPhysicalCard({
  variant,
  className = '',
  showRepairs = false,
}: {
  variant: VoltexPhysicalCardVariant;
  className?: string;
  /** For source-fidelity review only; never an alternative card face. */
  showRepairs?: boolean;
}) {
  const basename = `/cards/voltex-${variant}`;
  return (
    <div className={`voltex-physical-card ${className}`} data-variant={variant}>
      <picture>
        <source srcSet={`${basename}.webp`} type="image/webp" />
        <img src={`${basename}.png`} alt={PHYSICAL_CARD_NAMES[variant]} width={1000} height={630} decoding="async" draggable={false} />
      </picture>
      {showRepairs && <img className="voltex-physical-card__repair-map" src={`${basename}-repair-map.png`} alt="" aria-hidden="true" width={1000} height={630} />}
    </div>
  );
}
