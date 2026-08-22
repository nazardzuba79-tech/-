import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { LogoMark } from '../components/Logo';
import { Footer } from '../components/Footer';

export function CardPage() {
  const { t, lang } = useLanguage();
  const FEATURES = [
    { title: t('card.feature1.title'), text: t('card.feature1.text') },
    { title: t('card.feature2.title'), text: t('card.feature2.text') },
    { title: t('card.feature3.title'), text: t('card.feature3.text') },
    { title: t('card.feature4.title'), text: t('card.feature4.text') },
    { title: t('card.feature5.title'), text: t('card.feature5.text') },
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
        <div style={styles.cardVisual}>
          <div style={styles.cardVisualTop}>
            <LogoMark size={26} variant="badge" />
            <span style={styles.cardVisualSoon}>{t('card.soon')}</span>
          </div>
          <div style={styles.cardVisualNumber} className="mono">
            •••• •••• •••• ••••
          </div>
          <div style={styles.cardVisualBottom}>
            <span style={styles.cardVisualWordmark}>VOLTEX</span>
            <ContactlessIcon />
          </div>
        </div>

        <div style={styles.headerRow}>
          <h1 style={styles.title}>{t('card.title')}</h1>
          <span style={styles.badge}>{t('card.soon')}</span>
        </div>
        <p style={styles.lead}>{t('card.lead')}</p>

        <div style={styles.vipBox}>
          <div style={styles.vipHeaderRow}>
            <h3 style={styles.vipTitle}>{t('card.vipTitle')}</h3>
            <span style={styles.vipRate}>8%</span>
          </div>
          <p style={styles.vipLead}>{t('card.vipLead')}</p>

          <div style={styles.vipCashbackRow}>
            <div style={styles.vipCashbackItem}>
              <CashbackIcon />
              <span>{t('card.vipCashbackPurchases')}</span>
            </div>
            <div style={styles.vipCashbackItem}>
              <CashbackIcon />
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
              <h3 style={styles.cardTitle}>{f.title}</h3>
              <p style={styles.cardText}>{f.text}</p>
            </div>
          ))}
        </div>

        <div style={styles.kycNotice}>
          <h3 style={styles.noticeTitle}>{t('card.whyKycTitle')}</h3>
          <p style={styles.noticeText}>{t('card.whyKycText')}</p>
        </div>

        <div style={styles.waitlistBox}>
          {!waitlist ? (
            <p style={{ color: 'var(--text-tertiary)' }}>{t('trade.loading')}</p>
          ) : waitlist.joined ? (
            <div style={styles.joinedRow}>
              <span style={{ color: 'var(--buy)', fontWeight: 700 }}>{t('card.joinedPrefix')}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {t('card.joinedSince', {
                  date: waitlist.joinedAt
                    ? new Date(waitlist.joinedAt).toLocaleDateString(localeOf(lang))
                    : '',
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

        <Footer />
      </main>
    </div>
  );
}

function CashbackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function ContactlessIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round">
      <path d="M8 10a4 4 0 0 1 0 4" />
      <path d="M11 7a8 8 0 0 1 0 10" />
      <path d="M14 4a12 12 0 0 1 0 16" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 900, margin: '0 auto' },
  cardVisual: {
    width: 340,
    aspectRatio: '1.586',
    borderRadius: 18,
    padding: 24,
    background: 'linear-gradient(135deg, #f7a600 0%, #ffb524 45%, #b97300 100%)',
    boxShadow: '0 16px 40px rgba(247,166,0,0.25)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  cardVisualTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardVisualSoon: {
    background: 'rgba(11,14,17,0.85)',
    color: '#f7a600',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
    padding: '4px 10px',
    borderRadius: 999,
  },
  cardVisualNumber: { color: 'rgba(11,14,17,0.75)', fontSize: 18, fontWeight: 700, letterSpacing: '0.08em' },
  cardVisualBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardVisualWordmark: { color: 'var(--on-accent)', fontWeight: 800, fontSize: 18, fontFamily: 'var(--font-mono)', letterSpacing: '0.03em' },
  headerRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { fontSize: 24, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  badge: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 999,
  },
  lead: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 28, maxWidth: 620 },
  vipBox: {
    background: 'linear-gradient(135deg, rgba(247,166,0,0.12) 0%, rgba(247,166,0,0.03) 100%)',
    border: '1px solid var(--accent)',
    borderRadius: 12,
    padding: 24,
    marginBottom: 28,
  },
  vipHeaderRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  vipTitle: { fontSize: 17, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800 },
  vipRate: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontSize: 13,
    fontWeight: 800,
    padding: '3px 12px',
    borderRadius: 999,
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
    borderTop: '1px solid var(--border)',
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
    marginBottom: 20,
  },
  noticeTitle: { fontSize: 14, margin: '0 0 8px' },
  noticeText: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  waitlistBox: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
  },
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
    padding: '12px 22px',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
  },
};
