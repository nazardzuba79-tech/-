import { useLanguage } from '../lib/i18n';

// Common fixed-leverage presets, same shorthand every major exchange's
// order form offers next to the free-drag slider.
const PRESETS = [2, 5, 10, 20, 50];

/** 1x-100x leverage slider — turns red past `warningThreshold` (>20x per
 * the futures spec) so the risk is visible before the trader even submits,
 * not just in a confirmation modal after the fact. */
export function LeverageSlider({
  value,
  onChange,
  min,
  max,
  warningThreshold,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  warningThreshold: number;
}) {
  const { t } = useLanguage();
  const isHigh = value >= warningThreshold;

  return (
    <div style={styles.wrap}>
      <div style={styles.labelRow}>
        <span>{t('futures.leverage')}</span>
        <span className="mono" style={{ ...styles.value, color: isHigh ? 'var(--sell)' : 'var(--accent)' }}>
          {value}x
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...styles.slider, accentColor: isHigh ? 'var(--sell)' : 'var(--accent)' }}
      />
      <div style={styles.ticks}>
        <span>{min}x</span>
        <span>{Math.round((min + max) / 2)}x</span>
        <span>{max}x</span>
      </div>
      <div style={styles.presetRow}>
        {PRESETS.filter((p) => p >= min && p <= max).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            style={{ ...styles.presetBtn, ...(value === p ? styles.presetBtnActive : {}) }}
          >
            {p}x
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  value: { fontSize: 13, fontWeight: 800 },
  slider: { width: '100%', cursor: 'pointer' },
  ticks: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    color: 'var(--text-tertiary)',
  },
  presetRow: {
    display: 'flex',
    gap: 6,
    marginTop: 2,
  },
  presetBtn: {
    flex: 1,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 0',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 700,
  },
  presetBtnActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: 'var(--on-accent)',
  },
};
