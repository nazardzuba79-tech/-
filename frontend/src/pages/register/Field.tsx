import { ReactNode } from 'react';
import { AlertCircleIcon } from 'lucide-react';

/** Shared input styling, so every field on the card is measurably the same
 *  height and edge. Exported because PasswordField composes it with its own
 *  right-hand padding for the visibility toggle. */
export const inputClass = 'vx-auth-input';

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
    <div className={`vx-auth-field ${className}`}>
      <label htmlFor={id} >
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="vx-auth-error">
          <AlertCircleIcon size={12} className="shrink-0" />
          {error}
        </p>
      )}
      {!error && hint}
    </div>
  );
}
