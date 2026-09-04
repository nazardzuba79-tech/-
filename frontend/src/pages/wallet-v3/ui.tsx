import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircleIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';

/**
 * The Wallet workspace's shared primitives, ported from the approved V3
 * design: light surfaces, hairline borders, small radii, gold as the single
 * accent. Deliberately local to this page rather than added to the app's
 * shared component set — everything else in VOLTEX is a dark terminal, and
 * these would be wrong there.
 */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon: typeof AlertCircleIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 text-center ${compact ? 'py-10' : 'py-14'}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-w border border-hair bg-panel-2">
        <Icon className="h-4 w-4 text-ink-4" strokeWidth={1.6} />
      </span>
      <p className="mt-3 text-[13px] font-medium text-ink-2">{title}</p>
      {description && <p className="mt-1 max-w-[300px] text-[12px] leading-[18px] text-ink-4">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{children}</span>
      {hint && <span className="num text-[11px] text-ink-3">{hint}</span>}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  id,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full appearance-none rounded-w border border-hair bg-panel pl-3 pr-9 text-[13px] font-medium text-ink transition-colors duration-150 ease-exp hover:border-hair-strong focus:border-gold disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-ink-4"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-white">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
        strokeWidth={1.8}
      />
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  suffix,
  invalid,
  id,
  inputMode = 'text',
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suffix?: ReactNode;
  invalid?: boolean;
  id?: string;
  inputMode?: 'text' | 'decimal';
  mono?: boolean;
}) {
  return (
    <div
      className={`flex h-10 items-center rounded-w border bg-panel pl-3 pr-2 transition-colors duration-150 ease-exp ${
        invalid ? 'border-neg' : 'border-hair hover:border-hair-strong focus-within:border-gold'
      }`}
    >
      <input
        id={id}
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4 ${mono ? 'num' : ''}`}
      />
      {suffix && <div className="flex shrink-0 items-center gap-2 pl-2">{suffix}</div>}
    </div>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-4 text-neg">
      <AlertCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
      <span>{children}</span>
    </p>
  );
}

export function SummaryRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className={`num text-[12.5px] ${strong ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>{value}</span>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 items-center justify-center gap-2 rounded-w px-4 text-[13px] font-semibold transition-colors duration-150 ease-exp ${full ? 'w-full' : ''} ${
        disabled
          ? 'cursor-not-allowed border border-hair bg-panel-3 text-ink-4'
          : 'bg-gold text-[#26190a] hover:bg-gold-light'
      }`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 items-center justify-center gap-2 rounded-w border border-hair bg-panel px-4 text-[13px] font-medium text-ink-2 transition-colors duration-150 ease-exp hover:border-hair-strong hover:bg-panel-2 hover:text-ink ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * Portalled to the body so the modal is never clipped by the page's own
 * `overflow-x: clip`, and given its own root class so the scoped reset in
 * wallet.css reaches it (see that file's tail).
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-[456px]',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const { t } = useLanguage();
  const closeLabel = t('deposit.close');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="vx-wallet-modal-root fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-[#101828]/35" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full ${width} max-h-[92vh] overflow-hidden rounded-t-wlg border border-hair bg-panel shadow-modal sm:rounded-wlg`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hair-soft px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="-mr-1 -mt-0.5 flex h-7 w-7 items-center justify-center rounded-w text-ink-3 transition-colors duration-150 ease-exp hover:bg-panel-3 hover:text-ink"
          >
            <XIcon className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-136px)] overflow-y-auto px-5 py-4">{children}</div>

        {footer && <div className="border-t border-hair-soft bg-surface-1 px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
