import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';

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
    <div style={styles.page}>
      <Nav active="/card" />
      <main style={styles.main}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>{t('card.title')}</h1>
          <span style={styles.badge}>{t('card.soon')}</span>
        </div>
        <p style={styles.lead}>{t('card.lead')}</p>

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
                    ? new Date(waitlist.joinedAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')
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
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 900, margin: '0 auto' },
  headerRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { fontSize: 22, margin: 0 },
  badge: {
    background: 'var(--accent)',
    color: '#0b0e11',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 999,
  },
  lead: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 28, maxWidth: 620 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 28 },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 18,
  },
  cardTitle: { fontSize: 14, margin: '0 0 8px' },
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
    borderRadius: 4,
    fontSize: 12,
    marginBottom: 12,
  },
  joinBtn: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 24,
    padding: '12px 22px',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
  },
};
