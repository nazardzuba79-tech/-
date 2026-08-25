/**
 * VOLTEX brand mark — the owner's actual v0-designed glyph: two interlocking
 * angular shards that read as both a lightning bolt (energy/speed) and a
 * sharp "V" (VOLTEX), cyan-to-purple gradient. `LogoMark` alone is the icon
 * (used for the favicon and as a standalone badge); `Logo` is the full
 * lockup used in the nav and on the auth screen.
 */

const BOLT_GRADIENT_ID = 'voltex-bolt-gradient';

export function LogoMark({ size = 22, variant = 'bolt' }: { size?: number; variant?: 'bolt' | 'badge' }) {
  if (variant === 'badge') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="10" fill="var(--accent)" />
        <path d="M20.5 3 L11 19 L17 19 L14.5 27 Z" fill="var(--on-accent)" opacity="0.55" />
        <path d="M23 3 L9 22 L18 22 L15.5 37 L32 16 L22 16 Z" fill="var(--on-accent)" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={BOLT_GRADIENT_ID} x1="6" y1="2" x2="34" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#18C8FF" />
          <stop offset="1" stopColor="#6C5CE7" />
        </linearGradient>
      </defs>
      {/* depth shard */}
      <path d="M20.5 3 L11 19 L17 19 L14.5 27 Z" fill="#6C5CE7" opacity="0.55" />
      {/* main bolt / V */}
      <path d="M23 3 L9 22 L18 22 L15.5 37 L32 16 L22 16 Z" fill={`url(#${BOLT_GRADIENT_ID})`} />
    </svg>
  );
}

export function Logo({ size = 'nav' }: { size?: 'nav' | 'large' }) {
  const iconSize = size === 'large' ? 40 : 24;
  const fontSize = size === 'large' ? 34 : 17;

  const lockup = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'large' ? 12 : 8,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize,
        letterSpacing: '0.12em',
        color: 'var(--text-primary)',
      }}
    >
      <LogoMark size={iconSize} />
      <span>VOLTEX</span>
    </span>
  );

  if (size !== 'large') return lockup;

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {lockup}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--text-secondary)',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="12" y="16.5" fontSize="13" fontWeight="700" textAnchor="middle" fill="currentColor" fontFamily="ui-monospace">
            ₿
          </text>
        </svg>
        CRYPTO EXCHANGE
      </span>
    </span>
  );
}
