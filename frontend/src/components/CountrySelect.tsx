import { useEffect, useMemo, useRef, useState } from 'react';
import { getCountries, getCountryName } from '../lib/countries';
import { useLanguage } from '../lib/i18n';

/** A country <select> stand-in with a search box — the plain native
 * <select> makes finding your own country in a list of 190+ a scroll
 * slog. Same trigger/dropdown/outside-click pattern as LanguageSwitcher. */
export function CountrySelect({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (code: string) => void;
  placeholder: string;
}) {
  const { lang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const countries = useMemo(() => getCountries(lang), [lang]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countries, search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  return (
    <div ref={containerRef} style={styles.container}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={styles.trigger} aria-expanded={open}>
        <span style={{ color: value ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
          {value ? getCountryName(value, lang) : placeholder}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div style={styles.dropdown}>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('settings.searchCountry')}
            style={styles.searchInput}
          />
          <div style={styles.list}>
            {filtered.length === 0 && <p style={styles.empty}>{t('settings.noCountriesFound')}</p>}
            {filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                className="row-hover"
                onClick={() => {
                  onChange(c.code);
                  setOpen(false);
                  setSearch('');
                }}
                style={{ ...styles.option, ...(c.code === value ? styles.optionActive : {}) }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { position: 'relative' },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '9px 10px',
    fontSize: 13,
    color: 'var(--text-tertiary)',
    textAlign: 'left',
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 16px 32px rgba(0,0,0,0.4)',
    zIndex: 30,
    overflow: 'hidden',
  },
  searchInput: {
    width: '100%',
    background: 'var(--panel-alt)',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  list: { maxHeight: 240, overflowY: 'auto', padding: 4 },
  option: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  optionActive: { color: 'var(--accent)' },
  empty: { padding: '12px 10px', fontSize: 12, color: 'var(--text-tertiary)', margin: 0 },
};
