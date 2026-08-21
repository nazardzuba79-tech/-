import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { BalanceStrip } from '../components/BalanceStrip';

interface Product {
  id: string;
  name: string;
  description: string;
  priceAmount: string;
  priceAsset: string;
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.getProducts().then(setProducts).catch(() => {});
  }, []);

  async function handleBuy(product: Product) {
    setPurchasingId(product.id);
    setMessage(null);
    try {
      await api.purchaseProduct(product.id);
      setMessage({ type: 'success', text: `Оплачено: ${product.name}. Очікуй на надання доступу/товару.` });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof ApiError ? err.message : 'Не вдалось оплатити' });
    } finally {
      setPurchasingId(null);
    }
  }

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <div style={styles.logo}>
          EXCHANGE<span style={{ color: 'var(--accent)' }}>.</span>
        </div>
        <Link to="/trade" style={styles.navLink}>
          Торгівля
        </Link>
        <Link to="/markets" style={styles.navLink}>
          Ринки
        </Link>
        <Link to="/products" style={{ ...styles.navLink, color: 'var(--text-primary)' }}>
          Товари
        </Link>
        <div style={{ marginLeft: 'auto' }}>
          <BalanceStrip />
        </div>
      </nav>

      <main style={styles.main}>
        <h1 style={styles.title}>Товари та послуги</h1>

        {message && (
          <div style={{ ...styles.banner, ...(message.type === 'error' ? styles.bannerError : styles.bannerSuccess) }}>
            {message.text}
          </div>
        )}

        <div style={styles.grid}>
          {products.map((p) => (
            <div key={p.id} style={styles.card}>
              <h3 style={styles.cardTitle}>{p.name}</h3>
              <p style={styles.cardDesc}>{p.description}</p>
              <div style={styles.cardFooter}>
                <span className="mono" style={styles.price}>
                  {parseFloat(p.priceAmount)} {p.priceAsset}
                </span>
                <button
                  onClick={() => handleBuy(p)}
                  disabled={purchasingId === p.id}
                  style={styles.buyBtn}
                >
                  {purchasingId === p.id ? 'Зачекай...' : 'Купити'}
                </button>
              </div>
            </div>
          ))}
          {products.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)' }}>Товарів ще немає.</p>
          )}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    padding: '0 20px',
    height: 56,
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel)',
  },
  logo: { fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, letterSpacing: '0.05em' },
  navLink: { fontSize: 13, color: 'var(--text-secondary)' },
  main: { padding: 32, maxWidth: 900, margin: '0 auto' },
  title: { fontSize: 20, marginBottom: 20 },
  banner: { padding: '10px 14px', borderRadius: 4, fontSize: 13, marginBottom: 20 },
  bannerSuccess: { background: 'var(--buy-dim)', color: 'var(--buy)' },
  bannerError: { background: 'var(--sell-dim)', color: 'var(--sell)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cardTitle: { fontSize: 15, margin: 0 },
  cardDesc: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0, flex: 1 },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  price: { fontSize: 14, fontWeight: 700 },
  buyBtn: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 4,
    padding: '7px 14px',
    fontWeight: 700,
    fontSize: 12,
  },
};
