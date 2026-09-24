import { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { LANGUAGES, type Lang } from '../lib/i18n';

/** Language switcher — opens a small dropdown of the seven languages.
 * The current language is shown as its country's flag (English as the US
 * flag, owner 2026-09-24), drawn as inline SVG so it looks the same on
 * every system (Windows renders flag emoji as two letters).
 * `variant="pill"` adds the quote asset and a chevron (the top nav); the
 * default `"icon"` variant is the flag alone (Marketing/Auth, phone menu). */
export function LanguageSwitcher({ variant = 'icon', quoteAsset }: { variant?: 'icon' | 'pill'; quoteAsset?: string }) {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLabel = LANGUAGES.find((l) => l.code === lang)?.label ?? lang.toUpperCase();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={variant === 'pill' ? 'language-control' : undefined} style={styles.container}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={variant === 'pill' ? 'header-icon top-nav-pill-btn' : undefined}
        style={variant === 'pill' ? undefined : styles.button}
        aria-label="Language / Язык / 语言"
      >
        {/* Pill = the top nav's control: sized to the reference's Globe2
            size={15} / ChevronDown size={11}, and left entirely to
            .header-icon for its box, colour and hover. */}
        <FlagIcon lang={lang} label={currentLabel} />
        {variant === 'pill' && (
          <>
            {quoteAsset && <span>{quoteAsset}</span>}
            <ChevronDownIcon />
          </>
        )}
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
              <FlagIcon lang={l.code} label={l.label} decorative />
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The flag of the language's country as a round 18px badge (owner,
 *  2026-09-24). The 3:2 flag is drawn as before and a 20×20 window of it
 *  is clipped to a circle — centred, or on the canton / star side where the
 *  flag's emblem sits there. A hairline ring keeps the white fields (Japan,
 *  Korea) visible on the dark header. In the list the name follows, so
 *  there it is decorative; on the button it names the language. */
const FLAG_WINDOW: Record<Lang, number> = { en: 0, zh: 0, ru: 5, es: 5, hi: 5, ja: 5, ko: 5 };
function FlagIcon({ lang, label, decorative = false }: { lang: Lang; label: string; decorative?: boolean }) {
  const clip = `flag-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const x = FLAG_WINDOW[lang] ?? 5;
  return (
    <svg className="language-flag" width="18" height="18" viewBox={`${x} 0 20 20`} style={styles.flag}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}>
      {!decorative && <title>{label}</title>}
      <defs><clipPath id={clip}><circle cx={x + 10} cy="10" r="10" /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>{FLAGS[lang] ?? FLAGS.en}</g>
      <circle cx={x + 10} cy="10" r="9.7" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.6" />
    </svg>
  );
}

const US_STRIPES = [0, 2, 4, 6, 8, 10, 12].map((i) => (
  <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#b22234" />
));
const US_STARS = [0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3, 4].map((col) => (
  <circle key={`${row}-${col}`} cx={1.5 + col * 2.6 + (row % 2) * 1.3} cy={1.4 + row * 2.4} r="0.45" fill="#fff" />
)));

const FLAGS: Record<Lang, JSX.Element> = {
  en: (
    <g>
      <rect width="30" height="20" fill="#fff" />
      {US_STRIPES}
      <rect width="13" height={(20 / 13) * 7} fill="#3c3b6e" />
      {US_STARS}
    </g>
  ),
  ru: (
    <g>
      <rect width="30" height="20" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039a6" />
      <rect y="13.33" width="30" height="6.67" fill="#d52b1e" />
    </g>
  ),
  zh: (
    <g>
      <rect width="30" height="20" fill="#de2910" />
      <path d="M5 2.2l1.18 3.63h3.82l-3.09 2.24 1.18 3.63L5 9.46l-3.09 2.24 1.18-3.63L0 5.83h3.82z" fill="#ffde00" />
      <circle cx="10" cy="2" r="0.7" fill="#ffde00" />
      <circle cx="12" cy="4" r="0.7" fill="#ffde00" />
      <circle cx="12" cy="7" r="0.7" fill="#ffde00" />
      <circle cx="10" cy="9" r="0.7" fill="#ffde00" />
    </g>
  ),
  es: (
    <g>
      <rect width="30" height="20" fill="#aa151b" />
      <rect y="5" width="30" height="10" fill="#f1bf00" />
    </g>
  ),
  hi: (
    <g>
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#ff9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.7" />
      <circle cx="15" cy="10" r="0.6" fill="#000080" />
    </g>
  ),
  ja: (
    <g>
      <rect width="30" height="20" fill="#fff" />
      <circle cx="15" cy="10" r="6" fill="#bc002d" />
    </g>
  ),
  ko: (
    <g>
      <rect width="30" height="20" fill="#fff" />
      <path d="M10 10a5 5 0 0 1 10 0z" fill="#cd2e3a" />
      <path d="M10 10a5 5 0 0 0 10 0z" fill="#0047a0" />
      <circle cx="12.5" cy="10" r="2.5" fill="#cd2e3a" />
      <circle cx="17.5" cy="10" r="2.5" fill="#0047a0" />
      <g stroke="#000" strokeWidth="0.9">
        <path d="M4.2 4.4l2.6-2.2M4.9 5.3l2.6-2.2M5.6 6.2l2.6-2.2" />
        <path d="M22.2 13.8l2.6 2.2M22.9 12.9l2.6 2.2M23.6 12l2.6 2.2" />
        <path d="M22.2 6.2l2.6-2.2M21.5 5.3l2.6-2.2M20.8 4.4l2.6-2.2" />
        <path d="M5.6 13.8l2.6 2.2M4.9 14.7l2.6 2.2M4.2 15.6l2.6 2.2" />
      </g>
    </g>
  ),
};

function ChevronDownIcon() {
  return (
    <svg className="language-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
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
    minWidth: 150,
  },
  flag: { display: 'block', flex: '0 0 auto', borderRadius: '50%' },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '9px 16px',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  optionActive: { color: 'var(--accent)' },
};
