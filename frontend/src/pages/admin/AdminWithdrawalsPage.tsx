import { useEffect, useRef, useState } from 'react';
import { api, ApiError, getToken, onSessionChange } from '../../lib/api';
import { getAdminWithdrawalsPage } from '../../lib/adminPagedApi';
import { Link } from 'react-router-dom';
import { browserClearInterval, browserSetInterval } from '../../lib/browserActivity';
import { AdminModal, CopyValue, RailLabel } from './AdminPrimitives';
import { styles } from './adminStyles';
import { useAdminRead } from './useAdminRead';
import { useAdminView } from './useAdminView';
import { AdminReadStatus } from './AdminReadStatus';
import { adminDate } from './adminPresentation';
import { refreshAdminSummary } from './adminWorkSummary';
import './adminQueueViews.css';

type Withdrawal = Awaited<ReturnType<typeof api.getAdminWithdrawals>>[number];
type Action = { kind: 'approve' | 'reject' | 'sent'; withdrawal: Withdrawal; session: string | null };

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  PENDING: { text: 'Ожидает', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  APPROVED: { text: 'Одобрено', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  SENT: { text: 'Отмечено отправленным', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  // Legacy status from before the approve -> mark-sent split — no new row
  // can get this value, but old rows may still carry it.
  COMPLETED: { text: 'Отмечено отправленным', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  REJECTED: { text: 'Отклонено', color: 'var(--sell)', bg: 'var(--sell-dim)' },
};

function statusBadge(status: string) {
  return STATUS_LABEL[status] ?? { text: 'Статус не распознан', color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' };
}

const QUEUES: Record<string, string> = { active: 'Все активные', PENDING: 'Ожидают проверки', APPROVED: 'Одобрены', processed: 'Обработанные', all: 'Все заявки' };

/** Minutes a request has been waiting. The client is told «до 60 минут». */
function waitingMinutes(createdAt: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
}

/** Вывод криптовалюты — очередь заявок: одобрить, затем отметить
 * отправленным с txid, либо отклонить с причиной. История всех обработанных
 * выводов с указанием, какой админ что сделал. */
export function AdminWithdrawalsPage() {
  const view = useAdminView();
  const search = view.params.get('search') ?? '';
  const requestedStatus = view.params.get('status') ?? 'active';
  const status = requestedStatus in QUEUES || requestedStatus in STATUS_LABEL ? requestedStatus : 'active';
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => setSearchDraft(search), [search]);
  const query = new URLSearchParams({ page: String(view.page), pageSize: '20', status, ...(search ? { search } : {}) }).toString();
  const read = useAdminRead(`withdrawals:${query}`, signal => getAdminWithdrawalsPage(query, signal));
  const withdrawals = read.data?.items ?? null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const [action, setAction] = useState<Action | null>(null);
  const [actionValue, setActionValue] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recoveryKey = action && uncertain ? `withdrawal-recovery:${action.withdrawal.id}` : 'withdrawal-recovery:idle';
  const recovery = useAdminRead(recoveryKey, signal => action && uncertain
    ? getAdminWithdrawalsPage(new URLSearchParams({ search: action.withdrawal.id, status: 'all', page: '1', pageSize: '20' }).toString(), signal)
    : Promise.resolve(null));

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
      refreshAdminSummary();
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

  const refreshedAction = action && recovery.data?.items.find(w => w.id === action.withdrawal.id);
  const resolvedUncertain = Boolean(uncertain && refreshedAction && refreshedAction.status !== action?.withdrawal.status);
  function closeAction() {
    if (mutationInFlight.current || (uncertain && !resolvedUncertain)) return;
    setAction(null);
    setError(null);
  }

  const first = read.data?.total ? (read.data.page - 1) * read.data.pageSize + 1 : 0;
  const last = read.data ? Math.min(read.data.total, first + read.data.items.length - 1) : 0;

  return (
    <div className="admin-queue-page">
      <h1 style={styles.title}>Вывод криптовалюты</h1>
      <p style={styles.subtitle}>Одобрение заявки не отправляет средства. TXID фиксирует действие оператора и не подтверждает транзакцию в сети. Время — Europe/Kyiv.</p>
      <AdminReadStatus loading={read.loading} updatedAt={read.updatedAt} hasData={read.data !== null}
        error={read.error ? `Не удалось загрузить выводы. ${read.error}${read.data ? ' Показан последний загруженный список. Данные устарели.' : ''}` : null} reload={read.reload} />
      <nav className="admin-queue-tabs" aria-label="Очереди выводов">
        {Object.entries(QUEUES).map(([key, label]) => <button type="button" key={key} style={{ ...styles.neutralBtn,
          border: `1px solid ${status === key ? 'var(--admin-brand)' : 'var(--border)'}`,
          background: status === key ? 'var(--admin-brand)' : 'var(--surface)', color: status === key ? 'var(--admin-brand-on)' : 'var(--text-primary)' }}
          aria-pressed={status === key} onClick={() => view.update({ status: key, page: 1 })}>{label}</button>)}
      </nav>
      <form className="admin-toolbar admin-queue-filters" onSubmit={event => { event.preventDefault(); view.update({ search: searchDraft.trim(), page: 1 }); }}>
        <label>Поиск<input style={styles.input} aria-label="Поиск выводов" placeholder="Email, ID, актив, адрес или TXID" maxLength={200} value={searchDraft} onChange={event => setSearchDraft(event.target.value)} /></label>
        <button type="submit" style={styles.neutralBtn}>Найти</button>
        <label>Статус<select aria-label="Статус вывода" style={styles.input} value={status} onChange={event => view.update({ status: event.target.value, page: 1 })}>
          {Object.entries(QUEUES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          {Object.entries(STATUS_LABEL).filter(([key]) => !(key in QUEUES)).map(([key, label]) => <option key={key} value={key}>{label.text}{key === 'COMPLETED' ? ' (ранее обработанные)' : ''}</option>)}
        </select></label>
        {search && <button type="button" style={styles.neutralBtn} onClick={() => view.update({ search: '', page: 1 })}>Сбросить поиск</button>}
      </form>
      <div className="admin-queue-pagination" aria-label="Страницы выводов">
        <span>{read.data ? `Заявки: ${first}–${Math.max(0, last)} из ${read.data.total}` : 'Заявки: —'}</span>
        <div><button type="button" style={styles.neutralBtn} disabled={read.loading || view.page <= 1} onClick={() => view.update({ page: view.page - 1 })}>Назад</button>
          <span>Страница {view.page}{read.data ? ` из ${Math.max(1, read.data.totalPages)}` : ''}</span>
          <button type="button" style={styles.neutralBtn} disabled={read.loading || !read.data || view.page >= read.data.totalPages} onClick={() => view.update({ page: view.page + 1 })}>Далее</button></div>
      </div>
      <div className="admin-withdrawal-list">
        <div className="admin-withdrawal-header" aria-hidden="true"><span>Пользователь</span><span>Актив / сеть</span><span>Адрес</span><span>Сумма</span><span>Статус</span><span>Создана</span><span>Следующий шаг</span></div>
        {(withdrawals ?? []).map(w => {
          const active = w.status === 'PENDING' || w.status === 'APPROVED';
          const badge = statusBadge(w.status);
          return <article key={w.id} data-withdrawal-row={w.id} className="admin-withdrawal-row row-hover" aria-label={`Заявка ${w.id}`}>
            <div className="admin-withdrawal-field"><span className="admin-withdrawal-field-label">Пользователь</span><strong>{w.userEmail}</strong>
              <small>ID: {w.userId}</small><Link to={`/admin/users/${encodeURIComponent(w.userId)}?tab=withdrawals&returnTo=${encodeURIComponent(view.returnTo)}`}>Открыть пользователя</Link></div>
            <div className="admin-withdrawal-field"><span className="admin-withdrawal-field-label">Актив / сеть</span><RailLabel asset={w.asset} chain={w.network} /></div>
            <div className="admin-withdrawal-field"><span className="admin-withdrawal-field-label">Адрес</span><CopyValue value={w.toAddress} label="адрес назначения" full /></div>
            <div className="admin-withdrawal-field"><span className="admin-withdrawal-field-label">Сумма</span><strong className="mono">{w.amount} {w.asset}</strong>
              <small>{active ? w.balanceHeld ? 'Сумма зарезервирована' : 'Без резервирования' : w.balanceHeld ? 'При создании: с резервированием' : 'При создании: без резервирования'}</small></div>
            <div className="admin-withdrawal-field"><span className="admin-withdrawal-field-label">Статус</span><span style={{ color: badge.color, background: badge.bg, borderRadius: 5, padding: '3px 6px', fontSize: 12, width: 'fit-content' }}>{badge.text}</span>
              <small>ID заявки: {w.id}</small></div>
            <div className="admin-withdrawal-field"><span className="admin-withdrawal-field-label">Создана</span><time dateTime={w.createdAt}>{adminDate(w.createdAt)}</time>
              {active && <small>В очереди {waitingMinutes(w.createdAt, now)} мин</small>}</div>
            <div className="admin-withdrawal-field"><span className="admin-withdrawal-field-label">Следующий шаг</span>
              <small>{w.status === 'PENDING' ? 'Проверить реквизиты и принять решение' : w.status === 'APPROVED' ? 'После фактической отправки записать TXID' : 'Просмотр результата'}</small>
              {active ? <div className="admin-withdrawal-actions">
                {w.status === 'PENDING' && <button type="button" disabled={busyId !== null} onClick={() => openAction('approve', w)} style={styles.approveBtn}>Одобрить</button>}
                {w.status === 'APPROVED' && <button type="button" disabled={busyId !== null} onClick={() => openAction('sent', w)} style={styles.approveBtn}>Отправлено</button>}
                <button type="button" disabled={busyId !== null} onClick={() => openAction('reject', w)} style={styles.rejectBtn}>Отклонить</button>
              </div> : <CopyValue value={w.txHash ?? w.rejectionReason} label="TXID или причина" full />}
            </div>
          </article>;
        })}
        {withdrawals?.length === 0 && !read.error && <p className="admin-empty">Заявок по выбранным условиям нет.</p>}
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
            {recovery.error && <p role="alert" style={styles.errorBox}>Не удалось перечитать заявку. Результат пока не подтверждён.</p>}
            <button type="button" style={styles.neutralBtn} disabled={recovery.loading} onClick={recovery.reload}>Проверить заявку</button>
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
