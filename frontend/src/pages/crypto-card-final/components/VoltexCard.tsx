interface VoltexCardProps {
  className?: string;
  tone?: 'black' | 'titanium';
  compact?: boolean;
}

/** Actual supplied masters, not a CSS redraw of the physical card. */
export function VoltexCard({ className = '', tone = 'black', compact = false }: VoltexCardProps) {
  const name = tone === 'titanium' ? 'Titanium' : 'Black Signature';
  return <img
    src={`/cards/crypto-card-final/voltex-${tone === 'titanium' ? 'titanium' : 'black-signature'}-final.png`}
    alt={`VOLTEX ${name}`}
    className={`crypto-card-art ${compact ? '' : 'vc-drop-shadow-2xl'} ${className}`}
    loading="lazy" decoding="async"
  />;
}
