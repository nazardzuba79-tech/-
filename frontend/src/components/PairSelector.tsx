import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

/**
 * Trade-page pair picker — button showing the current pair, opens a
 * searchable dropdown of pairs. Reuses the Kraken symbol mirror
 * (/market/external/symbols) as the pair list, since that's already a
 * real, maintained list of tradeable assets — but trading itself only
 * ever happens on our OWN internal order book for that pair name, not on
 * Kraken. A pair nobody has traded here yet just starts with an empty book.
 */
export function PairSelector({ pair, onChange }: { pair: string; onChange: (pair: string) => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || pairs.length > 0) return;
    api
      .getExternalSymbols()
      .then((res) => setPairs(res.symbols.map((s) => s.pair)))
      .catch(() => {});
  }, [open, pairs.length]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = pairs.filter((p) => p.toLowerCase().includes(search.toLowerCase())).slice(0, 200);

  return (
    <div ref={containerRef} style={styles.container}>
      <button onClick={() => setOpen((o) => !o)} style={styles.button}>
        <span className="mono" style={{ fontWeight: 700 }}>
          {pair}
        </span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div style={styles.dropdown}>
          <input
            autoFocus
            placeholder={t('trade.searchPair')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.search}
          />
          <div style={styles.list}>
            {filtered.map((p) => (
              <button
                key={p}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                  setSearch('');
                }}
                style={{ ...styles.option, ...(p === pair ? styles.optionActive : {}) }}
                className="mono"
              >
                {p}
              </button>
            ))}
            {pairs.length === 0 && <p style={styles.hint}>{t('trade.loading')}</p>}
            {pairs.length > 0 && filtered.length === 0 && <p style={styles.hint}>{t('trade.nothingFound')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { position: 'relative' },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '7px 10px',
    fontSize: 14,
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    width: 260,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflow: 'hidden',
  },
  search: {
    width: '100%',
    background: 'var(--panel-alt)',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  list: { maxHeight: 280, overflowY: 'auto' },
  option: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '8px 12px',
    fontSize: 12,
    color: 'var(--text-primary)',
  },
  optionActive: { background: 'var(--panel-alt)', color: 'var(--accent)' },
  hint: { padding: 14, color: 'var(--text-tertiary)', fontSize: 12 },
};
