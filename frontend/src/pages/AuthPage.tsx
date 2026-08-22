import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setToken, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Logo } from '../components/Logo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { CryptoIcon } from '../components/CryptoIcon';
import { Skeleton } from '../components/Skeleton';

const HERO_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT'];

type HeroTicker = Awaited<ReturnType<typeof api.getExternalTickers>>['tickers'][number];

export function AuthPage() {
  const { t, lang } = useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tickers, setTickers] = useState<HeroTicker[]>([]);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const navigate = useNavigate();

  // Live public prices behind the login card — no auth needed for this,
  // and it's what makes the login screen feel like a real, active market
  // instead of a static form on a plain background.
  useEffect(() => {
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          const byPair = new Map(res.tickers.map((tk) => [tk.pair, tk]));
          setTickers(HERO_PAIRS.map((p) => byPair.get(p)).filter((tk): tk is HeroTicker => !!tk));
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = mode === 'login' ? await api.login(email, password) : await api.register(email, password);
      if ('requires2fa' in result) {
        setPendingToken(result.pendingToken);
      } else {
        setToken(result.token);
        navigate('/trade');
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
      navigate('/trade');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-mesh" style={styles.page}>
      <div style={styles.langSwitch}>
        <LanguageSwitcher />
      </div>

      <div style={styles.layout}>
        <div className="auth-hero" style={styles.hero}>
          <Logo size="large" />
          <p style={styles.heroTagline}>{t('auth.heroTagline')}</p>

          <div style={styles.tickerList}>
            {tickers.map((tk) => {
              const change = parseFloat(tk.changePercent24h) * 100;
              const positive = change >= 0;
              return (
                <div key={tk.pair} style={styles.tickerRow}>
                  <span style={styles.tickerLeft}>
                    <CryptoIcon symbol={tk.pair.split('/')[0]} size={22} />
                    <span className="mono" style={styles.tickerPair}>
                      {tk.pair}
                    </span>
                  </span>
                  <span className="mono" style={styles.tickerPrice}>
                    {parseFloat(tk.lastPrice).toLocaleString(localeOf(lang), { maximumFractionDigits: 2 })}
                  </span>
                  <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.tickerChange}>
                    {positive ? '+' : ''}
                    {change.toFixed(2)}%
                  </span>
                </div>
              );
            })}
            {tickers.length === 0 &&
              HERO_PAIRS.map((p) => (
                <div key={p} style={styles.tickerRow}>
                  <span style={styles.tickerLeft}>
                    <Skeleton width={22} height={22} radius={999} />
                    <Skeleton width={70} height={13} />
                  </span>
                  <Skeleton width={60} height={13} />
                  <Skeleton width={50} height={13} />
                </div>
              ))}
          </div>
        </div>

        <div style={styles.card}>
          {pendingToken ? (
            <>
              <div style={styles.twoFaTitle}>{t('auth.twoFaTitle')}</div>
              <p style={styles.twoFaHint}>{t('auth.twoFaHint')}</p>
              <form onSubmit={handleTwoFaSubmit} style={styles.form}>
                <label style={styles.label}>
                  {t('auth.twoFaCode')}
                  <input
                    type="text"
                    required
                    autoFocus
                    inputMode="text"
                    autoComplete="one-time-code"
                    value={twoFaCode}
                    onChange={(e) => setTwoFaCode(e.target.value)}
                    style={{ ...styles.input, ...styles.twoFaInput }}
                    placeholder="123456"
                  />
                </label>

                {error && <div style={styles.error}>{error}</div>}

                <button type="submit" disabled={loading} style={styles.submit}>
                  {loading ? t('auth.wait') : t('auth.confirm')}
                </button>
                <button
                  type="button"
                  style={styles.backLink}
                  onClick={() => {
                    setPendingToken(null);
                    setTwoFaCode('');
                    setError(null);
                  }}
                >
                  {t('auth.backToLogin')}
                </button>
              </form>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      <div style={styles.legalRow}>
        <Link to="/legal/terms" style={styles.legalLink}>
          {t('footer.terms')}
        </Link>
        <span style={styles.legalDot}>·</span>
        <Link to="/legal/privacy" style={styles.legalLink}>
          {t('footer.privacy')}
        </Link>
        <span style={styles.legalDot}>·</span>
        <Link to="/legal/risk" style={styles.legalLink}>
          {t('footer.risk')}
        </Link>
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
    padding: '32px 20px',
  },
  langSwitch: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 2,
  },
  legalRow: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  legalLink: { fontSize: 11, color: 'var(--text-tertiary)' },
  legalDot: { fontSize: 11, color: 'var(--text-tertiary)' },
  layout: {
    display: 'flex',
    alignItems: 'center',
    gap: 72,
    maxWidth: 940,
    width: '100%',
  },
  hero: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    minWidth: 0,
  },
  heroTagline: {
    fontFamily: 'var(--font-display)',
    fontSize: 26,
    fontWeight: 800,
    lineHeight: 1.25,
    letterSpacing: '-0.01em',
    margin: '4px 0 8px',
    maxWidth: 420,
    background: 'linear-gradient(120deg, var(--text-primary) 40%, var(--accent) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  tickerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 8,
    maxWidth: 420,
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  },
  tickerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderRadius: 8,
  },
  tickerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  tickerPair: { fontSize: 13, fontWeight: 700 },
  tickerPrice: { fontSize: 13, color: 'var(--text-secondary)', flex: 1, textAlign: 'right', paddingRight: 16 },
  tickerChange: { fontSize: 13, fontWeight: 700, width: 70, textAlign: 'right' },
  card: {
    width: 380,
    flexShrink: 0,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: 32,
    boxShadow: '0 24px 70px rgba(0,0,0,0.4)',
  },
  tabs: {
    display: 'flex',
    gap: 4,
    marginBottom: 24,
    background: 'var(--panel-alt)',
    borderRadius: 8,
    padding: 3,
  },
  tab: {
    flex: 1,
    padding: '9px 0',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 700,
  },
  tabActive: {
    background: 'var(--panel)',
    color: 'var(--text-primary)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  },
  twoFaTitle: { fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, marginBottom: 8 },
  twoFaHint: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 },
  twoFaInput: { fontFamily: 'var(--font-mono)', fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' },
  backLink: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 12,
    padding: '4px 0',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '11px 12px',
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
    borderRadius: 8,
    fontSize: 12,
  },
  submit: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 24,
    padding: '12px 0',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
    marginTop: 8,
  },
};
