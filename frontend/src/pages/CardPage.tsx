import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { LogoMark } from '../components/Logo';
import { Footer } from '../components/Footer';
import { Skeleton } from '../components/Skeleton';

export function CardPage() {
  const { t, lang } = useLanguage();
  const FEATURES: { title: string; text: string; icon: JSX.Element }[] = [
    { title: t('card.feature1.title'), text: t('card.feature1.text'), icon: <PayIcon /> },
    { title: t('card.feature2.title'), text: t('card.feature2.text'), icon: <NoFeeIcon /> },
    { title: t('card.feature3.title'), text: t('card.feature3.text'), icon: <ConvertIcon /> },
    { title: t('card.feature4.title'), text: t('card.feature4.text'), icon: <AtmIcon /> },
    { title: t('card.feature5.title'), text: t('card.feature5.text'), icon: <CashbackIcon /> },
  ];
  const FAQ = [
    { q: t('card.faq.order.q'), a: t('card.faq.order.a') },
    { q: t('card.faq.delivery.q'), a: t('card.faq.delivery.a') },
    { q: t('card.faq.limits.q'), a: t('card.faq.limits.a') },
    { q: t('card.faq.currencies.q'), a: t('card.faq.currencies.a') },
  ];
  const [waitlist, setWaitlist] = useState<Awaited<ReturnType<typeof api.getCardWaitlist>> | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.getCardWaitlist().then(setWaitlist).catch(() => {});
  }

  useEffect(reload, []);

  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      await api.joinCardWaitlist();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('card.joinError'));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/card" />
      <main style={styles.main}>
        <div style={styles.hero}>
          <div style={styles.heroText}>
            <h1 style={styles.title}>
              {t('card.title')} <span style={styles.titleDash}>—</span> {t('card.heroTagline')}
            </h1>
            <p style={styles.lead}>{t('card.lead')}</p>

            <div style={styles.ctaBox}>
              {!waitlist ? (
                <Skeleton width={200} height={44} radius={24} />
              ) : waitlist.joined ? (
                <div style={styles.joinedRow}>
                  <span style={{ color: 'var(--buy)', fontWeight: 700 }}>{t('card.joinedPrefix')}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {t('card.joinedSince', {
                      date: waitlist.joinedAt ? new Date(waitlist.joinedAt).toLocaleDateString(localeOf(lang)) : '',
                    })}
                  </span>
                </div>
              ) : waitlist.kycStatus === 'APPROVED' ? (
                <>
                  {error && <div style={styles.errorBox}>{error}</div>}
                  <button onClick={handleJoin} disabled={joining} style={styles.joinBtn}>
                    {joining ? t('auth.wait') : t('card.joinBtn')}
                  </button>
                </>
              ) : (
                <div style={styles.joinedRow}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('card.needVerification')}</span>
                  <Link to="/settings" style={styles.verifyLink}>
                    {t('card.goVerify')}
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="card-tilt-wrap" style={styles.cardTiltWrap}>
            <div className="card-tilt" style={styles.cardVisual}>
              <div style={styles.cardVisualSheen} />
              <div style={styles.cardVisualTop}>
                <LogoMark size={26} variant="badge" />
                <ContactlessIcon />
              </div>
              <div style={styles.cardVisualNumber} className="mono">
                •••• •••• •••• ••••
              </div>
              <div style={styles.cardVisualBottom}>
                <span style={styles.cardVisualWordmark}>VOLTEX</span>
                <span style={styles.cardVisualNetwork}>Crypto Card</span>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.vipBox}>
          <div style={styles.vipGlow} />
          <div style={styles.vipHeaderRow}>
            <h3 style={styles.vipTitle}>{t('card.vipTitle')}</h3>
            <span style={styles.vipRate}>8%</span>
          </div>
          <p style={styles.vipLead}>{t('card.vipLead')}</p>

          <div style={styles.vipCashbackRow}>
            <div style={styles.vipCashbackItem}>
              <CashbackIcon small />
              <span>{t('card.vipCashbackPurchases')}</span>
            </div>
            <div style={styles.vipCashbackItem}>
              <CashbackIcon small />
              <span>{t('card.vipCashbackDeposits')}</span>
            </div>
          </div>

          <div style={styles.vipEligibility}>
            <span style={styles.vipEligibilityTitle}>{t('card.vipEligibilityTitle')}</span>
            <div style={styles.vipEligibilityRow}>
              <span style={styles.vipChip}>{t('card.vipEligibilityDeposit')}</span>
              <span style={styles.vipOr}>{t('card.vipOr')}</span>
              <span style={styles.vipChip}>{t('card.vipEligibilityVolume')}</span>
            </div>
          </div>
        </div>

        <div style={styles.grid}>
          {FEATURES.map((f) => (
            <div key={f.title} className="card-hover" style={styles.card}>
              <div style={styles.cardIconBadge}>{f.icon}</div>
              <h3 style={styles.cardTitle}>{f.title}</h3>
              <p style={styles.cardText}>{f.text}</p>
            </div>
          ))}
        </div>

        <div style={styles.kycNotice}>
          <h3 style={styles.noticeTitle}>{t('card.whyKycTitle')}</h3>
          <p style={styles.noticeText}>{t('card.whyKycText')}</p>
        </div>

        <div style={styles.faqSection}>
          <h2 style={styles.faqTitle}>{t('card.faqTitle')}</h2>
          <div style={styles.faqList}>
            {FAQ.map((item) => (
              <details key={item.q} style={styles.faqItem}>
                <summary style={styles.faqQuestion}>{item.q}</summary>
                <p style={styles.faqAnswer}>{item.a}</p>
              </details>
            ))}
          </div>
        </div>

        <Footer />
      </main>
    </div>
  );
}

function CashbackIcon({ small }: { small?: boolean }) {
  const size = small ? 16 : 20;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function PayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <path d="M9 18h6" />
      <path d="M3 9c1.2 1.2 1.2 3 0 4.2M1.2 7.2c2.2 2.2 2.2 5.6 0 7.8" />
    </svg>
  );
}

function NoFeeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l7 3v6c0 5-3 8-7 11-4-3-7-6-7-11V5l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function ConvertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

function AtmIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function ContactlessIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.2" strokeLinecap="round">
      <path d="M8 10a4 4 0 0 1 0 4" />
      <path d="M11 7a8 8 0 0 1 0 10" />
      <path d="M14 4a12 12 0 0 1 0 16" />
    </svg>
  );
}

// Light, premium redesign scoped to this page's content — same pattern as
// WalletPage's LIGHT_PAGE_VARS: redefines the custom properties every
// var(--panel)/var(--border)/var(--text-*) style below already reads from,
// so the whole page flips to a light/dark-text look without duplicating
// every rule. `color` is set explicitly so plain inherited text also picks
// up the dark value instead of the app-wide light-on-dark default.
const LIGHT_PAGE_VARS = {
  ['--panel' as any]: '#ffffff',
  ['--panel-alt' as any]: '#f1f3f7',
  ['--panel-alt-hover' as any]: '#e8ebf0',
  ['--border' as any]: '#e3e6ec',
  ['--text-primary' as any]: '#12151a',
  ['--text-secondary' as any]: '#4b5563',
  ['--text-tertiary' as any]: '#6b7280',
  ['--neutral-dim' as any]: 'rgba(75,85,99,0.08)',
  color: 'var(--text-primary)',
} as React.CSSProperties;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'linear-gradient(180deg, #ffffff 0%, #f2f3f6 100%)' },
  main: { padding: 32, maxWidth: 960, margin: '0 auto', ...LIGHT_PAGE_VARS },
  hero: {
    display: 'flex',
    alignItems: 'center',
    gap: 40,
    flexWrap: 'wrap',
    marginBottom: 36,
  },
  heroText: { flex: '1 1 380px', minWidth: 280 },
  title: {
    fontSize: 30,
    margin: '0 0 14px',
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
  },
  titleDash: { color: 'var(--text-tertiary)', fontWeight: 400 },
  lead: { color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 24, maxWidth: 480 },
  ctaBox: { minHeight: 44 },
  cardTiltWrap: { flex: '0 0 340px' },
  cardVisual: {
    position: 'relative',
    width: 340,
    aspectRatio: '1.586',
    borderRadius: 18,
    padding: 24,
    // Metallic graphite finish (Bybit-style) instead of a flat brand-color
    // fill — several dark tone stops on a steep diagonal read as brushed
    // metal, with the sheen layer below adding the glossy highlight.
    background:
      'linear-gradient(135deg, #3a3f4a 0%, #16181c 22%, #2b2e35 45%, #0e0f12 68%, #3d4149 85%, #1a1c20 100%)',
    border: '1px solid rgba(255,255,255,0.09)',
    boxShadow: '0 20px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardVisualSheen: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(115deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 22%, rgba(255,255,255,0) 40%, rgba(255,255,255,0.08) 60%, rgba(255,255,255,0) 78%)',
    pointerEvents: 'none',
  },
  cardVisualTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardVisualNumber: { color: 'rgba(255,255,255,0.55)', fontSize: 18, fontWeight: 700, letterSpacing: '0.08em' },
  cardVisualBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardVisualWordmark: {
    color: 'var(--accent)',
    fontWeight: 800,
    fontSize: 18,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.03em',
    textShadow: '0 0 16px rgba(247,166,0,0.5)',
  },
  cardVisualNetwork: { color: 'rgba(255,255,255,0.55)', fontWeight: 700, fontSize: 12, letterSpacing: '0.02em' },
  vipBox: {
    position: 'relative',
    background: 'linear-gradient(135deg, rgba(255,209,102,0.14) 0%, rgba(247,166,0,0.04) 100%)',
    border: '1px solid transparent',
    backgroundClip: 'padding-box',
    borderRadius: 14,
    padding: 26,
    marginBottom: 28,
    overflow: 'hidden',
    boxShadow: '0 0 0 1px rgba(255,209,102,0.5), 0 12px 32px rgba(247,166,0,0.12)',
  },
  vipGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,209,102,0.35), transparent 70%)',
    pointerEvents: 'none',
  },
  vipHeaderRow: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 },
  vipTitle: { fontSize: 18, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800 },
  vipRate: {
    background: 'linear-gradient(135deg, #ffd166, #f7a600)',
    color: '#3a2400',
    fontSize: 22,
    fontWeight: 900,
    padding: '2px 16px',
    borderRadius: 999,
    boxShadow: '0 4px 14px rgba(247,166,0,0.4)',
  },
  vipLead: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: '0 0 18px', maxWidth: 640 },
  vipCashbackRow: { display: 'flex', gap: 24, marginBottom: 18, flexWrap: 'wrap' },
  vipCashbackItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  vipEligibility: {
    borderTop: '1px solid rgba(255,209,102,0.3)',
    paddingTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  vipEligibilityTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
  vipEligibilityRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  vipChip: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  vipOr: { fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 28 },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
  },
  cardIconBadge: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: 'var(--accent-dim)',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    margin: '0 0 8px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    letterSpacing: '0.01em',
  },
  cardText: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  kycNotice: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
    marginBottom: 28,
  },
  noticeTitle: { fontSize: 14, margin: '0 0 8px' },
  noticeText: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  faqSection: { marginBottom: 20 },
  faqTitle: { fontSize: 19, margin: '0 0 16px', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  faqList: { display: 'flex', flexDirection: 'column', gap: 8 },
  faqItem: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '14px 18px',
  },
  faqQuestion: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-primary)',
    cursor: 'pointer',
  },
  faqAnswer: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '10px 0 0' },
  joinedRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  verifyLink: { fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginTop: 4 },
  errorBox: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
    marginBottom: 12,
  },
  joinBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 24,
    padding: '13px 26px',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
  },
};
