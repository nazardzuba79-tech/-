import { useState } from 'react';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { Field, inputClass } from './Field';
import { useLanguage } from '../../lib/i18n';

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: React.ReactNode;
  autoComplete?: string;
};

/** Password input with a visibility toggle. The toggle is a real button
 *  with an aria-label, so it is reachable and announced by keyboard and
 *  screen reader rather than being a decorative glyph. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete = 'new-password',
}: PasswordFieldProps) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);

  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className="vx-auth-password">
        <input
          id={id}
          required
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder="••••••••"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('register.hidePassword') : t('register.showPassword')}
          aria-pressed={visible}
          className="vx-auth-eye"
        >
          {visible ? <EyeOffIcon size={19} /> : <EyeIcon size={15} />}
        </button>
      </div>
    </Field>
  );
}
