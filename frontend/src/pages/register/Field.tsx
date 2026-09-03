import { ReactNode } from 'react';
import { AlertCircleIcon } from 'lucide-react';

/** Shared input styling, so every field on the card is measurably the same
 *  height and edge. Exported because PasswordField composes it with its own
 *  right-hand padding for the visibility toggle. */
export const inputClass =
  'h-[46px] w-full rounded-[7px] border bg-ink-850 px-3.5 text-[13.5px] text-white placeholder:text-faint outline-none transition-colors duration-150 ease-out focus:border-gold-500 focus:bg-ink-800';

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Label + control + error, wired for assistive tech: the label is a real
 * <label htmlFor>, and the error carries the `${id}-error` id that each
 * control points at with aria-describedby.
 */
export function Field({ id, label, error, hint, children, className = '' }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[11.5px] font-medium text-home-muted">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-down">
          <AlertCircleIcon size={12} className="shrink-0" />
          {error}
        </p>
      )}
      {!error && hint}
    </div>
  );
}
