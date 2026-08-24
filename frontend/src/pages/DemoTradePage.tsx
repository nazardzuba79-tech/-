import { useEffect, useState } from 'react';
import { Nav } from '../components/Nav';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { Badge } from '../components/Badge';
import { api, ApiError } from '../lib/api';

const POLL_MS = 2000;
const PAIR_REGEX = /^[A-Z0-9]+\/[A-Z0-9]+$/;

type Balance = { asset: string; available: string; locked: string };
type OpenOrder = Awaited<ReturnType<typeof api.getDemoOpenOrders>>[number];
type Book = { bids: { price: string; quantity: string; orders: number }[]; asks: { price: string; quantity: string; orders: number }[] };

/**
 * Admin-only sandbox for watching order-book/liquidity behavior with fake
 * funds — trades against its own DemoBalance/DemoOrder tables and its own
 * MatchingEngine instance, never the real ones (see DemoBalance's
 * schema.prisma doc comment). Every /demo/* call is independently
 * re-checked server-side for role ADMIN — the isAdmin gate below is a UX
 * convenience only, not the real access control.
 */
export function DemoTradePage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [pairInput, setPairInput] = useState('BTC/USDT');
  const [pair, setPair] = useState('BTC/USDT');

  const [book, setBook] = useState<Book>({ bids: [], asks: [] });
  const [balances, setBalances] = useState<Balance[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);

  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getMe().then((me) => setIsAdmin(me.isAdmin)).catch(() => setIsAdmin(false));
  }, []);

  function reload() {
    api.getDemoOrderBook(pair).then(setBook).catch(() => {});
    api.getDemoBalances().then(setBalances).catch(() => {});
    api.getDemoOpenOrders().then(setOpenOrders).catch(() => {});
  }

  useEffect(() => {
    if (!isAdmin) return;
    reload();
    const poll = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, pair]);

  function handlePairSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = pairInput.trim().toUpperCase();
    if (!PAIR_REGEX.test(next)) {
      setError('Пара должна быть в формате BASE/QUOTE, например BTC/USDT');
      return;
    }
    setError(null);
    setPair(next);
  }

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (type === 'LIMIT' && !price.trim()) {
      setError('Укажите цену для LIMIT-ордера');
      return;
    }
    if (!quantity.trim()) {
      setError('Укажите количество');
      return;
    }
    setBusy(true);
    try {
      await api.placeDemoOrder({ pair, side, type, price: type === 'LIMIT' ? price.trim() : undefined, quantity: quantity.trim() });
      setQuantity('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось разместить demo-ордер.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(orderId: string) {
    try {
      await api.cancelDemoOrder(orderId);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отменить ордер.');
    }
  }

  if (isAdmin === null) {
    return (
      <div style={styles.page}>
        <Nav active="/demo" />
        <main style={styles.main} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <Nav active="/demo" />
        <main style={{ ...styles.main, alignItems: 'center', textAlign: 'center', paddingTop: 80 }}>
          <p style={{ color: 'var(--text-secondary)' }}>Эта страница доступна только администратору.</p>
        </main>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <Nav active="/demo" />
      <main style={styles.main}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>
            Demo-трейдинг <Badge text="DEMO" color="#a15c00" bg="#fdecc8" />
          </h1>
          <p style={styles.hint}>
            Тестовая песочница на фейковых средствах — своя книга ордеров, полностью отделена от реального стакана и балансов. Разместите LIMIT-ордера
            на обеих сторонах, чтобы создать глубину, затем попробуйте MARKET-ордер, чтобы увидеть, как он её съедает.
          </p>
        </div>

        <form onSubmit={handlePairSubmit} style={styles.pairForm}>
          <input
            style={styles.input}
            value={pairInput}
            onChange={(e) => setPairInput(e.target.value)}
            placeholder="BTC/USDT"
          />
          <button type="submit" style={styles.neutralBtn}>
            Сменить пару
          </button>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Текущая пара: {pair}</span>
        </form>

        <div style={styles.grid}>
          <div style={styles.panel}>
            <h3 style={styles.panelTitle}>Стакан (demo)</h3>
            <OrderBookPanel bids={book.bids} asks={book.asks} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Новый ордер</h3>
              <form onSubmit={handlePlaceOrder} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => setSide('BUY')} style={{ ...styles.toggleBtn, ...(side === 'BUY' ? styles.toggleBtnBuyActive : {}) }}>
                    Купить
                  </button>
                  <button type="button" onClick={() => setSide('SELL')} style={{ ...styles.toggleBtn, ...(side === 'SELL' ? styles.toggleBtnSellActive : {}) }}>
                    Продать
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => setType('LIMIT')} style={{ ...styles.toggleBtn, ...(type === 'LIMIT' ? styles.toggleBtnActive : {}) }}>
                    LIMIT
                  </button>
                  <button type="button" onClick={() => setType('MARKET')} style={{ ...styles.toggleBtn, ...(type === 'MARKET' ? styles.toggleBtnActive : {}) }}>
                    MARKET
                  </button>
                </div>
                {type === 'LIMIT' && (
                  <label style={styles.label}>
                    Цена
                    <input style={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="60000" />
                  </label>
                )}
                <label style={styles.label}>
                  Количество
                  <input style={styles.input} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.1" />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  style={{ ...styles.submitBtn, background: side === 'BUY' ? 'var(--buy)' : 'var(--sell)' }}
                >
                  {side === 'BUY' ? 'Купить' : 'Продать'} (demo)
                </button>
                {error && <div style={styles.errorBox}>{error}</div>}
              </form>
            </div>

            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>Demo-баланс</h3>
              {balances.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Баланс пуст — начислите его в /admin/users.</p>}
              {balances.map((b) => (
                <div key={b.asset} style={styles.balanceRow}>
                  <span className="mono">{b.asset}</span>
                  <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                    {b.available} доступно{Number(b.locked) > 0 ? `, ${b.locked} заблокировано` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ ...styles.panel, marginTop: 16 }}>
          <h3 style={styles.panelTitle}>Открытые demo-ордера</h3>
          {openOrders.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Открытых ордеров нет.</p>}
          {openOrders.map((o) => (
            <div key={o.id} style={styles.orderRow}>
              <span className="mono">{o.pair}</span>
              <span style={{ color: o.side === 'BUY' ? 'var(--buy)' : 'var(--sell)' }}>{o.side}</span>
              <span>{o.type}</span>
              <span className="mono">{o.price ?? '—'}</span>
              <span className="mono">
                {o.remainingQuantity}/{o.originalQuantity}
              </span>
              <button onClick={() => handleCancel(o.id)} style={styles.cancelBtn}>
                Отменить
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column' },
  headerRow: { marginBottom: 16 },
  title: { fontSize: 22, margin: '0 0 8px', fontFamily: 'var(--font-display)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 },
  hint: { fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 700, margin: 0 },
  pairForm: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  panel: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 },
  panelTitle: { fontSize: 13, fontWeight: 700, margin: '0 0 10px' },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-secondary)' },
  neutralBtn: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '8px 16px',
    fontSize: 12.5,
    fontWeight: 600,
  },
  toggleBtn: {
    flex: 1,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 0',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  toggleBtnActive: { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)' },
  toggleBtnBuyActive: { background: 'var(--buy)', color: 'var(--on-accent)', borderColor: 'var(--buy)' },
  toggleBtnSellActive: { background: 'var(--sell)', color: 'var(--on-accent)', borderColor: 'var(--sell)' },
  submitBtn: { border: 'none', borderRadius: 8, padding: '10px 0', color: 'var(--on-accent)', fontWeight: 700, fontSize: 13 },
  errorBox: { background: 'var(--sell-dim)', color: 'var(--sell)', padding: '8px 10px', borderRadius: 8, fontSize: 12 },
  balanceRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 12 },
  orderRow: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.8fr 0.8fr 1fr 1.2fr auto',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
    borderTop: '1px solid var(--border)',
    fontSize: 12,
  },
  cancelBtn: {
    background: 'transparent',
    color: 'var(--sell)',
    border: '1px solid var(--sell)',
    borderRadius: 16,
    padding: '5px 12px',
    fontSize: 11,
    fontWeight: 700,
  },
};
