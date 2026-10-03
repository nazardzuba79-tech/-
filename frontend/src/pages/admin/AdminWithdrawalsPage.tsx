import { useEffect, useRef, useState } from 'react';
import { api, ApiError, getToken, onSessionChange } from '../../lib/api';
import { getAdminWithdrawalsAbortable } from '../../lib/adminReadApi';
import { browserClearInterval, browserSetInterval } from '../../lib/browserActivity';
import { AdminModal, CopyValue, RailLabel } from './AdminPrimitives';
import { styles } from './adminStyles';
import { useAdminRead } from './useAdminRead';

type Withdrawal = Awaited<ReturnType<typeof api.getAdminWithdrawals>>[number];
type Action = { kind: 'approve' | 'reject' | 'sent'; withdrawal: Withdrawal; session: string | null };

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  PENDING: { text: 'Ожидает', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  APPROVED: { text: 'Одобрено', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  SENT: { text: 'Отправлено', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  // Legacy status from before the approve -> mark-sent split — no new row
  // can get this value, but old rows may still carry it.
  COMPLETED: { text: 'Отправлено', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  REJECTED: { text: 'Отклонено', color: 'var(--sell)', bg: 'var(--sell-dim)' },
};

function statusBadge(status: string) {
  return STATUS_LABEL[status] ?? { text: status, color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' };
}

const GRID = '1.1fr 155px 1fr 0.8fr 90px 120px 180px';

/** Minutes a request has been waiting. The client is told «до 60 минут». */
function waitingMinutes(createdAt: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
}

/** Вывод криптовалюты — очередь заявок: одобрить, затем отметить
 * отправленным с txid, либо отклонить с причиной. История всех обработанных
 * выводов с указанием, какой админ что сделал. */
export function AdminWithdrawalsPage() {
  const read = useAdminRead<Withdrawal[]>('withdrawals', getAdminWithdrawalsAbortable);
  const withdrawals = read.data;
  const [busyId, setBusyId] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const [action, setAction] = useState<Action | null>(null);
  const [actionValue, setActionValue] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSessionChange(() => { setAction(null); setError(null); setUncertain(false); }), []);

  // The waiting time ticks while the page is open and catches up on wake;
  // the queue itself is re-read by the admin alert that brought the admin here.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = browserSetInterval(() => setNow(Date.now()), 30_000);
    return () => browserClearInterval(timer);
  }, []);

  function openAction(kind: Action['kind'], withdrawal: Withdrawal) {
    if (mutationInFlight.current) return;
    setAction({ kind, withdrawal, session: getToken() });
    setActionValue('');
    setError(null);
    setUncertain(false);
  }

  async function confirmAction() {
    if (!action || !action.session || action.session !== getToken() || mutationInFlight.current || uncertain || (action.kind === 'sent' && !actionValue.trim())) return;
    mutationInFlight.current = true;
    setError(null);
    setBusyId(action.withdrawal.id);
    try {
      if (action.kind === 'approve') await api.approveWithdrawal(action.withdrawal.id);
      if (action.kind === 'reject') await api.rejectWithdrawal(action.withdrawal.id, actionValue.trim() || undefined);
      if (action.kind === 'sent') await api.markWithdrawalSent(action.withdrawal.id, actionValue.trim());
      if (action.session !== getToken()) return;
      setAction(null);
      read.reload();
    } catch (err) {
      if (action.session !== getToken()) return;
      const unknown = !(err instanceof ApiError) || err.status >= 500;
      setUncertain(unknown);
      setError(unknown ? 'Результат действия неизвестен. Перечитайте заявку, прежде чем предпринимать другие действия. Повторная отправка заблокирована.' : err.message);
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
  }

  const refreshedAction = action && withdrawals?.find(w => w.id === action.withdrawal.id);
  const resolvedUncertain = Boolean(uncertain && refreshedAction && refreshedAction.status !== action?.withdrawal.status);
  function closeAction() {
    if (mutationInFlight.current || (uncertain && !resolvedUncertain)) return;
    setAction(null);
    setError(null);
  }

  const visible = (withdrawals ?? []).filter(w => (!status || w.status === status) && `${w.userEmail} ${w.asset} ${w.network} ${w.toAddress}`.toLowerCase().includes(search.toLowerCase()));
  const pending = visible.filter((w) => w.status === 'PENDING' || w.status === 'APPROVED');

  return (
    <div>
      <h1 style={styles.title}>Вывод криптовалюты</h1>
      <div className="admin-toolbar">
        <span role="status" style={styles.hint}>{read.refreshing ? 'Обновляем…' : read.loading ? 'Загрузка выводов…' : read.error && withdrawals ? 'Данные устарели' : read.updatedAt ? `Обновлено в ${new Date(read.updatedAt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Kyiv' })} · Europe/Kyiv` : 'Данные не загружены'}</span>
        <button type="button" style={styles.neutralBtn} disabled={read.loading || read.refreshing} onClick={read.reload}>Обновить</button>
      </div>
      {read.error && <div role="alert" style={{ ...styles.errorBox, marginBottom: 16 }}>Не удалось загрузить выводы. {withdrawals ? 'Показан последний загруженный список; данные могут быть устаревшими.' : 'Повторите загрузку.'}</div>}

      <div className="admin-toolbar"><input style={styles.input} aria-label="Поиск выводов" placeholder="Пользователь, актив, адрес" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Статус вывода" style={styles.input} value={status} onChange={e => setStatus(e.target.value)}><option value="">Все статусы</option>{Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label.text}</option>)}</select></div>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Активные заявки</h3>
      <div style={{ ...styles.table, marginBottom: 20 }}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: GRID, minWidth: 950 }}>
          <span>Пользователь</span>
          <span>Актив / сеть</span>
          <span>Адрес</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span>Статус</span>
          <span>Создана</span>
          <span>Действие</span>
        </div>
        {pending.map((w) => (
          <div key={w.id} className="row-hover admin-history-grid" style={{ ...styles.tableRow, gridTemplateColumns: GRID, minWidth: 950 }}>
            <span style={{ fontSize: 12 }}>{w.userEmail}</span>
            <RailLabel asset={w.asset} chain={w.network} />
            <CopyValue value={w.toAddress} label="адрес назначения" />
            <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span className="mono">{w.amount}</span>
              {!w.balanceHeld && (
                <small style={{ fontSize: 10, color: 'var(--text-tertiary)' }} title="Заявка с торгового (Cross) счёта: сумма не заблокирована в балансе, одобрение и отклонение баланс не меняют.">
                  торговый счёт · без блокировки
                </small>
              )}
            </span>
            <span>
              {(() => {
                const b = statusBadge(w.status);
                return <span style={{ color: b.color, background: b.bg, borderRadius: 20, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{b.text}</span>;
              })()}
            </span>
            <span style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {new Date(w.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })}
              {(() => {
                const minutes = waitingMinutes(w.createdAt, now);
                return <small style={{ fontSize: 10, fontWeight: 600, color: minutes >= 60 ? 'var(--sell)' : 'var(--text-tertiary)' }}>ждёт {minutes} мин{minutes >= 60 ? ' · больше 60' : ''}</small>;
              })()}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {w.status === 'PENDING' && (
                <button disabled={busyId !== null} onClick={() => openAction('approve', w)} style={styles.approveBtn}>
                  Одобрить
                </button>
              )}
              {w.status === 'APPROVED' && (
                <button disabled={busyId !== null} onClick={() => openAction('sent', w)} style={styles.approveBtn}>
                  Отправлено
                </button>
              )}
              <button disabled={busyId !== null} onClick={() => openAction('reject', w)} style={styles.rejectBtn}>
                Отклонить
              </button>
            </div>
          </div>
        ))}
        {withdrawals && !read.error && pending.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Активных заявок нет.</p>
        )}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>История обработанных выводов</h3>
      <div style={styles.table}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: '110px 1.2fr 170px 0.8fr 100px 1fr', minWidth: 900 }}>
          <span>Дата</span>
          <span>Пользователь</span>
          <span>Актив</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span>Статус</span>
          <span>Txid / причина</span>
        </div>
        {visible.filter(w => w.status !== 'PENDING' && w.status !== 'APPROVED').map((w) => (
          <div key={w.id} className="row-hover admin-history-grid" style={{ ...styles.tableRow, gridTemplateColumns: '110px 1.2fr 170px 0.8fr 100px 1fr', minWidth: 900 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(w.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })}</span>
            <span style={{ fontSize: 12 }}>{w.userEmail}</span>
            <RailLabel asset={w.asset} chain={w.network} />
            <span className="mono" style={{ textAlign: 'right' }}>{w.amount}</span>
            <span>
              {(() => {
                const b = statusBadge(w.status);
                return <span style={{ color: b.color, background: b.bg, borderRadius: 20, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{b.text}</span>;
              })()}
            </span>
            <CopyValue value={w.txHash ?? w.rejectionReason} label="txid / причина" />
          </div>
        ))}
        {withdrawals?.length === 0 && !read.error && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Заявок ещё не было.</p>}
      </div>
      {action && withdrawals !== null && action.session === getToken() && <AdminModal
        title={action.kind === 'approve' ? 'Одобрить вывод' : action.kind === 'reject' ? 'Отклонить вывод' : 'Отметить отправку'}
        busy={busyId !== null || (uncertain && !resolvedUncertain)} onClose={closeAction}
      >
        <div className="admin-modal-body">
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '8px 14px', fontSize: 13 }}>
            <dt>Пользователь</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{action.withdrawal.userEmail}</dd>
            <dt>ID пользователя</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{action.withdrawal.userId}</dd>
            <dt>ID заявки</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{action.withdrawal.id}</dd>
            <dt>Сумма</dt><dd className="mono" style={{ margin: 0 }}>{action.withdrawal.amount} {action.withdrawal.asset}</dd>
            <dt>Сеть</dt><dd style={{ margin: 0 }}><RailLabel asset={action.withdrawal.asset} chain={action.withdrawal.network} /></dd>
            <dt>Адрес</dt><dd className="mono" style={{ margin: 0, overflowWrap: 'anywhere' }}>{action.withdrawal.toAddress}</dd>
          </dl>
          <p style={styles.hint}>{action.kind === 'approve'
            ? 'Одобрение меняет статус заявки. Оно не отправляет средства в сеть.'
            : action.kind === 'sent'
              ? 'Запишите TXID только после фактической отправки. Введённый TXID не является подтверждением транзакции в сети.'
              : action.withdrawal.balanceHeld
                ? 'Заявка будет отклонена; зарезервированная сумма вернётся в доступный баланс по действующим правилам.'
                : 'Заявка будет отклонена. Сумма не была зарезервирована; баланс не изменится.'}</p>
          {action.kind !== 'approve' && <label style={styles.label}>
            {action.kind === 'reject' ? 'Причина отказа (необязательно)' : 'Хэш транзакции (TXID)'}
            <input style={styles.input} autoFocus value={actionValue} disabled={busyId !== null || uncertain}
              maxLength={action.kind === 'sent' ? 256 : 500} onChange={e => setActionValue(e.target.value)} />
          </label>}
          {error && <div role="alert" style={styles.errorBox}>{error}</div>}
          {uncertain && <>
            <p role="status" style={styles.hint}>{resolvedUncertain && refreshedAction ? `Подтверждённый статус заявки: ${statusBadge(refreshedAction.status).text}.` : 'Проверьте подтверждённый статус исходной заявки. Не создавайте повторное действие.'}</p>
            {read.error && <p role="alert" style={styles.errorBox}>Не удалось перечитать заявку. Результат пока не подтверждён.</p>}
            <button type="button" style={styles.neutralBtn} disabled={read.refreshing} onClick={read.reload}>Проверить заявку</button>
          </>}
        </div>
        <footer>
          <button type="button" style={styles.neutralBtn} disabled={busyId !== null || (uncertain && !resolvedUncertain)} onClick={closeAction}>{resolvedUncertain ? 'Закрыть' : 'Отмена'}</button>
          {!uncertain && <button type="button" style={action.kind === 'reject' ? styles.rejectBtn : styles.approveBtn}
            disabled={busyId !== null || (action.kind === 'sent' && !actionValue.trim())} onClick={() => void confirmAction()}>
            {busyId ? 'Сохраняем…' : action.kind === 'approve' ? 'Подтвердить одобрение' : action.kind === 'reject' ? 'Подтвердить отклонение' : 'Сохранить TXID'}
          </button>}
        </footer>
      </AdminModal>}
    </div>
  );
}
