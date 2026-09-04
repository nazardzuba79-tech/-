import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertTriangleIcon, ArrowRightIcon, Loader2Icon, LockKeyholeIcon } from 'lucide-react';
import { api, setToken, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { defaultTradingPath } from '../lib/tradingMode';
import { readNext } from '../lib/returnTo';
import { openSupportWidget } from '../lib/supportWidget';
import { AuthShell } from './auth-shell/AuthShell';
import { AuthField, AuthPasswordField } from './auth-shell/AuthFields';

/**
 * /login — sign-in only, on the same split screen /register uses.
 *
 * Registration is its own approved route; the header's "Создать аккаунт"
 * link goes there rather than switching this form into a second, different
 * signup UI.
 *
 * Two real server calls and nothing else: POST /auth/login, and — when the
 * account has 2FA enabled and the first call answers `requires2fa` — POST
 * with the pending token and the code. Every message this form shows about
 * a submit is the server's own.
 */
export function AuthPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const navigate = useNavigate();
  // Where the visitor was actually heading when the auth guard stopped them
  // (see lib/returnTo). Falls back to their usual terminal.
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
    <AuthShell
      switchPrompt={t('auth.noAccount')}
      switchLabel={t('auth.createAccount')}
      switchTo={`/register${window.location.search}`}
    >
      <div className="vx-auth-body vx-auth-enter">
        {pendingToken ? (
          <>
            <div className="vx-auth-overline">{t('authShell.overline.twoFa')}</div>
            <h1>{t('auth.twoFaTitle')}</h1>
            <p className="vx-auth-sub">{t('auth.twoFaHint')}</p>

            <form onSubmit={handleTwoFaSubmit} className="vx-auth-form">
              <AuthField id="login-2fa" label={t('auth.twoFaCode')}>
                <input
                  id="login-2fa"
                  type="text"
                  required
                  autoFocus
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value)}
                  placeholder="123456"
                  className="vx-auth-input"
                />
              </AuthField>

              {error && (
                <div role="alert" className="vx-auth-alert">
                  <AlertTriangleIcon size={14} />
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="vx-auth-submit">
                {loading ? <Loader2Icon size={16} className="vx-auth-spin" /> : null}
                {loading ? t('auth.wait') : t('auth.confirm')}
              </button>
            </form>

            <p className="vx-auth-alt">
              <button
                type="button"
                onClick={() => {
                  setPendingToken(null);
                  setTwoFaCode('');
                  setError(null);
                }}
                className="vx-auth-forgot"
              >
                {t('auth.backToLogin')}
              </button>
            </p>
          </>
        ) : (
          <>
            <div className="vx-auth-overline">{t('authShell.overline.login')}</div>
            <h1>{t('auth.loginTitle')}</h1>
            <p className="vx-auth-sub">{t('auth.loginSubtitle')}</p>

            <form onSubmit={handleSubmit} className="vx-auth-form">
              <AuthField id="login-email" label={t('auth.email')}>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="name@example.com"
                  className="vx-auth-input"
                />
              </AuthField>

              <AuthPasswordField
                id="login-password"
                label={t('auth.password')}
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
                aside={
                  // There is no self-service reset endpoint, so this opens
                  // the real support chat (mounted globally, and usable
                  // signed-out) rather than linking to a page that would
                  // have to be invented.
                  <button type="button" onClick={openSupportWidget} className="vx-auth-forgot">
                    {t('auth.forgotPassword')}
                  </button>
                }
              />

              {error && (
                <div role="alert" className="vx-auth-alert">
                  <AlertTriangleIcon size={14} />
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="vx-auth-submit">
                {loading ? <Loader2Icon size={16} className="vx-auth-spin" /> : null}
                {loading ? t('auth.wait') : t('auth.signIn')}
                {!loading && <ArrowRightIcon size={16} />}
              </button>
            </form>

            <p className="vx-auth-alt">
              {t('auth.noAccount')} <Link to={`/register${window.location.search}`}>{t('auth.createAccount')}</Link>
            </p>
          </>
        )}

        <p className="vx-auth-security">
          <LockKeyholeIcon size={14} strokeWidth={1.8} />
          {t('register.securityNote')}
        </p>
      </div>
    </AuthShell>
  );
}
