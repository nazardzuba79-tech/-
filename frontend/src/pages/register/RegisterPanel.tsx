import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangleIcon, Loader2Icon, ShieldIcon } from 'lucide-react';
import { api, ApiError, setToken } from '../../lib/api';
import { defaultTradingPath } from '../../lib/tradingMode';
import { readNext } from '../../lib/returnTo';
import { useLanguage } from '../../lib/i18n';
import { REFERRAL_CODE_STORAGE_KEY } from '../ReferralRedirectPage';
import { Field, inputClass } from './Field';
import { PasswordField } from './PasswordField';

/**
 * The registration form, wired to the exchange's real auth.
 *
 *   form -> submitting -> signed in
 *
 * One real server call does all of it: POST /auth/register creates the
 * account and answers with the same session token /auth/login issues. There
 * is no email code, no verification screen and no second step — the token is
 * stored and the user lands in the platform.
 *
 * Nothing here declares success on a timer: the navigation happens only
 * after the server has answered with a token.
 */

/** Minimum accepted by the backend (registerSchema: z.string().min(10)).
 *  The approved design's hint reads "8+"; the server rejects 8- and
 *  9-character passwords, so the UI states the threshold that actually
 *  applies rather than one that would guarantee a failed submit. The hint
 *  keeps the approved two-part shape and adds no further requirements —
 *  no digit, no special character, no separate lowercase rule, no
 *  checklist. */
const PASSWORD_MIN = 10;

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function hasUppercase(value: string): boolean {
  return /[A-ZА-ЯЁ]/.test(value);
}

function isValidPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN && hasUppercase(value);
}

/**
 * The registration endpoint answers with two fixed English strings (see
 * src/api/routes/auth.ts): "Registration failed" — used for a duplicate
 * email and deliberately generic so an unauthenticated caller cannot
 * enumerate registered addresses — and "Registration is currently closed"
 * when REGISTRATION_OPEN=false. Those two are the app's own server strings,
 * so they get the app's own translations rather than being shown in English
 * inside a Russian, Japanese or Korean form.
 *
 * Anything else the server says is passed through verbatim: inventing a
 * friendlier wording for an error we have not seen would hide what actually
 * went wrong.
 */
function useServerErrorLocalizer() {
  const { t } = useLanguage();
  return (message: string): string => {
    if (message === 'Registration failed') return t('register.error.failed');
    if (message === 'Registration is currently closed') return t('register.error.closed');
    // The throttling messages our own express-rate-limit instances emit.
    if (message.startsWith('Too many registration attempts')) return t('register.error.tooManyAttempts');
    return message;
  };
}

export function RegisterPanel() {
  const { t } = useLanguage();
  const localizeServerError = useServerErrorLocalizer();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading] = useState(false);

  // A visitor who arrived through a referral link (/:code -> stored by
  // ReferralRedirectPage) still has that code applied, but the form does not
  // ask for one: referral codes reach registration by following a link, not
  // by being typed. There is deliberately no referral input — the signup form
  // is email and password, nothing else.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
      if (stored) setReferral(stored);
    } catch {
      // no localStorage access — registration simply proceeds without one
    }
  }, []);

  const passwordOk = isValidPassword(password);
  const canSubmit = isValidEmail(email) && passwordOk && !loading;

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!isValidEmail(email)) next.email = t('register.error.email');
    if (password.length < PASSWORD_MIN) next.password = t('register.error.passwordShort');
    else if (!hasUppercase(password)) next.password = t('register.error.passwordUppercase');
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGlobalError('');
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const ref = referral.trim() ? referral.trim() : undefined;
      const result = await api.register(email.trim(), password, ref);
      // The referral code has been consumed by a real registration; leaving
      // it in storage would re-apply it to the next account created in this
      // browser.
      try {
        localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
      } catch {
        // harmless if this fails — the code just lingers unused
      }
      // The server answered with a real session token, so this browser is
      // signed in from here on — straight into the platform, honouring a
      // ?next= the visitor arrived with.
      setToken(result.token);
      navigate(readNext(window.location.search) ?? defaultTradingPath(), { replace: true });
    } catch (err) {
      setGlobalError(err instanceof ApiError ? localizeServerError(err.message) : t('auth.genericError'));
      setLoading(false);
    }
    // No `finally`: on success this component is navigating away, and
    // clearing `loading` there would flash the button back to its idle label
    // for a frame before it unmounts.
  }

  return (
    <div className="w-full max-w-[430px]">
      <div className="vx-enter rounded-[12px] border border-[#202a35] bg-ink-800 p-6 sm:p-7">
        <div className="vx-step">
          <h2 className="text-[21px] font-semibold tracking-[-0.01em] text-white">{t('register.title')}</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-home-muted">{t('register.subtitle')}</p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-[18px]">
            <Field id="reg-email" label={t('register.email')} error={errors.email}>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors(({ email: _drop, ...rest }) => rest);
                }}
                onBlur={() => {
                  if (email && !isValidEmail(email)) {
                    setErrors((prev) => ({ ...prev, email: t('register.error.email') }));
                  }
                }}
                autoComplete="email"
                placeholder="name@example.com"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'reg-email-error' : undefined}
                className={`${inputClass} ${errors.email ? 'border-down/70' : 'border-line'}`}
              />
            </Field>

            <PasswordField
              id="reg-password"
              label={t('register.password')}
              value={password}
              onChange={(value) => {
                setPassword(value);
                if (errors.password) setErrors(({ password: _drop, ...rest }) => rest);
              }}
              error={errors.password}
              hint={
                <p
                  className={`mt-1.5 text-[10.5px] transition-colors duration-150 ease-out ${
                    password.length > 0 && passwordOk ? 'text-up' : 'text-faint'
                  }`}
                >
                  {t('register.passwordHint')}
                </p>
              }
            />

            {globalError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[7px] border border-down/40 bg-down/[0.08] px-3 py-2.5 text-[11.5px] text-down"
              >
                <AlertTriangleIcon size={13} className="mt-[1px] shrink-0" />
                {globalError}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex h-[48px] w-full items-center justify-center gap-2 rounded-[7px] bg-gold-500 text-[13.5px] font-semibold text-ink-950 transition-[background-color,transform] duration-150 ease-out hover:bg-gold-400 active:translate-y-[1px] active:bg-gold-600 disabled:cursor-not-allowed disabled:bg-ink-760 disabled:text-white/35"
            >
              {loading && <Loader2Icon size={15} className="animate-spin" />}
              {loading ? t('register.submitting') : t('register.title')}
            </button>
          </form>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-faint">
        <ShieldIcon size={13} className="mt-[1px] shrink-0" strokeWidth={1.75} />
        {t('register.securityNote')}
      </p>
    </div>
  );
}
