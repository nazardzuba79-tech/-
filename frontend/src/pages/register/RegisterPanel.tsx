import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangleIcon, ArrowLeftIcon, ArrowRightIcon, Loader2Icon, LockKeyholeIcon } from 'lucide-react';
import { api, ApiError, setToken } from '../../lib/api';
import { defaultTradingPath } from '../../lib/tradingMode';
import { readNext } from '../../lib/returnTo';
import { useLanguage } from '../../lib/i18n';
import { REFERRAL_CODE_STORAGE_KEY } from '../ReferralRedirectPage';
import { AuthField, AuthPasswordField } from '../auth-shell/AuthFields';

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
 * Nothing here declares success on a timer, and the form shows no message
 * of its own after a submit: either the server answered with a token and
 * this component navigates away, or it answered with an error and that
 * error is what appears.
 */

/** Minimum accepted by the backend (registerSchema: z.string().min(10)).
 *  The hint states the threshold that actually applies, and adds no
 *  further requirements — no digit, no special character, no separate
 *  lowercase rule, no checklist. */
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
    <div className="vx-auth-body vx-auth-enter">
      <div className="vx-auth-overline">{t('authShell.overline.register')}</div>
      <h1>{t('register.title')}</h1>
      <p className="vx-auth-sub">{t('register.subtitle')}</p>

      <form onSubmit={handleSubmit} noValidate className="vx-auth-form">
        <AuthField id="reg-email" label={t('register.email')} error={errors.email}>
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
            className={`vx-auth-input${errors.email ? ' vx-auth-input-error' : ''}`}
          />
        </AuthField>

        <AuthPasswordField
          id="reg-password"
          label={t('register.password')}
          value={password}
          onChange={(value) => {
            setPassword(value);
            if (errors.password) setErrors(({ password: _drop, ...rest }) => rest);
          }}
          error={errors.password}
          hint={
            <p className={`vx-auth-hint${password.length > 0 && passwordOk ? ' vx-auth-hint-ok' : ''}`}>
              {t('register.passwordHint')}
            </p>
          }
        />

        {globalError && (
          <div role="alert" className="vx-auth-alert">
            <AlertTriangleIcon size={14} />
            {globalError}
          </div>
        )}

        <button type="submit" disabled={!canSubmit} className="vx-auth-submit">
          {loading ? <Loader2Icon size={16} className="vx-auth-spin" /> : null}
          {loading ? t('register.submitting') : t('register.title')}
          {!loading && <ArrowRightIcon size={16} />}
        </button>
      </form>

      {/* A statement, not a gate: there is no checkbox to tick and nothing
          here blocks the submit. */}
      <p className="vx-auth-legal">
        {t('register.legal.prefix')}
        <Link to="/legal/terms">{t('register.legal.terms')}</Link>
        {t('register.legal.mid')}
        <Link to="/legal/privacy">{t('register.legal.privacy')}</Link>
        {t('register.legal.suffix')}
      </p>

      <p className="vx-auth-security">
        <LockKeyholeIcon size={14} strokeWidth={1.8} />
        {t('register.securityNote')}
      </p>

      <Link to="/" className="vx-auth-back">
        <ArrowLeftIcon size={12} />
        {t('register.backHome')}
      </Link>
    </div>
  );
}
