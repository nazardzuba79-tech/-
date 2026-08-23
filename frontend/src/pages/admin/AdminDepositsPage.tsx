import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { Skeleton } from '../../components/Skeleton';

type Incoming = Awaited<ReturnType<typeof api.getAdminIncomingDeposits>>[number];
type Deposit = Awaited<ReturnType<typeof api.getAdminDeposits>>[number];
type Client = Awaited<ReturnType<typeof api.getAllClients>>[number];

/** История пополнений — вся лента депозитов по всем пользователям, с
 * фильтрами, плюс лента непривязанных входящих переводов, которые можно
 * вручную сопоставить с пользователем и зачислить. */
export function AdminDepositsPage() {
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [incomingLoaded, setIncomingLoaded] = useState(false);
  const [incomingError, setIncomingError] = useState(false);
  const [history, setHistory] = useState<Deposit[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [pickedUser, setPickedUser] = useState<Record<string, string>>({});
  const [creditingKey, setCreditingKey] = useState<string | null>(null);
  const [ignoringKey, setIgnoringKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filterUser, setFilterUser] = useState('');
  const [filterAsset, setFilterAsset] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');

  function reloadIncoming() {
    api
      .getAdminIncomingDeposits()
      .then((res) => {
        setIncoming(res);
        setIncomingError(false);
      })
      .catch(() => setIncomingError(true))
      .finally(() => setIncomingLoaded(true));
  }

  useEffect(() => {
    reloadIncoming();
    api.getAdminDeposits().then(setHistory);
    api.getAllClients().then(setClients).catch(() => {});
  }, []);

  async function handleCredit(tr: Incoming) {
    const key = `${tr.chain}:${tr.txHash}`;
    const userId = pickedUser[key];
    if (!userId) return;
    setError(null);
    setCreditingKey(key);
    try {
      await api.creditDepositManually({ userId, chain: tr.chain, txHash: tr.txHash, asset: tr.asset });
      reloadIncoming();
      api.getAdminDeposits().then(setHistory);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось зачислить депозит.');
    } finally {
      setCreditingKey(null);
    }
  }

  async function handleIgnore(tr: Incoming) {
    const key = `${tr.chain}:${tr.txHash}`;
    if (!window.confirm('Скрыть этот перевод навсегда? Он не является депозитом от клиента.')) return;
    setError(null);
    setIgnoringKey(key);
    try {
      await api.ignoreIncomingDeposit({ chain: tr.chain, txHash: tr.txHash });
      setIncoming((prev) => prev.filter((t) => `${t.chain}:${t.txHash}` !== key));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось скрыть перевод.');
    } finally {
      setIgnoringKey(null);
    }
  }

  const filtered = useMemo(() => {
    if (!history) return [];
    return history.filter((d) => {
      if (filterUser && !d.userEmail.toLowerCase().includes(filterUser.toLowerCase())) return false;
      if (filterAsset && d.asset !== filterAsset) return false;
      if (filterStatus && d.status !== filterStatus) return false;
      if (filterDate && !d.createdAt.startsWith(filterDate)) return false;
      return true;
    });
  }, [history, filterUser, filterAsset, filterStatus, filterDate]);

  const assets = useMemo(() => Array.from(new Set((history ?? []).map((d) => d.asset))).sort(), [history]);

  return (
    <div>
      <h1 style={styles.title}>Пополнения</h1>
      {error && <div style={{ ...styles.errorBox, marginBottom: 16 }}>{error}</div>}

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Непривязанные входящие переводы</h3>
      <div style={{ ...styles.table, marginBottom: 32 }}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: '0.8fr 0.7fr 1fr 1fr 1.2fr 1.6fr 1fr 1fr', minWidth: 1020 }}>
          <span>Сеть</span>
          <span>Актив</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span style={{ textAlign: 'right' }}>Подтверждения</span>
          <span>Txid</span>
          <span>Зачислить пользователю</span>
          <span />
          <span />
        </div>
        {incoming.map((tr) => {
          const key = `${tr.chain}:${tr.txHash}`;
          return (
            <div key={key} style={{ ...styles.tableRow, gridTemplateColumns: '0.8fr 0.7fr 1fr 1fr 1.2fr 1.6fr 1fr 1fr', minWidth: 1020 }}>
              <span>{tr.chain}</span>
              <span className="mono">{tr.asset}</span>
              <span className="mono" style={{ textAlign: 'right' }}>{tr.amount}</span>
              <span className="mono" style={{ textAlign: 'right' }}>{tr.confirmations}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={tr.txHash}>
                {tr.txHash.slice(0, 10)}…
              </span>
              <select value={pickedUser[key] ?? ''} onChange={(e) => setPickedUser((prev) => ({ ...prev, [key]: e.target.value }))} style={styles.input}>
                <option value="">Выберите пользователя</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.email}</option>
                ))}
              </select>
              <button disabled={!pickedUser[key] || creditingKey === key} onClick={() => handleCredit(tr)} style={styles.approveBtn}>
                {creditingKey === key ? 'Зачисление…' : 'Зачислить'}
              </button>
              <button disabled={ignoringKey === key} onClick={() => handleIgnore(tr)} style={styles.neutralBtn} title="Не является депозитом — скрыть навсегда">
                {ignoringKey === key ? 'Скрытие…' : 'Игнорировать'}
              </button>
            </div>
          );
        })}
        {incomingLoaded && !incomingError && incoming.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Нет непривязанных переводов.</p>
        )}
        {incomingError && <p style={{ padding: 14, color: 'var(--sell)', fontSize: 12 }}>Не удалось загрузить входящие переводы.</p>}
        {!incomingLoaded && <Skeleton height={80} />}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Вся история пополнений</h3>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={{ ...styles.input, width: 200 }} placeholder="Email пользователя" value={filterUser} onChange={(e) => setFilterUser(e.target.value)} />
        <select style={{ ...styles.input, width: 140 }} value={filterAsset} onChange={(e) => setFilterAsset(e.target.value)}>
          <option value="">Все активы</option>
          {assets.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={{ ...styles.input, width: 160 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Любой статус</option>
          <option value="PENDING">PENDING</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CREDITED">CREDITED</option>
        </select>
        <input type="date" style={{ ...styles.input, width: 160 }} value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
      </div>

      <div style={styles.table}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 0.8fr 1fr 1fr 1.4fr', minWidth: 900 }}>
          <span>Дата</span>
          <span>Пользователь</span>
          <span>Актив</span>
          <span>Сеть</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span>Статус</span>
          <span>Txid</span>
        </div>
        {history === null && <Skeleton height={80} />}
        {filtered.map((d) => (
          <div key={d.id} style={{ ...styles.tableRow, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 0.8fr 1fr 1fr 1.4fr', minWidth: 900 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(d.createdAt).toLocaleString('ru-RU')}</span>
            <span style={{ fontSize: 12 }}>{d.userEmail}</span>
            <span className="mono">{d.asset}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.chain}</span>
            <span className="mono" style={{ textAlign: 'right' }}>{d.amount}</span>
            <span style={{ fontSize: 12 }}>{d.status}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={d.txHash}>{d.txHash.slice(0, 10)}…</span>
          </div>
        ))}
        {history && filtered.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Ничего не найдено.</p>}
      </div>
    </div>
  );
}
