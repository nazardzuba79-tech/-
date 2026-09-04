import { useState, type ReactNode } from 'react';
import { AlertCircleIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';

/**
 * The two controls both auth forms are built from. Shared so the login and
 * registration fields are measurably the same box, and so the accessibility
 * wiring is written once: a real <label htmlFor>, an `${id}-error` message
 * the input points at with aria-describedby, and a password toggle that is
 * a real button with an aria-label rather than a decorative glyph.
 */

type AuthFieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Rendered on the label's row, right-aligned — the login form's
   *  "Забыли пароль?" control. */
  aside?: ReactNode;
  children: ReactNode;
};

export function AuthField({ id, label, error, hint, aside, children }: AuthFieldProps) {
  return (
    <div className="vx-auth-field">
      {aside ? (
        <div className="vx-auth-label-row">
          <label htmlFor={id} className="vx-auth-label">
            {label}
          </label>
          {aside}
        </div>
      ) : (
        <label htmlFor={id} className="vx-auth-label">
          {label}
        </label>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="vx-auth-error-text">
          <AlertCircleIcon size={12} />
          {error}
        </p>
      )}
      {!error && hint}
    </div>
  );
}

type AuthPasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  aside?: ReactNode;
  autoComplete?: string;
  required?: boolean;
};

export function AuthPasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  aside,
  autoComplete = 'new-password',
  required,
}: AuthPasswordFieldProps) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);

  return (
    <AuthField id={id} label={label} error={error} hint={hint} aside={aside}>
      <div className="vx-auth-password">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          placeholder="••••••••"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`vx-auth-input${error ? ' vx-auth-input-error' : ''}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('register.hidePassword') : t('register.showPassword')}
          aria-pressed={visible}
          className="vx-auth-toggle"
        >
          {visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        </button>
      </div>
    </AuthField>
  );
}
