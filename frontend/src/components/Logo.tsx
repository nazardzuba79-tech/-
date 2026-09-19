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
  /**
   * The nav lockup, sized by its INK rather than by its boxes.
   *
   * The mark's 40-unit viewBox is mostly air — the planet and its orbit
   * occupy about half the box's height — so the 24px box was painting a
   * 13.2px mark, and the 17px wordmark was painting 12.0px of letter. The
   * navigation links beside it are 14px. The brand was literally smaller
   * than the menu next to it, which is what reads as "too small" long
   * before anyone measures it.
   *
   * 28 / 20 raises the ink to about 15.4 and 14.1 — roughly a fifth more,
   * the starting target — and keeps the mark-to-wordmark ratio it already
   * had (1.10 → 1.09), so nothing needs re-balancing by eye. The header is
   * 48px and the lockup box grows 25 → 29, so it still centres with room
   * above and below. Both axes scale together: the SVG is square and the
   * font is one number, so nothing is stretched or cropped.
   */
  const iconSize = size === 'large' ? 40 : 28;
  const fontSize = size === 'large' ? 34 : 20;

  const lockup = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'large' ? 12 : 9,
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
