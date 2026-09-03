import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, ShieldIcon } from 'lucide-react';
import { api, ApiError, setToken } from '../../lib/api';
import { defaultTradingPath } from '../../lib/tradingMode';
import { useLanguage } from '../../lib/i18n';
import { REFERRAL_CODE_STORAGE_KEY } from '../ReferralRedirectPage';
import { Field, inputClass } from './Field';
import { PasswordField } from './PasswordField';

/**
 * The registration form, wired to the exchange's real auth.
 *
 * There are exactly two states, and the second is only reachable after the
 * backend has actually created the account:
 *
 *   form  -> POST /auth/register (api.register)
 *   success
 *
 * The prototype's middle step — a six-digit OTP screen — is deliberately
 * absent. This backend has no email verification of any kind: no
 * emailVerified column, no verification token, no code-issuing endpoint and
 * no verification mailer (see prisma/schema.prisma and
 * src/api/routes/auth.ts). Registration returns a session token and the
 * account is live immediately. Rendering an OTP screen would mean inventing
 * a step the server cannot confirm, so the step is omitted rather than
 * faked. See the report accompanying this change.
 *
 * Nothing here declares success on a timer: `setStep('success')` runs only
 * inside the resolved branch of the real request, and the session token it
 * stores is the one the server issued.
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
    return message;
  };
}

export function RegisterPanel() {
  const { t } = useLanguage();
  const localizeServerError = useServerErrorLocalizer();
  const navigate = useNavigate();

  const [step, setStep] = useState<'form' | 'success'>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [referralOpen, setReferralOpen] = useState(false);
  const [referral, setReferral] = useState('');
  const [terms, setTerms] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading] = useState(false);

  // A visitor who arrived through a referral link (/:code -> stored by
  // ReferralRedirectPage) gets the field pre-filled and opened, so the code
  // they followed is visible rather than applied invisibly. They can still
  // clear or replace it.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
      if (stored) {
        setReferral(stored);
        setReferralOpen(true);
      }
    } catch {
      // no localStorage access — registration simply proceeds without one
    }
  }, []);

  const passwordOk = isValidPassword(password);
  const canSubmit =
    isValidEmail(email) && passwordOk && confirm.length > 0 && confirm === password && terms && !loading;

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!isValidEmail(email)) next.email = t('register.error.email');
    if (password.length < PASSWORD_MIN) next.password = t('register.error.passwordShort');
    else if (!hasUppercase(password)) next.password = t('register.error.passwordUppercase');
    if (!confirm || confirm !== password) next.confirm = t('register.error.mismatch');
    if (!terms) next.terms = t('register.error.terms');
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
      setToken(result.token);
      // The referral code has been consumed by a real registration; leaving
      // it in storage would re-apply it to the next account created in this
      // browser.
      try {
        localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
      } catch {
        // harmless if this fails — the code just lingers unused
      }
      setStep('success');
    } catch (err) {
      setGlobalError(err instanceof ApiError ? localizeServerError(err.message) : t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[430px]">
      <div className="vx-enter rounded-[12px] border border-[#202a35] bg-ink-800 p-6 sm:p-7">
        {step === 'form' ? (
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

              <PasswordField
                id="reg-confirm"
                label={t('register.confirm')}
                value={confirm}
                onChange={(value) => {
                  setConfirm(value);
                  if (errors.confirm) setErrors(({ confirm: _drop, ...rest }) => rest);
                }}
                error={confirm.length > 0 ? errors.confirm : undefined}
              />

              {/* Optional referral. The backend accepts it as `ref` and
                  silently ignores a code that matches no user, so a typo
                  never blocks a signup — which is why nothing here claims
                  the code was accepted. */}
              {referralOpen ? (
                <div className="vx-collapse vx-open">
                  <div>
                    <Field id="reg-referral" label={t('register.referralLabel')}>
                      <input
                        id="reg-referral"
                        value={referral}
                        onChange={(e) => setReferral(e.target.value)}
                        placeholder="VLTX-XXXX"
                        autoComplete="off"
                        className={`${inputClass} border-line font-mono uppercase`}
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setReferralOpen(true)}
                  className="block text-[12px] font-medium text-home-muted transition-colors duration-150 ease-out hover:text-gold-400"
                >
                  {t('register.referralToggle')}
                </button>
              )}

              <div>
                <label htmlFor="reg-terms" className="flex cursor-pointer items-start gap-2.5">
                  <input
                    id="reg-terms"
                    type="checkbox"
                    checked={terms}
                    onChange={(e) => {
                      setTerms(e.target.checked);
                      if (errors.terms) setErrors(({ terms: _drop, ...rest }) => rest);
                    }}
                    aria-invalid={errors.terms ? true : undefined}
                    aria-describedby={errors.terms ? 'reg-terms-error' : undefined}
                    className={`mt-[2px] h-[15px] w-[15px] shrink-0 cursor-pointer appearance-none rounded-[3px] border bg-ink-850 outline-none transition-colors duration-150 ease-out checked:border-gold-500 checked:bg-gold-500 ${
                      errors.terms ? 'border-down/70' : 'border-[#2a3542]'
                    }`}
                  />
                  <span className="text-[11.5px] leading-relaxed text-home-muted">
                    {t('register.termsPrefix')}{' '}
                    <Link
                      to="/legal/terms"
                      className="text-gold-400 transition-colors duration-150 hover:text-gold-500"
                    >
                      {t('home.footer.terms')}
                    </Link>{' '}
                    {t('register.termsAnd')}{' '}
                    <Link
                      to="/legal/privacy"
                      className="text-gold-400 transition-colors duration-150 hover:text-gold-500"
                    >
                      {t('register.privacyAccusative')}
                    </Link>
                  </span>
                </label>
                {errors.terms && (
                  <p id="reg-terms-error" className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-down">
                    <AlertTriangleIcon size={12} />
                    {errors.terms}
                  </p>
                )}
              </div>

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
        ) : (
          <div className="vx-step py-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-up/35 bg-up/10 text-up">
              <CheckCircle2Icon size={20} strokeWidth={1.75} />
            </span>
            <h2 className="mt-5 text-[21px] font-semibold tracking-[-0.01em] text-white">{t('register.successTitle')}</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-home-muted">{t('register.successBody')}</p>
            {/* The session token from the registration response is already
                stored, so this is a real signed-in entry to the platform. */}
            <button
              type="button"
              onClick={() => navigate(defaultTradingPath())}
              className="mt-6 flex h-[48px] w-full items-center justify-center rounded-[7px] bg-gold-500 text-[13.5px] font-semibold text-ink-950 transition-[background-color,transform] duration-150 ease-out hover:bg-gold-400 active:translate-y-[1px] active:bg-gold-600"
            >
              {t('register.goToPlatform')}
            </button>
            <Link
              to="/settings?tab=security"
              className="mt-3 flex h-[44px] w-full items-center justify-center rounded-[7px] border border-white/12 bg-white/[0.03] text-[13px] font-medium text-white transition-[background-color,border-color] duration-150 ease-out hover:border-white/25 hover:bg-white/[0.06]"
            >
              {t('register.setUpSecurity')}
            </Link>
          </div>
        )}
      </div>

      {step === 'form' && (
        <p className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-faint">
          <ShieldIcon size={13} className="mt-[1px] shrink-0" strokeWidth={1.75} />
          {t('register.securityNote')}
        </p>
      )}
    </div>
  );
}
