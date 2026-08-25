import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Logo } from '../components/Logo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { CryptoIcon } from '../components/CryptoIcon';
import { Sparkline } from '../components/Sparkline';
import { Footer } from '../components/Footer';
import { parseChangePercent } from '../lib/priceChange';

const NAV_LINKS = [
  { to: '/markets', key: 'nav.markets' as const },
  { to: '/trade', key: 'nav.trade' as const },
  { to: '/futures', key: 'nav.futures' as const },
  { to: '/copy-trading', key: 'nav.copyTrading' as const },
  { to: '/dashboard', key: 'nav.dashboard' as const },
];

const HERO_COINS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const OVERVIEW_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'TRX/USDT', 'DOGE/USDT'];
const TICKER_STRIP_PAIRS = [...OVERVIEW_PAIRS];

type Ticker = Awaited<ReturnType<typeof api.getExternalTickers>>['tickers'][number];

/** Public marketing landing — the v0-designed "VOLTEX" homepage the owner
 * supplied, ported faithfully (hero + phone-mockup preview + live market
 * strip). Unlike the trading/wallet pages there's no existing functionality
 * here to preserve — before this, "/" went straight into the login form —
 * so this one is a real 1:1 structural port, not a palette-only reskin.
 * Real ticker data throughout; the phone mockup's wallet numbers are a
 * generic illustrative UI preview (not tied to any account), same as v0's
 * own mockup. CTAs route to /login (our real auth flow — v0's own export
 * has no login form, its buttons just deep-link straight into the app). */
export function MarketingPage() {
  const { t, lang } = useLanguage();
  const [tickers, setTickers] = useState<Map<string, Ticker>>(new Map());
  const [history, setHistory] = useState<Map<string, number[]>>(new Map());
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          const map = new Map<string, Ticker>();
          for (const tk of res.tickers) map.set(tk.pair, tk);
          setTickers(map);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  // Lightweight in-browser price trail for the sparklines — no dedicated
  // history endpoint for this; sampling the live ticker every few seconds
  // is enough to draw a real (if short) recent trend instead of a static line.
  useEffect(() => {
    const interval = setInterval(() => {
      setHistory((prev) => {
        const next = new Map(prev);
        for (const pair of OVERVIEW_PAIRS) {
          const tk = tickers.get(pair);
          if (!tk) continue;
          const points = next.get(pair) ?? [];
          next.set(pair, [...points, parseFloat(tk.lastPrice)].slice(-20));
        }
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [tickers]);

  const fmt = (n: number) => n.toLocaleString(localeOf(lang), { maximumFractionDigits: n < 1 ? 6 : 2 });
  const fmtCompact = (n: number) => n.toLocaleString(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 });

  return (
    <div style={{ ...styles.page, ...MARKETING_V0_VARS }}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.headerLeft}>
            <Logo />
            <nav className="marketing-nav-desktop" style={styles.navDesktop}>
              {NAV_LINKS.map((l) => (
                <Link key={l.to} to={l.to} style={styles.navLink}>
                  {t(l.key)}
                </Link>
              ))}
            </nav>
          </div>
          <div className="marketing-nav-desktop" style={styles.headerRight}>
            <LanguageSwitcher />
            <Link to="/login" style={styles.loginLink}>
              {t('auth.login')}
            </Link>
            <Link to="/login" style={styles.startBtn}>
              {t('marketing.startTrading')}
            </Link>
          </div>
          <button className="marketing-burger" style={styles.burgerBtn} onClick={() => setMobileOpen((v) => !v)} aria-label="menu">
            <BurgerIcon open={mobileOpen} />
          </button>
        </div>
        <div className={`marketing-mobile-menu${mobileOpen ? ' open' : ''}`} style={styles.mobileMenu}>
          {NAV_LINKS.map((l) => (
            <Link key={l.to} to={l.to} style={styles.mobileLink} onClick={() => setMobileOpen(false)}>
              {t(l.key)}
            </Link>
          ))}
          <div style={styles.mobileCtaRow}>
            <Link to="/login" style={{ ...styles.loginLink, ...styles.mobileLoginBtn }} onClick={() => setMobileOpen(false)}>
              {t('auth.login')}
            </Link>
            <Link to="/login" style={{ ...styles.startBtn, flex: 1, textAlign: 'center' }} onClick={() => setMobileOpen(false)}>
              {t('marketing.startTrading')}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section style={styles.hero}>
          <div className="marketing-hero-grid" style={styles.heroGrid}>
            <div style={styles.heroLeft}>
              <span style={styles.eyebrow}>
                <span style={styles.eyebrowDot} />
                {t('marketing.eyebrow')}
              </span>
              <h1 style={styles.heroTitle}>{t('auth.heroTagline')}</h1>
              <p style={styles.heroSub}>{t('auth.privacyNote')}</p>
              <div style={styles.heroCtaRow}>
                <Link to="/login" style={styles.heroPrimaryBtn}>
                  {t('marketing.startTrading')} <ArrowIcon />
                </Link>
                <a href="#markets" style={styles.heroSecondaryBtn}>
                  {t('marketing.exploreMarkets')}
                </a>
              </div>
              <div style={styles.featureRow}>
                <FeatureStat label={t('auth.perks.fee.title')} />
                <FeatureStat label={t('dashboard.quickLinkFuturesDesc')} />
                <FeatureStat label={t('auth.perks.assets.title')} />
              </div>
            </div>

            <div style={styles.heroRight}>
              <HeroPreviewPanel tickers={tickers} fmt={fmt} />
            </div>
          </div>
        </section>

        <section id="markets" style={styles.overview}>
          <div style={styles.tickerStrip}>
            {TICKER_STRIP_PAIRS.map((pair) => {
              const tk = tickers.get(pair);
              const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
              return (
                <div key={pair} style={styles.tickerStripItem}>
                  <span style={{ fontWeight: 700 }}>{pair.split('/')[0]}</span>
                  <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                    {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
                  </span>
                  <span className={change >= 0 ? 'text-buy' : 'text-sell'}>
                    {tk ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={styles.overviewInner}>
            <div style={styles.overviewHeaderRow}>
              <div>
                <span style={styles.eyebrow}>
                  <span style={styles.eyebrowDot} />
                  {t('marketing.liveMarkets')}
                </span>
                <h2 style={styles.overviewTitle}>{t('marketing.popularPairs')}</h2>
              </div>
              <Link to="/login" style={styles.viewAllLink}>
                {t('marketing.viewAllMarkets')} <ArrowIcon small />
              </Link>
            </div>

            <div style={styles.overviewGrid}>
              {OVERVIEW_PAIRS.map((pair) => {
                const tk = tickers.get(pair);
                const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
                const base = pair.split('/')[0];
                const positive = change >= 0;
                const points = history.get(pair) ?? [];
                return (
                  <Link key={pair} to="/login" style={styles.overviewCard} className="row-hover">
                    <div style={styles.overviewCardTop}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CryptoIcon symbol={base} size={28} />
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{pair}</div>
                        </div>
                      </div>
                      <div style={{ width: 80, height: 32 }}>
                        {points.length > 1 && <Sparkline points={points} width={80} height={32} />}
                      </div>
                    </div>
                    <div style={styles.overviewCardBottom}>
                      <span className="mono" style={{ fontSize: 17, fontWeight: 800 }}>
                        {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <div className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={{ fontSize: 13, fontWeight: 700 }}>
                          {tk ? `${positive ? '+' : ''}${change.toFixed(2)}%` : ''}
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {tk ? `Vol ${fmtCompact(parseFloat(tk.quoteVolume24h))}` : ''}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <Footer />
      </main>
    </div>
  );
}

function FeatureStat({ label }: { label: string }) {
  return (
    <div style={styles.featureItem}>
      <CheckIcon />
      <span>{label}</span>
    </div>
  );
}

function HeroPreviewPanel({
  tickers,
  fmt,
}: {
  tickers: Map<string, Ticker>;
  fmt: (n: number) => string;
}) {
  return (
    <div style={styles.previewWrap}>
      <div style={styles.previewCard}>
        <div style={styles.previewTabs}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Spot</span>
          <span>Perps</span>
          <span>200x</span>
        </div>
        <div style={styles.previewListHeader}>
          <span>Contract</span>
          <span>Last price</span>
        </div>
        {HERO_COINS.map((pair) => {
          const tk = tickers.get(pair);
          const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
          const base = pair.split('/')[0];
          return (
            <div key={pair} style={styles.previewRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CryptoIcon symbol={base} size={26} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{pair}</div>
                  <span style={styles.previewLevBadge}>100x</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                  {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
                </div>
                <div className={`mono ${change >= 0 ? 'text-buy' : 'text-sell'}`} style={{ fontSize: 11 }}>
                  {tk ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Phone mockup — a generic illustrative app preview, same convention
          as v0's own mockup; numbers are not tied to any real account. */}
      <div className="marketing-phone" style={styles.phone}>
        <div style={styles.phoneScreen}>
          <div style={styles.phoneStatusBar}>
            <span>11:00</span>
            <span>●●●</span>
          </div>
          <div style={styles.phoneWalletRow}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600 }}>Your Wallet</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>0x46GaC...2V9N9</div>
            </div>
            <span style={styles.phoneManageBtn}>Manage</span>
          </div>
          <div style={{ padding: '0 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Total Balance</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>2,206.30 <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>USDT</span></div>
            <div style={{ marginTop: 10, fontSize: 10, fontWeight: 700 }}>Trading Account</div>
            <div style={styles.phoneStatLine}>
              <span style={{ color: 'var(--text-tertiary)' }}>Margin</span>
              <span className="mono">513.15 USDT</span>
            </div>
            <div style={styles.phoneStatLine}>
              <span style={{ color: 'var(--text-tertiary)' }}>Available</span>
              <span className="mono">493.15 USDT</span>
            </div>
            <div style={styles.phoneBtnRow}>
              <span style={styles.phoneSmallBtn}>Deposit</span>
              <span style={styles.phoneSmallBtn}>Withdraw</span>
            </div>
            <div style={styles.phonePnlBox}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
                <span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Live P&amp;L </span>
                  <span className="text-buy mono">+0.28</span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-tertiary)' }}>Realized </span>
                  <span className="text-sell mono">-0.42</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowIcon({ small }: { small?: boolean }) {
  const s = small ? 13 : 15;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--buy)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function BurgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round">
      {open ? (
        <>
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </>
      )}
    </svg>
  );
}

// v0-designed palette (see the "VOLTEX" v0 export the owner supplied),
// scoped to this page the same way every other reskinned page re-themes
// itself.
const MARKETING_V0_VARS = {
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
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-primary)' },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    background: 'rgba(8,11,18,0.85)',
    backdropFilter: 'blur(16px)',
    borderBottom: '1px solid var(--border)',
  },
  headerInner: {
    maxWidth: 1280,
    margin: '0 auto',
    padding: '0 20px',
    height: 64,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 32 },
  navDesktop: { display: 'flex', alignItems: 'center', gap: 4 },
  navLink: { color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, padding: '8px 12px', borderRadius: 8 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  loginLink: { color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, padding: '8px 14px' },
  startBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontSize: 14,
    fontWeight: 700,
    padding: '9px 18px',
    borderRadius: 10,
  },
  burgerBtn: { display: 'none', background: 'transparent', border: 'none' },
  mobileMenu: { display: 'none', flexDirection: 'column', padding: '8px 20px 16px', borderTop: '1px solid var(--border)', gap: 4 },
  mobileLink: { padding: '10px 4px', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 },
  mobileCtaRow: { display: 'flex', gap: 10, marginTop: 10 },
  mobileLoginBtn: { border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center', flex: 1 },
  hero: { position: 'relative', overflow: 'hidden', padding: '64px 20px' },
  heroGrid: {
    maxWidth: 1280,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 48,
    alignItems: 'center',
  },
  heroLeft: { minWidth: 0 },
  eyebrow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  eyebrowDot: { width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' },
  heroTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 46,
    fontWeight: 800,
    lineHeight: 1.12,
    letterSpacing: '-0.02em',
    margin: '18px 0 0',
    maxWidth: 560,
    background: 'linear-gradient(120deg, var(--text-primary) 45%, var(--accent) 120%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroSub: { fontSize: 16, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '20px 0 0', maxWidth: 480 },
  heroCtaRow: { display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' },
  heroPrimaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontSize: 15,
    fontWeight: 700,
    padding: '13px 24px',
    borderRadius: 12,
  },
  heroSecondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    fontSize: 15,
    fontWeight: 700,
    padding: '13px 24px',
    borderRadius: 12,
  },
  featureRow: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 40 },
  featureItem: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-secondary)' },
  heroRight: { position: 'relative', minHeight: 420 },
  previewWrap: { position: 'relative' },
  previewCard: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
  },
  previewTabs: {
    display: 'flex',
    gap: 18,
    padding: '14px 18px',
    borderBottom: '1px solid var(--border)',
    fontSize: 13,
    color: 'var(--text-tertiary)',
    fontWeight: 600,
  },
  previewListHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 18px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  previewRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px' },
  previewLevBadge: {
    display: 'inline-block',
    marginTop: 3,
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    background: 'var(--panel-alt)',
    borderRadius: 4,
    padding: '1px 6px',
  },
  phone: {
    position: 'absolute',
    right: -8,
    bottom: -40,
    width: 208,
    borderRadius: 34,
    border: '1px solid var(--border)',
    background: '#05070c',
    padding: 8,
    boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
  },
  phoneScreen: {
    borderRadius: 26,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    paddingBottom: 12,
  },
  phoneStatusBar: { display: 'flex', justifyContent: 'space-between', padding: '10px 14px 4px', fontSize: 10, fontWeight: 600 },
  phoneWalletRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--panel-alt)',
    borderRadius: 10,
    margin: '8px 12px',
    padding: '8px 10px',
  },
  phoneManageBtn: { fontSize: 9, fontWeight: 700, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '2px 6px' },
  phoneStatLine: { display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4 },
  phoneBtnRow: { display: 'flex', gap: 6, marginTop: 10 },
  phoneSmallBtn: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 0' },
  phonePnlBox: { marginTop: 10, background: 'var(--panel-alt)', borderRadius: 8, padding: 8 },
  overview: { borderTop: '1px solid var(--border)', background: 'var(--panel-alt)' },
  tickerStrip: { display: 'flex', gap: 28, overflowX: 'auto', padding: '12px 20px', borderBottom: '1px solid var(--border)' },
  tickerStripItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 },
  overviewInner: { maxWidth: 1280, margin: '0 auto', padding: '56px 20px' },
  overviewHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 },
  overviewTitle: { fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, margin: '10px 0 0', letterSpacing: '-0.01em' },
  viewAllLink: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 14, fontWeight: 700 },
  overviewGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 28 },
  overviewCard: {
    display: 'block',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
  },
  overviewCardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  overviewCardBottom: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 },
};
