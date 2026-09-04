import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRightIcon, Loader2Icon } from 'lucide-react';
import { api, setToken, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { defaultTradingPath } from '../lib/tradingMode';
import { readNext } from '../lib/returnTo';
import { openSupportWidget } from '../lib/supportWidget';
import { AuthLayout } from './auth/AuthLayout';
import { useAuthCopy } from './auth/copy';
import { Field, inputClass } from './register/Field';
import { PasswordField } from './register/PasswordField';

export function AuthPage() {
  const { t } = useLanguage();
  const copy = useAuthCopy();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const navigate = useNavigate();
  const afterLogin = () => readNext(window.location.search) ?? defaultTradingPath();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.login(email, password);
      if ('requires2fa' in result) {
        setPendingToken(result.pendingToken);
      } else {
        setToken(result.token);
        navigate(afterLogin());
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }

  async function handleTwoFaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError(null);
    setLoading(true);
    try {
      const { token } = await api.loginWith2FA(pendingToken, twoFaCode);
      setToken(token);
      navigate(afterLogin());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }


  return (
    <AuthLayout mode="login">
      {pendingToken ? <>
        {/* Existing account-enabled 2FA remains required. It is never a signup step. */}
        <h1 id="auth-form-title">{t('auth.twoFaTitle')}</h1>
        <p className="vx-auth-subtitle">{t('auth.twoFaHint')}</p>
        <form onSubmit={handleTwoFaSubmit} className="vx-auth-form" aria-busy={loading}>
          <Field id="login-2fa" label={t('auth.twoFaCode')}>
            <input id="login-2fa" className={inputClass} required autoFocus inputMode="text" autoComplete="one-time-code" value={twoFaCode} onChange={e => setTwoFaCode(e.target.value)} placeholder="123456" />
          </Field>
          {error && <div role="alert" className="vx-auth-error vx-auth-alert">{error}</div>}
          <button type="submit" disabled={loading} className="vx-auth-submit">{loading ? t('auth.wait') : t('auth.confirm')}</button>
          <button type="button" className="vx-auth-text-button" onClick={() => { setPendingToken(null); setTwoFaCode(''); setError(null); }}>{t('auth.backToLogin')}</button>
        </form>
      </> : <>
        <h1 id="auth-form-title">{copy.loginTitle}</h1>
        <p className="vx-auth-subtitle">{copy.loginSubtitle}</p>
        <form onSubmit={handleSubmit} className="vx-auth-form" aria-busy={loading}>
          <Field id="login-email" label={t('auth.email')}>
            <input id="login-email" className={inputClass} type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
          </Field>
          <PasswordField id="login-password" label={t('auth.password')} value={password} onChange={setPassword} autoComplete="current-password" />
          <button type="button" className="vx-auth-text-button vx-auth-forgot" onClick={openSupportWidget}>{copy.forgot}</button>
          {error && <div role="alert" className="vx-auth-error vx-auth-alert">{error}</div>}
          <button type="submit" disabled={loading} className="vx-auth-submit">
            {loading && <Loader2Icon size={18} className="animate-spin" />}{loading ? t('auth.wait') : t('auth.signIn')}
            {!loading && <ArrowRightIcon size={21} strokeWidth={1.7} />}
          </button>
        </form>
        <p className="vx-auth-create-link">{copy.noAccount} <Link to={'/register' + window.location.search}>{t('register.title')}</Link></p>
      </>}
    </AuthLayout>
  );
}
