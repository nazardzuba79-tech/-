/**
 * VOLTEX brand mark — a geometric lightning bolt (voltage/speed) paired
 * with the wordmark. `LogoMark` alone is the icon (used for the favicon
 * and as a standalone badge); `Logo` is the full lockup used in the nav
 * and on the auth screen.
 */

const BOLT_PATH = 'M13 2L4 14h7l-1 8 10-12h-7l1-8z';

export function LogoMark({ size = 22, variant = 'bolt' }: { size?: number; variant?: 'bolt' | 'badge' }) {
  if (variant === 'badge') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" rx="6" fill="var(--accent)" />
        <path d={BOLT_PATH} fill="#0b0e11" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d={BOLT_PATH} fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ size = 'nav' }: { size?: 'nav' | 'large' }) {
  const iconSize = size === 'large' ? 40 : 20;
  const fontSize = size === 'large' ? 34 : 16;

  const lockup = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'large' ? 12 : 7,
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize,
        letterSpacing: '0.03em',
        color: 'var(--text-primary)',
      }}
    >
      <LogoMark size={iconSize} />
      VOLTEX
    </span>
  );

  if (size !== 'large') return lockup;

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {lockup}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
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
