import { useEffect, useRef, useState } from 'react';
import { styles } from './adminStyles';
import { SearchIcon, ChevronDownIcon, DownloadIcon } from './AdminIcons';

export interface AdminFilterDef {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
}

export function AdminSearchBar({
  value,
  onChange,
  placeholder,
  filters,
  onFilterChange,
  onExport,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  filters: AdminFilterDef[];
  onFilterChange: (id: string, value: string) => void;
  onExport?: () => void;
}) {
  return (
    <div style={styles.searchBarRow}>
      <div style={styles.searchInputWrap}>
        <span style={styles.searchInputIcon}>
          <SearchIcon size={16} />
        </span>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={styles.searchInput} />
      </div>
      {filters.map((f) => (
        <FilterDropdown key={f.id} filter={f} onChange={(v) => onFilterChange(f.id, v)} />
      ))}
      {onExport && (
        <button onClick={onExport} className="admin-nav-link" style={styles.filterBtn}>
          <DownloadIcon size={15} /> Export
        </button>
      )}
    </div>
  );
}

function FilterDropdown({ filter, onChange }: { filter: AdminFilterDef; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = filter.options.find((o) => o.value === filter.value);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...styles.filterBtn, ...(filter.value ? styles.filterBtnActive : {}) }}>
        {current ? current.label : filter.label}
        <span style={{ display: 'inline-flex', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }}>
          <ChevronDownIcon size={14} />
        </span>
      </button>
      {open && (
        <div className="admin-dropdown-in" style={styles.filterMenu}>
          <button
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            style={{ ...styles.filterMenuItem, ...(!filter.value ? styles.filterMenuItemActive : {}) }}
          >
            All {filter.label}
          </button>
          {filter.options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{ ...styles.filterMenuItem, ...(filter.value === opt.value ? styles.filterMenuItemActive : {}) }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
