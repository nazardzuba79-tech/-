import { useLanguage } from '../lib/i18n';

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
};
