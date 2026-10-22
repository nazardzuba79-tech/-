import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import './adminActionMenu.css';

type Item = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; suffix?: ReactNode };

/** Admin actions use the same portal/viewport pattern as ChartToolbarMenus.
 * Portaling to the admin shell preserves its light tokens and escapes table overflow. */
export function AdminActionMenu({ label, items, text }: { label: string; items: Item[]; text?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const lastFocus = useRef(false);
  const id = useId();
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const place = () => {
    if (!trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect(), box = menu.current.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) { close(); return; }
    setPosition({
      left: Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8)),
      top: anchor.bottom + 6 + box.height <= window.innerHeight - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6),
    });
  };
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    place();
    const buttons = menu.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    buttons[lastFocus.current ? buttons.length - 1 : 0]?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    // Browser/table scrolling can settle just after clicking a last-row trigger.
    // Re-anchor instead of closing a menu the user has only just opened.
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place(); };
    const resize = () => place();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
    if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
  };
  return <>
    <button ref={trigger} type="button" className={`admin-action-trigger${text ? ' admin-action-trigger-text' : ''}`}
      aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { lastFocus.current = false; setOpen(!open); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); lastFocus.current = event.key === 'ArrowUp'; setOpen(true); }
        if (event.key === 'Escape') close(true);
      }}>{text ? <>{text}<ChevronDown size={14} aria-hidden="true" /></> : <MoreHorizontal size={18} aria-hidden="true" />}</button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className="admin-action-menu" style={position} onKeyDown={keys}>
      {items.map((item, index) => <div key={item.label} role="none">
        {item.danger && index > 0 && <div className="admin-action-divider" role="separator" />}
        <button type="button" role="menuitem" tabIndex={-1} className={item.danger ? 'admin-action-danger' : undefined} disabled={item.disabled}
          onClick={() => { close(true); item.onSelect(); }}>{item.label}{item.suffix}</button>
      </div>)}
    </div>, trigger.current?.closest('.admin-page-grid') ?? document.body)}
  </>;
}
