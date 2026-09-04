import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setToken, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { defaultTradingPath } from '../lib/tradingMode';
import { readNext } from '../lib/returnTo';
import { Logo } from '../components/Logo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { CryptoIcon } from '../components/CryptoIcon';
import { Skeleton } from '../components/Skeleton';
import { parseChangePercent } from '../lib/priceChange';
import { CardFace, ICY_CARD_THEME } from '../components/CardFace';
import { PhoneMockup } from '../components/PhoneMockup';
import { CfdMarketsSection } from '../components/CfdMarketsSection';
import { REFERRAL_CODE_STORAGE_KEY } from './ReferralRedirectPage';
import { useCfdTickers } from '../lib/useCfdTickers';
import { CFD_ICON_BY_SYMBOL } from '../components/CfdInstrumentList';

const HERO_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT'];

type HeroTicker = Awaited<ReturnType<typeof api.getExternalTickers>>['tickers'][number];

export function AuthPage() {
  const { t, lang } = useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tickers, setTickers] = useState<HeroTicker[]>([]);
  const { tickers: cfdTickers } = useCfdTickers();
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const navigate = useNavigate();
  // Where the visitor was actually heading when the auth guard stopped them
  // (see lib/returnTo). Falls back to their usual terminal.
  const afterLogin = () => readNext(window.location.search) ?? defaultTradingPath();

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
      // This form is sign-in only; registration is its own approved screen
      // at /register, which the Регистрация tab links to.
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
    <div className="page-mesh" style={styles.page}>
      <div style={styles.langSwitch}>
        <LanguageSwitcher />
      </div>

      <div style={styles.fold}>
      <div className="bg-grid" />
      <div className="hero-glow hero-glow-cyan" />
      <div className="hero-glow hero-glow-purple" />
      <div style={{ ...styles.layout, position: 'relative' }}>
        <div className="auth-hero" style={styles.hero}>
          <Logo size="large" />
          <p style={styles.heroTagline}>{t('auth.heroTagline')}</p>

          <div style={styles.tickerList}>
            {tickers.map((tk) => {
              const change = parseChangePercent(tk.changePercent24h, tk.pair);
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

            {cfdTickers.length > 0 && (
              <>
                <div style={styles.tickerDivider}>{t('trade.cfdTab')}</div>
                {cfdTickers.slice(0, 3).map((tk) => {
                  const change = parseChangePercent(tk.changePercent24h, tk.symbol);
                  const positive = change >= 0;
                  return (
                    <div key={tk.symbol} style={styles.tickerRow}>
                      <span style={styles.tickerLeft}>
                        <span style={{ fontSize: 16 }}>{CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}</span>
                        <span className="mono" style={styles.tickerPair}>
                          {tk.symbol}
                        </span>
                      </span>
                      <span className="mono" style={styles.tickerPrice}>
                        {tk.price}
                      </span>
                      <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.tickerChange}>
                        {positive ? '+' : ''}
                        {change.toFixed(2)}%
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        <div className="auth-phone" style={styles.phoneCol}>
          <div className="hero-phone-glow" />
          <div className="hero-grid-orb" />
          <div className="hero-star hero-star-1" />
          <div className="hero-star hero-star-2" />
          <div className="hero-star hero-star-3" />
          <div className="hero-star hero-star-4" />
          <div className="hero-star hero-star-5" />
          <PhoneMockup style={{ width: 240, position: 'relative', zIndex: 1 }} />
        </div>

        <div style={{ ...styles.card, ...(mode === 'register' && !pendingToken ? styles.cardRegisterGlow : {}) }}>
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
                  onClick={() => {
                    setMode('login');
                    setConfirmPassword('');
                    setError(null);
                  }}
                  type="button"
                >
                  {t('auth.login')}
                </button>
                {/* Registration has its own approved screen (see
                    pages/register). This tab navigates there rather than
                    switching this form into a second, different-looking
                    signup UI. */}
                <Link to={`/register${window.location.search}`} style={styles.tab}>
                  {t('auth.register')}
                </Link>
              </div>

              {mode === 'register' && (
                <>
                  <p style={styles.registerSubline}>{t('auth.registerSubline')}</p>
                  <div style={styles.cardWaitlistBadge}>{t('auth.cardWaitlistBadge')}</div>
                </>
              )}

              <form onSubmit={handleSubmit} style={styles.form}>
                <FormField label={t('auth.email')}>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={styles.input}
                    autoComplete="email"
                  />
                </FormField>
                <FormField label={t('auth.password')} hint={mode === 'register' ? t('auth.minChars') : undefined}>
                  <input
                    type="password"
                    required
                    minLength={mode === 'register' ? 10 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={styles.input}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                </FormField>
                {mode === 'register' && (
                  <FormField
                    label={t('auth.confirmPassword')}
                    hint={
                      confirmPassword
                        ? confirmPassword === password
                          ? `✓ ${t('auth.passwordMatch')}`
                          : t('auth.passwordMismatch')
                        : undefined
                    }
                    hintColor={confirmPassword ? (confirmPassword === password ? 'var(--buy)' : 'var(--sell)') : undefined}
                  >
                    <input
                      type="password"
                      required
                      minLength={10}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      style={styles.input}
                      autoComplete="new-password"
                    />
                  </FormField>
                )}

                {error && <div style={styles.error}>{error}</div>}

                <button type="submit" disabled={loading} style={styles.submit}>
                  {loading ? t('auth.wait') : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
                </button>

                {/* Shown on both tabs, not just Регистрация — these are
                    general exchange advantages, not a registration-only
                    pitch (unlike registerSubline/cardWaitlistBadge above,
                    which talk about signing up specifically). */}
                <div style={styles.featureRow}>
                  <FeatureBadge icon={<PercentIcon />} label={t('auth.feature.noFee')} />
                  <FeatureBadge icon={<ShieldIcon />} label={t('auth.feature.twoFa')} />
                  <FeatureBadge icon={<CardChipIcon />} label={t('auth.feature.card')} />
                  <FeatureBadge icon={<span style={{ fontSize: 15, lineHeight: 1 }}>🇸🇬</span>} label={t('auth.feature.jurisdiction')} />
                </div>
              </form>
            </>
          )}
        </div>
      </div>
      </div>

      <PerksSection t={t} />

      <CfdMarketsSection />

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

/** Big card banner + a grid of exchange-wide advantages, below the login
 * fold — the small feature badges near the submit button are a compact
 * reminder; this is the actual pitch, same idea as a real exchange's
 * marketing homepage (card hero image + benefits grid). */
function PerksSection({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <div style={styles.perksSection}>
      <div className="auth-perks-banner" style={styles.perksBanner}>
        <div className="card-tilt-wrap-photo" style={{ ...styles.perksBannerCard, transform: 'translate(-18px, -20px)' }}>
          <CardFace theme={ICY_CARD_THEME} imageSrc="/cards/voltex-card-dark.png" imageWidth={440} last4="4417" holderName="YOUR NAME HERE" network="mastercard" />
        </div>
        <div style={styles.perksBannerText}>
          <span style={styles.perksBannerKicker}>{t('auth.perks.cardKicker')}</span>
          <h2 style={styles.perksBannerTitle}>{t('auth.perks.cardTitle')}</h2>
          <p style={styles.perksBannerLead}>{t('auth.perks.cardText')}</p>
        </div>
      </div>

      <div style={styles.perksGrid}>
        <PerkCard icon={<PercentIcon />} title={t('auth.perks.fee.title')} text={t('auth.perks.fee.text')} />
        <PerkCard icon={<AssetsIcon />} title={t('auth.perks.assets.title')} text={t('auth.perks.assets.text')} />
      </div>
    </div>
  );
}

function PerkCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="card-hover" style={styles.perkCard}>
      <div style={styles.perkIconBadge}>{icon}</div>
      <h3 style={styles.perkTitle}>{title}</h3>
      <p style={styles.perkText}>{text}</p>
    </div>
  );
}

/** Label + input wrapper with a small "alive" focus micro-interaction —
 * the label lifts in color to the accent while its field is focused,
 * instead of the field being the only thing that visibly reacts. */
function FormField({
  label,
  hint,
  hintColor,
  children,
}: {
  label: string;
  hint?: string;
  hintColor?: string;
  children: React.ReactElement;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label
      style={{
        ...styles.label,
        color: focused ? 'var(--accent)' : 'var(--text-secondary)',
        transition: 'color 0.15s ease',
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {label}
      {children}
      {hint && <span style={{ ...styles.hint, color: hintColor ?? 'var(--text-tertiary)' }}>{hint}</span>}
    </label>
  );
}

function FeatureBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={styles.featureBadge}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'var(--accent)',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PercentIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function CardChipIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}
function AssetsIcon() {
  return (
    <svg {...ICON_PROPS} width={20} height={20}>
      <circle cx="9" cy="9" r="6" />
      <circle cx="15" cy="15" r="6" opacity={0.5} />
    </svg>
  );
}

// v0-designed palette (see the "VOLTEX" v0 export the owner supplied),
// scoped to this page the same way FuturesPage/WalletPage/etc re-theme
// themselves — every existing var(--panel)/var(--border)/var(--text-*)
// rule below (and in the shared ticker/card UI) picks this up
// automatically.
const AUTH_V0_VARS = {
  ['--bg' as any]: '#080b12',
  ['--panel' as any]: '#121925',
  ['--panel-alt' as any]: '#0e131d',
  ['--panel-alt-hover' as any]: '#172131',
  ['--border' as any]: '#1c2735',
  ['--text-primary' as any]: '#f5f7fa',
  ['--text-secondary' as any]: '#8b96a8',
  ['--text-tertiary' as any]: '#6b7789',
  ['--buy' as any]: '#19d98b',
  ['--buy-dim' as any]: 'rgba(25,217,139,0.14)',
  ['--sell' as any]: '#ff4d67',
  ['--sell-dim' as any]: 'rgba(255,77,103,0.14)',
  ['--accent' as any]: '#18c8ff',
  ['--accent-hover' as any]: '#3fd4ff',
  ['--accent-dim' as any]: 'rgba(24,200,255,0.14)',
  ['--on-accent' as any]: '#04121b',
} as React.CSSProperties;

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: '32px 20px 40px',
    ...AUTH_V0_VARS,
  },
  fold: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 0 64px',
  },
  langSwitch: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 2,
  },
  legalRow: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 40,
  },
  legalLink: { fontSize: 11, color: 'var(--text-tertiary)' },
  legalDot: { fontSize: 11, color: 'var(--text-tertiary)' },
  layout: {
    display: 'flex',
    alignItems: 'center',
    gap: 48,
    maxWidth: 1200,
    width: '100%',
    justifyContent: 'center',
  },
  hero: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    minWidth: 0,
  },
  phoneCol: {
    flexShrink: 0,
    position: 'relative',
    width: 380,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
  tickerDivider: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.08em',
    color: 'var(--text-tertiary)',
    padding: '6px 4px 2px',
  },
  card: {
    width: 380,
    flexShrink: 0,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: 32,
    boxShadow: '0 24px 70px rgba(0,0,0,0.4)',
    transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
  },
  cardRegisterGlow: {
    borderColor: 'rgba(24,200,255,0.4)',
    boxShadow: '0 24px 70px rgba(0,0,0,0.4), 0 0 0 1px rgba(24,200,255,0.15), 0 0 40px rgba(24,200,255,0.12)',
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
  registerSubline: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    margin: '-14px 0 16px',
  },
  cardWaitlistBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'linear-gradient(90deg, var(--accent-dim), rgba(0,214,143,0.12))',
    border: '1px solid var(--accent)',
    borderRadius: 10,
    padding: '9px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    marginBottom: 20,
  },
  featureRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 4,
  },
  featureBadge: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    padding: '10px 4px',
    background: 'var(--panel-alt)',
    borderRadius: 10,
    fontSize: 9.5,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textAlign: 'center',
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
    borderRadius: 10,
    padding: '12px 0',
    fontWeight: 800,
    fontSize: 14,
    marginTop: 8,
  },
  perksSection: {
    maxWidth: 1080,
    margin: '0 auto',
    paddingTop: 24,
  },
  perksBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 56,
    flexWrap: 'wrap',
    background: 'linear-gradient(135deg, var(--panel) 0%, var(--panel-alt) 100%)',
    border: '1px solid var(--border)',
    borderRadius: 24,
    padding: '48px 56px',
    marginBottom: 40,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
  perksBannerCard: { flexShrink: 0, margin: '0 auto' },
  perksBannerText: { flex: '1 1 320px', minWidth: 280 },
  perksBannerKicker: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--accent)',
    marginBottom: 10,
  },
  perksBannerTitle: {
    fontSize: 26,
    margin: '0 0 12px',
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
  },
  perksBannerLead: { fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.65, maxWidth: 460, margin: 0 },
  perksGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
  },
  perkCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 24,
  },
  perkIconBadge: {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: 'var(--accent-dim)',
    marginBottom: 14,
  },
  perkTitle: {
    fontSize: 15,
    margin: '0 0 6px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
  },
  perkText: { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
};
