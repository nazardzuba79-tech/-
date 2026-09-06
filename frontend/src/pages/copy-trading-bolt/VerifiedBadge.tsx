/** Identity verification only; callers must supply the bound backend status. */
export function VerifiedBadge({ verified, label = 'Верифицирован' }: { verified?: boolean; label?: string }) {
  if (verified !== true) return null;

  return (
    <svg className="copy-verified-badge" width="15" height="15" viewBox="0 0 24 24" role="img" aria-label={label} focusable="false">
      <title>{label}</title>
      <path fill="#1d9bf0" d="m12 1 2.8 2.3 3.6-.2.9 3.5 3 2-1.3 3.4 1.3 3.4-3 2-.9 3.5-3.6-.2L12 23l-2.8-2.3-3.6.2-.9-3.5-3-2L3 12 1.7 8.6l3-2 .9-3.5 3.6.2Z" />
      <path d="m7.4 12 3.1 3.1 6.1-6.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
