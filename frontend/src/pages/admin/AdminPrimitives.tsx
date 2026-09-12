import { useEffect, useRef, useState, type ReactNode } from 'react';
import { styles } from './adminStyles';
import { railDisplay } from './depositRails';

export function CopyValue({ value, label = 'Значение' }: { value: string | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!value) return <span>—</span>;
  return <span className="admin-copy-value">
    <span className="mono admin-ellipsis" title={value}>{value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value}</span>
    <button type="button" className="admin-copy" title={`${label}: ${value}`} aria-label={`Копировать ${label}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); setFailed(false); }
      catch { setFailed(true); }
    }}>{copied ? '✓' : '⧉'}</button>
    <span className="admin-sr-only" role="status">{failed ? 'Не удалось скопировать. Полное значение доступно в подсказке.' : copied ? 'Скопировано' : ''}</span>
  </span>;
}
export function RailLabel({ asset, chain }: { asset: string; chain: string }) {
  const rail = railDisplay(asset, chain);
  return <span className="admin-rail-label" title={rail.label}><strong>{asset}</strong><small>{rail.network}{rail.standard !== '—' ? ` (${rail.standard})` : ''}</small></span>;
}
export function AdminModal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="admin-modal" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>{title}</h2><button type="button" style={styles.neutralBtn} disabled={busy} aria-label="Закрыть" onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}
