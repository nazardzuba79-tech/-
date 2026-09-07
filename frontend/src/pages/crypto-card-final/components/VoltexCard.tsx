interface VoltexCardProps {
  className?: string;
  tone?: 'black' | 'titanium';
  compact?: boolean;
}

export const CARD_MASTER = {
  black: '/cards/crypto-card-final/voltex-black-signature-final.png',
  titanium: '/cards/crypto-card-final/voltex-titanium-final.png',
} as const;

/** Actual supplied masters, not a CSS redraw of the physical card. */
export function VoltexCard({ className = '', tone = 'black', compact = false }: VoltexCardProps) {
  const name = tone === 'titanium' ? 'Titanium' : 'Black Signature';
  return <img
    src={CARD_MASTER[tone]}
    alt={`VOLTEX ${name}`}
    className={`crypto-card-art ${compact ? '' : 'vc-drop-shadow-2xl'} ${className}`}
    width={1580} height={996} draggable={false}
    style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
    loading="lazy" decoding="async"
  />;
}
