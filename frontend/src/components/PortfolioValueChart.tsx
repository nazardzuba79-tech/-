export type ChartRange = '7d' | '30d' | '90d';

interface Point {
  date: string;
  totalValueUsd: string;
}

const RANGE_LABEL: Record<ChartRange, string> = { '7d': '7 дней', '30d': '30 дней', '90d': '90 дней' };

/** Plain-SVG area/line chart, same no-library approach as Sparkline and
 * PortfolioDonut. Real accumulated history only (see PortfolioSnapshot's
 * schema.prisma doc comment) — with 0 or 1 points there's nothing to draw
 * a trend from yet, so this shows an honest "collecting data" message
 * instead of faking a flat or invented line. */
export function PortfolioValueChart({
  points,
  range,
  onRangeChange,
  loading,
}: {
  points: Point[];
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  loading: boolean;
}) {
  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 28, left: 12 };

  const values = points.map((p) => parseFloat(p.totalValueUsd));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const range_ = max - min || Math.max(max, 1) * 0.1 || 1;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const coords = points.map((p, i) => {
    const x = padding.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = padding.top + plotH - ((parseFloat(p.totalValueUsd) - min) / range_) * plotH;
    return { x, y };
  });

  const positive = points.length >= 2 ? values[values.length - 1] >= values[0] : true;
  const color = positive ? '#00a878' : '#e5484d';
  const changeUsd = points.length >= 2 ? values[values.length - 1] - values[0] : 0;
  const changePct = points.length >= 2 && values[0] !== 0 ? (changeUsd / values[0]) * 100 : 0;

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padding.bottom} L ${coords[0].x.toFixed(1)} ${height - padding.bottom} Z`
      : '';

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h3 style={styles.title}>Прибыль портфеля</h3>
          {points.length >= 2 && (
            <div style={{ ...styles.change, color }}>
              {changeUsd >= 0 ? '+' : ''}
              {changeUsd.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USD ({changePct >= 0 ? '+' : ''}
              {changePct.toFixed(2)}%) за {RANGE_LABEL[range]}
            </div>
          )}
        </div>
        <div style={styles.rangeRow}>
          {(['7d', '30d', '90d'] as ChartRange[]).map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              style={{ ...styles.rangeBtn, ...(range === r ? styles.rangeBtnActive : {}) }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={styles.emptyState}>Загрузка…</div>
      ) : points.length < 2 ? (
        <div style={styles.emptyState}>
          Пока недостаточно данных для графика — история собирается по одной точке в день с момента первого захода на
          эту страницу. Загляните завтра.
        </div>
      ) : (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="portfolioAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#portfolioAreaFill)" stroke="none" />
          <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {coords.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 3 : 0} fill={color} />
          ))}
        </svg>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: '#14171d' },
  change: { fontSize: 13, fontWeight: 600 },
  rangeRow: { display: 'flex', gap: 6 },
  rangeBtn: {
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 700,
    color: '#4b5563',
  },
  rangeBtnActive: { background: '#14171d', color: '#ffffff', borderColor: '#14171d' },
  emptyState: {
    minHeight: 160,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 1.6,
    padding: '0 20px',
  },
};

