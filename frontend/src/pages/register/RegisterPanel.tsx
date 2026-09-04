import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangleIcon, ArrowLeftIcon, CheckCircle2Icon, Loader2Icon, ShieldIcon } from 'lucide-react';
import { api, ApiError, RegistrationChallenge, setToken } from '../../lib/api';
import { defaultTradingPath } from '../../lib/tradingMode';
import { readNext } from '../../lib/returnTo';
import { useLanguage } from '../../lib/i18n';
import { REFERRAL_CODE_STORAGE_KEY } from '../ReferralRedirectPage';
import { Field, inputClass } from './Field';
import { PasswordField } from './PasswordField';
import { OtpInput } from './OtpInput';

/**
 * The registration form, wired to the exchange's real auth.
 *
 *   form -> submitting -> verify -> verifying -> success
 *
 * Every transition is driven by a real server response:
 *
 *   POST /auth/register          creates the account and emails a six-digit
 *                                code. It returns NO session token — only a
 *                                challenge id and the masked address.
 *   POST /auth/verify-email      checks the code server-side and, only if it
 *                                is right, returns the real session token.
 *   POST /auth/resend-verification
 *                                invalidates the old code, sends a new one,
 *                                and hands back the replacement challenge.
 *
 * Nothing here declares success on a timer, and no token is stored before
 * verify-email answers. The resend countdown counts down a cooldown the
 * SERVER told us about (resendAvailableInSeconds); it does not invent one,
 * and the button it re-enables still has to survive the server's own
 * cooldown check.
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
    if (message.startsWith('Too many verification')) return t('register.error.tooManyAttempts');
    return message;
  };
}

/** Only used if the server ever answers a cooldown without a retry-after;
 *  the policy value, not an invented one. */
const RESEND_FALLBACK_SECONDS = 60;

/**
 * /auth/verify-email and /auth/resend-verification answer with a structured
 * `code` beside the message. Branching on that is stable; branching on the
 * English message text is not. Anything unrecognised falls through to the
 * server's own message rather than being papered over.
 */
function useVerificationErrorText() {
  const { t } = useLanguage();
  return (err: ApiError): string => {
    switch (err.body.code) {
      case 'INVALID_CODE': {
        const left = Number(err.body.attemptsRemaining);
        return Number.isFinite(left) && left > 0
          ? t('register.otpInvalidWithAttempts').replace('{n}', String(left))
          : t('register.otpInvalid');
      }
      case 'CHALLENGE_EXPIRED':
        return t('register.otpExpired');
      case 'TOO_MANY_ATTEMPTS':
        return t('register.otpTooManyAttempts');
      case 'CHALLENGE_CONSUMED':
      case 'ALREADY_VERIFIED':
        return t('register.otpAlreadyUsed');
      case 'CHALLENGE_NOT_FOUND':
        return t('register.otpChallengeGone');
      case 'MAIL_UNAVAILABLE':
        return t('register.mailUnavailable');
      case undefined:
        // Rate-limit replies carry no `code`, only the limiter's message.
        return err.message.startsWith('Too many') ? t('register.error.tooManyAttempts') : err.message;
      default:
        return err.message;
    }
  };
}

export function RegisterPanel() {
  const { t } = useLanguage();
  const localizeServerError = useServerErrorLocalizer();
  const verificationErrorText = useVerificationErrorText();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<'form' | 'verify' | 'success'>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [referralOpen, setReferralOpen] = useState(false);
  const [referral, setReferral] = useState('');
  const [terms, setTerms] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading] = useState(false);

  // --- verification step ---
  const [challenge, setChallenge] = useState<RegistrationChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const otpFirstCellRef = useRef<HTMLInputElement | null>(null);

  // Arriving from /login after signing in with an unverified account: the
  // server already re-issued and re-sent a code, and AuthPage forwarded the
  // challenge here, so open straight on the verification step rather than
  // asking the user to register again.
  useEffect(() => {
    const forwarded = (location.state as { verification?: RegistrationChallenge } | null)?.verification;
    if (forwarded?.challengeId) {
      enterVerification(forwarded);
      if (forwarded.emailDelivered === false) setNotice(t('register.mailUnavailable'));
      // Drop the state so a refresh or a Back/Forward step does not replay
      // a challenge that may since have been consumed.
      navigate(location.pathname, { replace: true, state: null });
    }
    // enterVerification is stable; this runs for one incoming navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Ticks the resend cooldown the server handed us down to zero. Purely a
  // display of a server-side rule: when it reaches zero the button re-enables,
  // and the server still re-checks its own cooldown on the request.
  useEffect(() => {
    if (step !== 'verify' || cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [step, cooldown]);

  const enterVerification = useCallback((next: RegistrationChallenge) => {
    setChallenge(next);
    setOtp('');
    setOtpError('');
    setCooldown(next.resendAvailableInSeconds);
    setStep('verify');
  }, []);

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
      enterVerification(result);
      // The account exists either way; what differs is whether a code is
      // actually on its way. Saying so is the difference between "check your
      // inbox" and leaving someone waiting for mail that never left.
      setNotice(result.emailDelivered ? '' : t('register.mailUnavailable'));
    } catch (err) {
      setGlobalError(err instanceof ApiError ? localizeServerError(err.message) : t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e?: FormEvent, submittedCode?: string) {
    e?.preventDefault();
    const code = (submittedCode ?? otp).replace(/\D/g, '');
    if (!challenge) return;
    if (code.length !== 6) {
      setOtpError(t('register.otpIncomplete'));
      return;
    }

    setOtpError('');
    setNotice('');
    setLoading(true);
    try {
      const { token } = await api.verifyEmail(challenge.challengeId, code);
      // First and only point at which this browser holds a session.
      setToken(token);
      setStep('success');
    } catch (err) {
      setOtpError(err instanceof ApiError ? verificationErrorText(err) : t('auth.genericError'));
      // Clear the cells so the next attempt is a fresh six digits rather than
      // an edit of the rejected code — retyping over a full field is exactly
      // where people end up submitting a half-corrected number.
      setOtp('');
      otpFirstCellRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!challenge || cooldown > 0 || loading) return;
    setOtpError('');
    setNotice('');
    setLoading(true);
    try {
      const next = await api.resendVerification(challenge.challengeId);
      // The old code is dead server-side; adopt the replacement challenge so
      // the next verify goes against the code that was actually sent.
      setChallenge({ ...next, verificationRequired: true, emailDelivered: true });
      setOtp('');
      setCooldown(next.resendAvailableInSeconds);
      setNotice(t('register.codeSent'));
    } catch (err) {
      if (err instanceof ApiError && err.body.code === 'COOLDOWN') {
        setCooldown(Number(err.body.retryAfterSeconds) || RESEND_FALLBACK_SECONDS);
        setOtpError(t('register.resendCooldownError'));
      } else {
        setOtpError(err instanceof ApiError ? verificationErrorText(err) : t('auth.genericError'));
      }
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
        ) : step === 'verify' ? (
          <div className="vx-step">
            <button
              type="button"
              onClick={() => {
                setStep('form');
                setOtpError('');
                setNotice('');
              }}
              className="mb-4 inline-flex items-center gap-1.5 text-[12px] text-home-muted transition-colors duration-150 ease-out hover:text-white"
            >
              <ArrowLeftIcon size={13} />
              {t('register.back')}
            </button>
            <h2 className="text-[21px] font-semibold tracking-[-0.01em] text-white">{t('register.verifyTitle')}</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-home-muted">
              {t('register.verifyBody')}
              {/* The address is shown masked so the user can confirm they
                  typed what they meant, without printing it in full on a
                  screen someone may be looking over. */}
              <span className="mt-0.5 block font-mono text-[13px] text-white">{challenge?.maskedEmail}</span>
            </p>

            <form onSubmit={handleVerify} className="mt-6">
              <span id="reg-otp-label" className="mb-2 block text-[11.5px] font-medium text-home-muted">
                {t('register.otpLabel')}
              </span>
              <OtpInput
                firstCellRef={otpFirstCellRef}
                value={otp}
                onChange={(next) => {
                  setOtp(next);
                  if (otpError) setOtpError('');
                }}
                onComplete={(code) => handleVerify(undefined, code)}
                invalid={Boolean(otpError)}
                disabled={loading}
              />
              {otpError && (
                <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-down" role="alert">
                  <AlertTriangleIcon size={12} className="shrink-0" />
                  {otpError}
                </p>
              )}
              {notice && !otpError && (
                <p className="mt-2 text-[11.5px] text-up" role="status">
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || otp.replace(/\D/g, '').length !== 6}
                className="mt-5 flex h-[48px] w-full items-center justify-center gap-2 rounded-[7px] bg-gold-500 text-[13.5px] font-semibold text-ink-950 transition-[background-color,transform] duration-150 ease-out hover:bg-gold-400 active:translate-y-[1px] active:bg-gold-600 disabled:cursor-not-allowed disabled:bg-ink-760 disabled:text-white/35"
              >
                {loading && <Loader2Icon size={15} className="animate-spin" />}
                {loading ? t('register.verifying') : t('register.verifySubmit')}
              </button>

              <div className="mt-4 text-center">
                {cooldown > 0 ? (
                  <span className="text-[11.5px] text-faint">
                    {t('register.resendIn').replace('{n}', String(cooldown))}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={loading}
                    className="text-[11.5px] font-medium text-gold-400 transition-colors duration-150 ease-out hover:text-gold-500 disabled:cursor-not-allowed disabled:text-faint"
                  >
                    {t('register.resend')}
                  </button>
                )}
              </div>
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
              onClick={() => navigate(readNext(window.location.search) ?? defaultTradingPath())}
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
