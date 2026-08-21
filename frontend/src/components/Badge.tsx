/** Pill status chip (see .badge in index.css) — used for KYC status, order
 * status, API key rights, anywhere a plain colored word used to stand in
 * for a real status indicator. */
export function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span className="badge" style={{ color, background: bg }}>
      {text}
    </span>
  );
}
