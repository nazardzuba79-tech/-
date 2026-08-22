import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Logo } from '../components/Logo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function AuthPage() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = mode === 'login' ? await api.login(email, password) : await api.register(email, password);
      setToken(token);
      navigate('/trade');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.langSwitch}>
        <LanguageSwitcher />
      </div>

      <div style={styles.card}>
        <div style={styles.logo}>
          <Logo size="large" />
        </div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => setMode('login')}
            type="button"
          >
            {t('auth.login')}
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}
            onClick={() => setMode('register')}
            type="button"
          >
            {t('auth.register')}
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            {t('auth.email')}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              autoComplete="email"
            />
          </label>
          <label style={styles.label}>
            {t('auth.password')}
            <input
              type="password"
              required
              minLength={mode === 'register' ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && <span style={styles.hint}>{t('auth.minChars')}</span>}
          </label>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading} style={styles.submit}>
            {loading ? t('auth.wait') : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    background:
      'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(247,166,0,0.08), transparent), var(--bg)',
  },
  langSwitch: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
  card: {
    width: 360,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 32,
  },
  logo: {
    fontFamily: 'var(--font-mono)',
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: '0.05em',
    marginBottom: 28,
  },
  tabs: {
    display: 'flex',
    gap: 4,
    marginBottom: 24,
    background: 'var(--panel-alt)',
    borderRadius: 6,
    padding: 3,
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 600,
  },
  tabActive: {
    background: 'var(--panel)',
    color: 'var(--text-primary)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 14,
  },
  hint: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  error: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 12,
  },
  submit: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 24,
    padding: '12px 0',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
    marginTop: 8,
  },
};
