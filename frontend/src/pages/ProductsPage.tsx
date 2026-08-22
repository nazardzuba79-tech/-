import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';

interface Product {
  id: string;
  name: string;
  description: string;
  priceAmount: string;
  priceAsset: string;
}

export function ProductsPage() {
  const { t } = useLanguage();
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
      setMessage({ type: 'success', text: t('products.paid', { name: product.name }) });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof ApiError ? err.message : t('products.buyError') });
    } finally {
      setPurchasingId(null);
    }
  }

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/products" />

      <main style={styles.main}>
        <h1 style={styles.title}>{t('products.title')}</h1>

        {message && (
          <div style={{ ...styles.banner, ...(message.type === 'error' ? styles.bannerError : styles.bannerSuccess) }}>
            {message.text}
          </div>
        )}

        <div style={styles.grid}>
          {products.map((p) => (
            <div key={p.id} className="card-hover" style={styles.card}>
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
                  {purchasingId === p.id ? t('products.wait') : t('products.buy')}
                </button>
              </div>
            </div>
          ))}
          {products.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)' }}>{t('products.none')}</p>
          )}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 900, margin: '0 auto' },
  title: { fontSize: 22, marginBottom: 20, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
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
    borderRadius: 16,
    padding: '7px 16px',
    fontWeight: 800,
    fontSize: 12,
    boxShadow: '0 2px 10px rgba(247,166,0,0.3)',
  },
};
