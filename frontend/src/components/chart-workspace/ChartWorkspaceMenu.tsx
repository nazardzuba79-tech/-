import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * One popover for every chart-workspace menu (2026-10-13): rendered into
 * document.body (the toolbar clips its overflow on every terminal design),
 * placed under its anchor and kept inside the viewport, closed by Escape
 * (focus back on the anchor), an outside press, a resize or a scroll, and
 * walked with the arrow keys. On a phone it becomes a bottom sheet.
 */
export interface ChartWorkspaceMenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: (returnFocus: boolean) => void;
  label: string;
  width?: number;
  /** Bottom sheet instead of a popover. */
  sheet?: boolean;
  align?: 'left' | 'right';
  children: ReactNode;
  className?: string;
  /** A test hook on the menu element. */
  testId?: string;
  /** Focus the first control when opened from the keyboard. */
  autoFocus?: boolean;
}

const MARGIN = 8;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [role^="menuitem"]:not([disabled]), [tabindex="0"]';

export function ChartWorkspaceMenu({ open, anchor, onClose, label, width = 260, sheet = false, align = 'left', children, className, testId, autoFocus = false }: ChartWorkspaceMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Place under the anchor; flip above when there is more room there.
  useLayoutEffect(() => {
    if (!open || sheet) { setPos(null); return; }
    const place = () => {
      const box = anchor?.getBoundingClientRect();
      const menu = ref.current;
      const height = menu ? menu.scrollHeight : 240;
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.min(width, vw - MARGIN * 2);
      let left = box ? (align === 'right' ? box.right - w : box.left) : MARGIN;
      left = Math.max(MARGIN, Math.min(vw - w - MARGIN, left));
      const below = box ? box.bottom + 6 : MARGIN;
      const spaceBelow = vh - MARGIN - below;
      const spaceAbove = box ? box.top - 6 - MARGIN : 0;
      let top = below, maxHeight = spaceBelow;
      if (height > spaceBelow && spaceAbove > spaceBelow) { maxHeight = spaceAbove; top = Math.max(MARGIN, (box ? box.top - 6 : vh) - Math.min(height, spaceAbove)); }
      setPos({ top, left, maxHeight: Math.max(120, maxHeight) });
    };
    place();
  }, [open, anchor, width, align, sheet, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      onClose(false);
    };
    // The page moving under the anchor closes the popover; the menu's own list scrolling (a long «Ещё», a status line pushing content) does not.
    const onViewport = (event?: Event) => { if (event?.type === 'scroll' && event.target instanceof Node && ref.current?.contains(event.target)) return; onClose(false); };
    // Escape closes the menu wherever focus is — on its trigger after a mouse
    // click, in the chart, in a field inside — and nothing behind it (the
    // drawing tool, full screen, the page) sees that press.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onViewport);
    if (!sheet) window.addEventListener('scroll', onViewport, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [open, anchor, onClose, sheet]);

  useEffect(() => {
    if (!open || !autoFocus) return;
    const first = ref.current?.querySelector<HTMLElement>('input[type="search"], input, [role^="menuitem"], button');
    first?.focus();
  }, [open, autoFocus]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (typing && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1)
      : event.key === 'Home' ? 0 : items.length - 1;
    event.preventDefault();
    items[next]?.focus();
  };

  if (!open || typeof document === 'undefined') return null;
  const style = sheet ? undefined : pos ? { top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - MARGIN * 2), maxHeight: pos.maxHeight } : { visibility: 'hidden' as const };
  return createPortal(
    <div className={`cw-menu-layer${sheet ? ' is-sheet' : ''}`} data-cw-menu-layer>
      {sheet && <div className="cw-sheet-backdrop" aria-hidden="true" onPointerDown={() => onClose(false)} />}
      <div
        ref={ref}
        className={`cw-menu${sheet ? ' cw-sheet' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-label={label}
        aria-modal={sheet || undefined}
        data-cw-menu={testId}
        style={style}
        onKeyDown={onKeyDown}
      >
        {sheet && <div className="cw-sheet-head"><span>{label}</span><button type="button" className="cw-sheet-close" aria-label="×" onClick={() => onClose(true)}>×</button></div>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Keep a stable anchor element reference for a menu. */
export function useMenuAnchor(): [HTMLElement | null, (node: HTMLElement | null) => void] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return [node, setNode];
}
