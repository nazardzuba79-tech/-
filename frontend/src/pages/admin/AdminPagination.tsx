import { styles } from './adminStyles';
import { ChevronLeftIcon, ChevronRightIcon } from './AdminIcons';

export function AdminPagination({
  page,
  totalPages,
  total,
  pageSize,
  itemLabel,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = buildPageList(page, totalPages);

  return (
    <div style={styles.paginationRow}>
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
        {from}–{to} {itemLabel} {total.toLocaleString()}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => onPageChange(page - 1)} disabled={page === 1} style={{ ...styles.pageBtn, opacity: page === 1 ? 0.4 : 1 }}>
          <ChevronLeftIcon size={14} />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} style={{ padding: '0 4px', color: 'var(--text-tertiary)', fontSize: 13 }}>
              …
            </span>
          ) : (
            <button key={p} onClick={() => onPageChange(p as number)} style={{ ...styles.pageBtn, ...(p === page ? styles.pageBtnActive : {}) }}>
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          style={{ ...styles.pageBtn, opacity: page === totalPages ? 0.4 : 1 }}
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </div>
  );
}

function buildPageList(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push('...');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
