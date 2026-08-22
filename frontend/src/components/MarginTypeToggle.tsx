import { useLanguage } from '../lib/i18n';

export function MarginTypeToggle({
  value,
  onChange,
}: {
  value: 'ISOLATED' | 'CROSS';
  onChange: (v: 'ISOLATED' | 'CROSS') => void;
}) {
  const { t } = useLanguage();
  return (
    <div style={styles.wrap}>
      <button
        type="button"
        onClick={() => onChange('ISOLATED')}
        style={{ ...styles.btn, ...(value === 'ISOLATED' ? styles.btnActive : {}) }}
      >
        {t('futures.isolated')}
      </button>
      <button
        type="button"
        onClick={() => onChange('CROSS')}
        style={{ ...styles.btn, ...(value === 'CROSS' ? styles.btnActive : {}) }}
      >
        {t('futures.cross')}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    background: 'var(--panel-alt)',
    borderRadius: 8,
    padding: 3,
  },
  btn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    padding: '8px 0',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  btnActive: {
    background: 'var(--panel)',
    color: 'var(--text-primary)',
    boxShadow: 'var(--shadow-sm)',
  },
};
