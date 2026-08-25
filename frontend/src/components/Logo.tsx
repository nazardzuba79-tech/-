/**
 * VOLTEX brand mark — a white "crossed-out planet": a solid disc with a
 * tilted orbit ring, sliced by a diagonal cut back to the page background.
 * Replaces the earlier cyan-to-purple lightning bolt. `LogoMark` alone is
 * the icon (used for the favicon and as a standalone badge); `Logo` is the
 * full lockup used in the nav and on the auth screen.
 */

export function LogoMark({ size = 22, variant = 'bolt' }: { size?: number; variant?: 'bolt' | 'badge' }) {
  if (variant === 'badge') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="10" fill="var(--accent)" />
        <ellipse cx="20" cy="20" rx="14.5" ry="5.2" stroke="var(--on-accent)" strokeWidth="1.4" fill="none" transform="rotate(-15 20 20)" />
        <circle cx="20" cy="20" r="8.5" fill="var(--on-accent)" />
        <line x1="6" y1="29.5" x2="34" y2="10.5" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* tilted orbit ring */}
      <ellipse cx="20" cy="20" rx="17" ry="6" stroke="var(--text-primary)" strokeWidth="1.4" fill="none" transform="rotate(-15 20 20)" />
      {/* planet body */}
      <circle cx="20" cy="20" r="10" fill="var(--text-primary)" />
      {/* the "crossed out" cut, back to the page background */}
      <line x1="4" y1="31" x2="36" y2="9" stroke="var(--bg)" strokeWidth="3.4" strokeLinecap="round" />
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
      <span>
        VO<span style={{ color: '#F0C419' }}>L</span>TEX
      </span>
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
