/** Shimmering placeholder block standing in for content that hasn't
 * loaded yet — see .skeleton in index.css. Use instead of bare "Загрузка..."
 * text so a loading list/card reads as "this is about to be a table",
 * not as an empty or broken panel. */
export function Skeleton({ width = '100%', height = 14, radius = 6, style }: { width?: number | string; height?: number; radius?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** A row of skeleton cells matching a grid-based list row (pair picker,
 * markets table, wallet balances, ...). `columns` are relative widths. */
export function SkeletonRow({ columns, height = 14 }: { columns: (number | string)[]; height?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 14px' }}>
      {columns.map((w, i) => (
        <Skeleton key={i} width={w} height={height} style={{ flex: typeof w === 'number' ? w : undefined }} />
      ))}
    </div>
  );
}
