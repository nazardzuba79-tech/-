/** Bright, icon-prefixed search box (see .search-box in index.css) — used
 * anywhere a list can be filtered, so search inputs stop blending into the
 * dark background like a plain <input> does. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className="search-box" style={style}>
      <SearchIcon />
      <input
        autoFocus={autoFocus}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
