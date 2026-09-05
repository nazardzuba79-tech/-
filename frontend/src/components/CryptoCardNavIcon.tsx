/** Navigation-only card mark; keep the existing 14px slot and link colours. */
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
      <rect x="1.75" y="4.25" width="20.5" height="15.5" rx="3" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.75" />
      <rect x="5" y="8" width="5" height="4.5" rx="1" fill="var(--h-accent, #f0c43f)" />
      <path d="M13.5 15.5H19" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
