import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { Skeleton } from '../../components/Skeleton';

type Product = Awaited<ReturnType<typeof api.getAdminProducts>>[number];

/** Управление товарами/услугами внутреннего магазина — создание, изменение
 * цены/описания, деактивация и повторная активация. */
export function AdminProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceAmount, setPriceAmount] = useState('');
  const [priceAsset, setPriceAsset] = useState('USDT');
  const [creating, setCreating] = useState(false);

  function reload() {
    api.getAdminProducts().then(setProducts);
  }

  useEffect(reload, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.createProduct({ name, description, priceAmount, priceAsset });
      setName('');
      setDescription('');
      setPriceAmount('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось создать товар.');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(p: Product) {
    setError(null);
    setBusyId(p.id);
    try {
      await api.updateProduct(p.id, { active: !p.active });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось изменить товар.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 style={styles.title}>Товары и услуги</h1>
      {error && <div style={{ ...styles.errorBox, marginBottom: 16 }}>{error}</div>}

      <div style={{ ...styles.card, marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>Новый товар</h3>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1.4fr 2fr 0.8fr 0.6fr auto', gap: 10, alignItems: 'end' }}>
          <label style={styles.label}>
            Название
            <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label style={styles.label}>
            Описание
            <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} required />
          </label>
          <label style={styles.label}>
            Цена
            <input style={styles.input} value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} placeholder="99" required />
          </label>
          <label style={styles.label}>
            Актив
            <input style={styles.input} value={priceAsset} onChange={(e) => setPriceAsset(e.target.value.toUpperCase())} required />
          </label>
          <button type="submit" style={styles.primaryBtn} disabled={creating}>
            Добавить
          </button>
        </form>
      </div>

      <div style={styles.table}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: '1.4fr 2fr 1fr 0.8fr auto', minWidth: 800 }}>
          <span>Название</span>
          <span>Описание</span>
          <span>Цена</span>
          <span>Статус</span>
          <span />
        </div>
        {products === null && <Skeleton height={80} />}
        {products?.map((p) => (
          <div key={p.id} style={{ ...styles.tableRow, gridTemplateColumns: '1.4fr 2fr 1fr 0.8fr auto', minWidth: 800 }}>
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.description}</span>
            <span className="mono">{p.priceAmount} {p.priceAsset}</span>
            <span
              style={{
                color: p.active ? 'var(--buy)' : 'var(--text-tertiary)',
                background: p.active ? 'var(--buy-dim)' : 'var(--neutral-dim)',
                borderRadius: 20,
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: 700,
                width: 'fit-content',
              }}
            >
              {p.active ? 'Активен' : 'Скрыт'}
            </span>
            <button disabled={busyId === p.id} onClick={() => toggleActive(p)} style={p.active ? styles.rejectBtn : styles.approveBtn}>
              {p.active ? 'Скрыть' : 'Активировать'}
            </button>
          </div>
        ))}
        {products?.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Товаров ещё нет.</p>}
      </div>
    </div>
  );
}
