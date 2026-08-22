import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { LANGUAGES } from '../lib/i18n';

/** Globe-icon language switcher (Binance-style) — opens a small dropdown
 * listing RU / EN / 中文 instead of always showing two buttons inline. */
export function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={styles.container}>
      <button onClick={() => setOpen((o) => !o)} style={styles.button} aria-label="Language / Язык / 语言">
        <GlobeIcon />
      </button>
      {open && (
        <div style={styles.dropdown}>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
              className="row-hover"
              style={{ ...styles.option, ...(l.code === lang ? styles.optionActive : {}) }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { position: 'relative' },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    borderRadius: 6,
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    zIndex: 60,
    minWidth: 100,
  },
  option: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  optionActive: { color: 'var(--accent)' },
};
