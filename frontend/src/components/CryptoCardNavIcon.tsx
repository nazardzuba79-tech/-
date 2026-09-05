/** Minimal white card artwork confined to the existing 14px navigation slot. */
export function CryptoCardNavIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <rect x="1" y="4.75" width="22" height="14.5" rx="2.2" fill="#f2f2f0" stroke="#cdd0d2" strokeWidth="0.75" />
      {/* The same crossed-orbit geometry as LogoMark, in titanium grey. */}
      <g transform="translate(3 6.25) scale(0.17)">
        <ellipse cx="20" cy="20" rx="17" ry="6" stroke="#8c9096" strokeWidth="1.4" transform="rotate(-15 20 20)" />
        <circle cx="20" cy="20" r="10" fill="#8c9096" />
        <path d="M4 31 36 9" stroke="#f2f2f0" strokeWidth="3.4" strokeLinecap="round" />
      </g>
      <text x="20.5" y="17.5" fill="#686d76" fontFamily="Arial, sans-serif" fontSize="4.8" fontStyle="italic" fontWeight="800" textAnchor="end">VISA</text>
    </svg>
  );
}
