import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { CopyValue, RailLabel } from './AdminPrimitives';
import { Skeleton } from '../../components/Skeleton';
import { useLocation } from 'react-router-dom';

type Incoming = Awaited<ReturnType<typeof api.getAdminIncomingDepositFeed>>['transfers'][number];
type Deposit = Awaited<ReturnType<typeof api.getAdminDeposits>>[number];
type Client = Awaited<ReturnType<typeof api.getAllClients>>[number];

/** История пополнений — вся лента депозитов по всем пользователям, с
 * фильтрами, плюс лента непривязанных входящих переводов, которые можно
 * вручную сопоставить с пользователем и зачислить. */
export function AdminDepositsPage() {
  const { hash } = useLocation();
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [incomingLoaded, setIncomingLoaded] = useState(false);
  const [incomingError, setIncomingError] = useState(false);
  const [failedChains, setFailedChains] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
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
      .getAdminIncomingDepositFeed()
      .then((res) => {
        setIncoming(res.transfers);
        setFailedChains(res.failedChains);
        setIncomingError(false);
        api.getAdminDeposits().then(setHistory).catch(() => setError('Не удалось загрузить историю пополнений.'));
      })
      .catch(() => setIncomingError(true))
      .finally(() => setIncomingLoaded(true));
  }

  useEffect(() => {
    reloadIncoming();
    api.getAdminDeposits().then(setHistory).catch(() => setError('Не удалось загрузить историю пополнений.'));
    api.getAllClients().then(setClients).catch(() => {});
  }, []);

  async function handleCredit(tr: Incoming | Deposit) {
    const key = `${tr.chain}:${tr.txHash}`;
    const userId = ('userId' in tr && tr.userId) || pickedUser[key];
    if (!userId || creditingKey) return;
    setMessage(null);
    setError(null);
    setCreditingKey(key);
    try {
      const result = await api.creditDepositManually({ userId, chain: tr.chain, txHash: tr.txHash, asset: tr.asset });
      setMessage(result.status === 'CREDITED' ? 'Депозит зачислен.' : result.status === 'BELOW_MINIMUM'
        ? 'BELOW_MINIMUM — депозит ниже минимальной суммы. Для зачисления нужны подтверждения сети.'
        : 'Депозит ожидает подтверждений сети. Баланс не изменён.');
      reloadIncoming();
      await api.getAdminDeposits().then(setHistory);
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
      if (filterUser && !(d.userEmail ?? '').toLowerCase().includes(filterUser.toLowerCase())) return false;
      if (filterAsset && d.asset !== filterAsset) return false;
      if (filterStatus && d.status !== filterStatus) return false;
      if (filterDate && !d.createdAt.startsWith(filterDate)) return false;
      return true;
    });
  }, [history, filterUser, filterAsset, filterStatus, filterDate]);

  const assets = useMemo(() => Array.from(new Set((history ?? []).map((d) => d.asset))).sort(), [history]);

  useEffect(() => {
    if (!hash) return;
    try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'center' }); }
    catch { /* A malformed fragment must not affect the deposit queue. */ }
  }, [incoming, hash]);

  return (
    <div>
      <h1 style={styles.title}>Пополнения</h1>
      {error && <div role="alert" style={{ ...styles.errorBox, marginBottom: 16 }}>{error}</div>}
      {message && <p role="status">{message}</p>}

      <p style={styles.hint}>Лента недавних переводов: недоступные провайдеры и старые транзакции могут не отображаться. Зачисление повторно проверяется перед подтверждением.</p>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Непривязанные входящие переводы</h3>
      <div style={{ ...styles.table, marginBottom: 20 }}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: '110px 155px 0.8fr 70px 1fr 1.2fr 150px 105px', minWidth: 980 }}>
          <span>Дата обнаружения</span>
          <span>Актив / сеть</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span style={{ textAlign: 'right' }}>Подтв.</span>
          <span>Txid</span>
          <span>Зачислить пользователю</span>
          <span />
          <span />
        </div>
        {incoming.map((tr) => {
          const key = `${tr.chain}:${tr.txHash}`;
          return (
            <div key={key} id={key} className={`row-hover admin-history-grid${hash === `#${encodeURIComponent(key)}` ? ' admin-highlighted' : ''}`} style={{ ...styles.tableRow, gridTemplateColumns: '110px 155px 0.8fr 70px 1fr 1.2fr 150px 105px', minWidth: 980 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {tr.timestamp ? new Date(tr.timestamp).toLocaleString('ru-RU') : '—'}
              </span>
              <RailLabel asset={tr.asset} chain={tr.chain} />
              <span className="mono" style={{ textAlign: 'right' }}>{tr.amount}<small style={{ display: 'block' }}>{tr.status}</small></span>
              <span className="mono" style={{ textAlign: 'right' }}>{tr.confirmations}</span>
              <CopyValue value={tr.txHash} label="txid" />
              <select value={pickedUser[key] ?? ''} onChange={(e) => setPickedUser((prev) => ({ ...prev, [key]: e.target.value }))} style={styles.input}>
                <option value="">Выберите пользователя</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.email}</option>
                ))}
              </select>
              <button disabled={!pickedUser[key] || creditingKey !== null} onClick={() => handleCredit(tr)} style={styles.approveBtn}>
                {creditingKey === key ? 'Зачисление…' : 'Зачислить вручную'}
              </button>
              <button disabled={ignoringKey === key} onClick={() => handleIgnore(tr)} style={styles.neutralBtn} title="Не является депозитом — скрыть навсегда">
                {ignoringKey === key ? 'Скрытие…' : 'Игнорировать'}
              </button>
            </div>
          );
        })}
        {incomingLoaded && !incomingError && failedChains.length === 0 && incoming.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>В доступной ленте нет непривязанных переводов.</p>
        )}
        {incomingError && <p style={{ padding: 14, color: 'var(--sell)', fontSize: 12 }}>Не удалось загрузить входящие переводы.</p>}
        {failedChains.length > 0 && <p role="alert" style={styles.errorBox}>Входящие переводы загружены не полностью ({failedChains.join(', ')}). Сохранённые переводы доступны в истории. Повторите проверку позже.</p>}
        <button onClick={reloadIncoming} style={styles.neutralBtn}>Обновить входящие</button>
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
          <option value="BELOW_MINIMUM">BELOW_MINIMUM</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CREDITED">CREDITED</option>
        </select>
        <input type="date" style={{ ...styles.input, width: 160 }} value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
      </div>

      <div style={styles.table}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: '110px 1.3fr 150px 0.8fr 65px 130px 1fr 160px', minWidth: 1100 }}>
          <span>Дата</span>
          <span>Пользователь</span>
          <span>Актив / сеть</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span>Подтв.</span>
          <span>Статус</span>
          <span>Txid</span>
          <span>Действие</span>
        </div>
        {history === null && <Skeleton height={80} />}
        {filtered.map((d) => (
          <div key={d.id} className="row-hover admin-history-grid" style={{ ...styles.tableRow, gridTemplateColumns: '110px 1.3fr 150px 0.8fr 65px 130px 1fr 160px', minWidth: 1100 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(d.createdAt).toLocaleString('ru-RU')}</span>
            <span style={{ fontSize: 12 }}>{d.userEmail ?? 'Не определён'}</span>
            <RailLabel asset={d.asset} chain={d.chain} />
            <span className="mono" style={{ textAlign: 'right' }}>{d.amount}</span>
            <span className="mono">{d.confirmations}</span>
            <span style={{ fontSize: 12 }}>{d.status}</span>
            <CopyValue value={d.txHash} label="txid" />
            {d.status !== 'CREDITED' ? <div>
              {!d.userId && <select aria-label={`Пользователь ${d.txHash}`} style={styles.input}
                value={pickedUser[`${d.chain}:${d.txHash}`] ?? ''}
                onChange={e => setPickedUser(prev => ({ ...prev, [`${d.chain}:${d.txHash}`]: e.target.value }))}>
                <option value="">Выберите пользователя</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.email}</option>)}
              </select>}
              <button style={styles.approveBtn} disabled={creditingKey !== null || (!d.userId && !pickedUser[`${d.chain}:${d.txHash}`])}
                onClick={() => handleCredit(d)}>{creditingKey === `${d.chain}:${d.txHash}` ? 'Зачисление…' : 'Зачислить вручную'}</button>
            </div> : <span>—</span>}
          </div>
        ))}
        {history && filtered.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Ничего не найдено.</p>}
      </div>
    </div>
  );
}
