import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Nav } from '../components/Nav';

const FEATURES = [
  { title: 'Apple Pay та Google Pay', text: 'Прив’яжи картку і плати в супермаркетах, на заправках та в інтернеті — всюди, де приймають Apple Pay/Google Pay.' },
  { title: 'Без комісій на обслуговування', text: 'Безкоштовне відкриття і ведення картки — жодної щомісячної чи щорічної плати.' },
  { title: 'Без комісії за конвертацію', text: 'Оплата списується напряму з криптобалансу за курсом ринку, без прихованої націнки на конвертацію.' },
  { title: 'Зняття готівки без комісій', text: 'Зняття в банкоматах без додаткової комісії від нас (ліміти банкомата й партнера можуть застосовуватись).' },
  { title: '8% кешбеку', text: 'На всі оплати карткою — нараховується автоматично на внутрішній баланс.' },
];

export function CardPage() {
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
      setError(err instanceof ApiError ? err.message : 'Не вдалось приєднатись до списку очікування');
    } finally {
      setJoining(false);
    }
  }

  return (
    <div style={styles.page}>
      <Nav active="/card" />
      <main style={styles.main}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Криптокартка</h1>
          <span style={styles.badge}>Скоро</span>
        </div>
        <p style={styles.lead}>
          Картка, прив'язана до твого внутрішнього балансу — картки ще немає в випуску, але вже можна записатись у
          список очікування.
        </p>

        <div style={styles.grid}>
          {FEATURES.map((f) => (
            <div key={f.title} style={styles.card}>
              <h3 style={styles.cardTitle}>{f.title}</h3>
              <p style={styles.cardText}>{f.text}</p>
            </div>
          ))}
        </div>

        <div style={styles.kycNotice}>
          <h3 style={styles.noticeTitle}>Чому для картки потрібна верифікація</h3>
          <p style={styles.noticeText}>
            Торгувати на біржі можна без верифікації (KYC). Але саму картку випускає партнерський банк разом з
            платіжною системою (Visa/Mastercard) — вони за законом вимагають повну верифікацію власника картки для
            будь-якого емітента, незалежно від країни реєстрації компанії. Тому верифікація обов'язкова лише для
            картки та операцій з фіатом, а не для звичайної криптоторгівлі.
          </p>
        </div>

        <div style={styles.waitlistBox}>
          {!waitlist ? (
            <p style={{ color: 'var(--text-tertiary)' }}>Завантаження...</p>
          ) : waitlist.joined ? (
            <div style={styles.joinedRow}>
              <span style={{ color: 'var(--buy)', fontWeight: 700 }}>Ви в списку очікування</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                з {waitlist.joinedAt ? new Date(waitlist.joinedAt).toLocaleDateString('uk-UA') : ''} — повідомимо,
                коли картка стане доступна.
              </span>
            </div>
          ) : waitlist.kycStatus === 'APPROVED' ? (
            <>
              {error && <div style={styles.errorBox}>{error}</div>}
              <button onClick={handleJoin} disabled={joining} style={styles.joinBtn}>
                {joining ? 'Зачекай...' : 'Приєднатися до списку очікування'}
              </button>
            </>
          ) : (
            <div style={styles.joinedRow}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Щоб приєднатись до списку очікування, спочатку пройди верифікацію.
              </span>
              <Link to="/settings" style={styles.verifyLink}>
                Пройти верифікацію →
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
    borderRadius: 4,
    padding: '11px 20px',
    fontWeight: 700,
    fontSize: 14,
  },
};
