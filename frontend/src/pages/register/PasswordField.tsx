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
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder="••••••••"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${inputClass} pr-11 ${error ? 'border-down/70' : 'border-line'}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('register.hidePassword') : t('register.showPassword')}
          aria-pressed={visible}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[6px] text-faint transition-colors duration-150 ease-out hover:text-white"
        >
          {visible ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
        </button>
      </div>
    </Field>
  );
}
