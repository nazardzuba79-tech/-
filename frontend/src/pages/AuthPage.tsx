import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, ApiError } from '../lib/api';

export function AuthPage() {
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
      setError(err instanceof ApiError ? err.message : 'Щось пішло не так. Спробуй ще раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          EXCHANGE<span style={{ color: 'var(--accent)' }}>.</span>
        </div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => setMode('login')}
            type="button"
          >
            Вхід
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}
            onClick={() => setMode('register')}
            type="button"
          >
            Реєстрація
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Email
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
            Пароль
            <input
              type="password"
              required
              minLength={mode === 'register' ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && <span style={styles.hint}>Мінімум 10 символів</span>}
          </label>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading} style={styles.submit}>
            {loading ? 'Зачекай...' : mode === 'login' ? 'Увійти' : 'Створити акаунт'}
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
    background:
      'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(247,166,0,0.08), transparent), var(--bg)',
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
    borderRadius: 4,
    padding: '11px 0',
    fontWeight: 700,
    fontSize: 14,
    marginTop: 8,
  },
};
