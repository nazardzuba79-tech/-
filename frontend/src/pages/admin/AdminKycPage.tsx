import { useEffect, useState } from 'react';
import { getAdminKycDeliveryAbortable } from '../../lib/adminReadApi';
import { getAdminClientsPage } from '../../lib/adminPagedApi';
import { styles } from './adminStyles';
import { KycSubmissionReview } from './KycSubmissionReview';
import { Link } from 'react-router-dom';
import { useAdminRead } from './useAdminRead';
import { useAdminView } from './useAdminView';
import { AdminReadStatus } from './AdminReadStatus';
import { adminDate, adminStatus } from './adminPresentation';
import { refreshAdminSummary } from './adminWorkSummary';
import { adminQueueDateBounds } from './adminQueueDates';
import './adminQueueViews.css';

const KYC_STATUSES = ['all', 'PENDING', 'APPROVED', 'REJECTED', 'NOT_STARTED'] as const;

/** Верификация (KYC) — очередь заявок на проверку: кто подал, когда,
 * проверено/отклонить с причиной. Документы новых заявок приходят на почту
 * администратора через Cloudflare KYC edge и на сервер биржи не попадают. */
export function AdminKycPage() {
  const view = useAdminView();
  const search = view.params.get('search') ?? view.params.get('user') ?? '';
  const requestedStatus = view.params.get('status');
  const status = KYC_STATUSES.find(value => value === requestedStatus) ?? (view.params.has('user') ? 'all' : 'PENDING');
  const [searchDraft, setSearchDraft] = useState(search);
  const fromDate = view.params.get('fromDate') ?? '', toDate = view.params.get('toDate') ?? '';
  const [fromDraft, setFromDraft] = useState(fromDate), [toDraft, setToDraft] = useState(toDate);
  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => { setFromDraft(fromDate); setToDraft(toDate); }, [fromDate, toDate]);
  const query = new URLSearchParams({ page: String(view.page), pageSize: '20', status, ...(search ? { search } : {}), ...adminQueueDateBounds(fromDate, toDate) }).toString();
  const clientsRead = useAdminRead(`kyc-clients:${query}`, signal => getAdminClientsPage(query, signal));
  const clients = clientsRead.data;
  const [selectedId, setSelectedId] = useState<string | null>(() => view.params.get('user'));
  useEffect(() => setSelectedId(null), [query]);
  const deliveryRead = useAdminRead('kyc-delivery', getAdminKycDeliveryAbortable);
  const delivery = deliveryRead.data;

  const queue = clients?.items ?? [];
  const selected = queue.find((c) => c.id === selectedId) ?? queue[0] ?? null;
  const first = clients?.total ? (clients.page - 1) * clients.pageSize + 1 : 0;
  const last = clients ? Math.min(clients.total, first + clients.items.length - 1) : 0;

  return (
    <div className="admin-queue-page">
      <h1 style={styles.title}>Верификация (KYC)</h1>
      <p style={styles.subtitle}>Последняя заявка каждого пользователя. История проверок доступна в карточке пользователя. Время — Europe/Kyiv.</p>
      <AdminReadStatus loading={clientsRead.loading} updatedAt={clientsRead.updatedAt} hasData={clients !== null}
        error={clientsRead.error ? `Не удалось загрузить заявки. ${clientsRead.error}${clients ? ' Показан последний загруженный список. Данные устарели.' : ''}` : null}
        reload={() => { clientsRead.reload(); deliveryRead.reload(); }} />
      {deliveryRead.error && <p role="status" style={styles.hint}>Не удалось проверить настройку доставки документов.</p>}

      {delivery && (
        <div
          data-kyc-delivery={delivery.configured ? 'on' : 'off'}
          style={{
            ...styles.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap',
            borderColor: delivery.configured ? 'var(--border)' : 'var(--sell)',
          }}
        >
          <span style={{ fontSize: 13, color: delivery.configured ? 'var(--text-primary)' : 'var(--sell)' }}>
            {delivery.configured
              ? <>Отправка документов настроена на <b>{delivery.recipient}</b> через Cloudflare. Настройка не подтверждает доставку конкретного письма.</>
              : <>Отправка документов через Cloudflare не настроена. Состояние доставки конкретной заявки проверяйте отдельно.</>}
          </span>
        </div>
      )}

      <form className="admin-toolbar admin-queue-filters" onSubmit={event => { event.preventDefault(); view.update({ search: searchDraft.trim(), user: '', fromDate: fromDraft, toDate: toDraft, page: 1 }); }}>
        <label>Пользователь<input aria-label="Поиск заявок KYC" style={styles.input} placeholder="Email или ID пользователя" maxLength={200} value={searchDraft} onChange={event => setSearchDraft(event.target.value)} /></label>
        <label>Заявка с<input aria-label="Дата заявки с" type="date" style={styles.input} value={fromDraft} max={toDraft || undefined} onChange={event => setFromDraft(event.target.value)} /></label>
        <label>По дату<input aria-label="Дата заявки по" type="date" style={styles.input} value={toDraft} min={fromDraft || undefined} onChange={event => setToDraft(event.target.value)} /></label>
        <button type="submit" style={styles.neutralBtn}>Найти</button>
        <label>Статус<select aria-label="Статус KYC" style={styles.input} value={status} onChange={event => view.update({ status: event.target.value, page: 1 })}>
          {KYC_STATUSES.map(value => <option key={value} value={value}>{value === 'all' ? 'Все пользователи' : adminStatus(value)}</option>)}
        </select></label>
        {(search || fromDate || toDate || status !== 'PENDING') && <button type="button" style={styles.neutralBtn} onClick={() => view.update({ search: '', user: '', fromDate: '', toDate: '', status: 'PENDING', page: 1 })}>Сбросить</button>}
      </form>
      <div className="admin-queue-pagination" aria-label="Страницы заявок KYC">
        <span>{clients ? `Пользователи: ${first}–${Math.max(0, last)} из ${clients.total}` : 'Пользователи: —'}</span>
        <div><button type="button" style={styles.neutralBtn} disabled={clientsRead.loading || view.page <= 1} onClick={() => view.update({ page: view.page - 1 })}>Назад</button>
          <span>Страница {view.page}{clients ? ` из ${Math.max(1, clients.totalPages)}` : ''}</span>
          <button type="button" style={styles.neutralBtn} disabled={clientsRead.loading || !clients || view.page >= clients.totalPages} onClick={() => view.update({ page: view.page + 1 })}>Далее</button></div>
      </div>

      <div className="admin-kyc-grid">
        <div style={{ ...styles.table, maxHeight: 640, overflowY: 'auto' }}>
          {queue.map((c) => (
            <button
              key={c.id}
              data-kyc-client={c.id}
              aria-pressed={selected?.id === c.id}
              onClick={() => setSelectedId(c.id)}
              className="row-hover"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                width: '100%',
                textAlign: 'left',
                background: (selected?.id === c.id) ? 'var(--panel-alt)' : 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border)',
                padding: '10px 14px',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' }}>{c.email}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {adminStatus(c.latestKyc?.status ?? c.kycStatus)} · {c.latestKyc ? adminDate(c.latestKyc.createdAt) : 'Заявка не подана'}
              </span>
            </button>
          ))}
          {clients !== null && !clientsRead.error && queue.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 13 }}>Заявок нет. По выбранным условиям пользователи не найдены.</p>}
        </div>

        <div style={styles.card}>
          {selected && <div className="admin-queue-detail-heading"><span>Следующий шаг: {selected.latestKyc?.status === 'PENDING' ? 'Проверить документ и принять решение' : selected.latestKyc ? 'Открыть историю проверки' : 'Ожидать подачи заявки'}</span>
            <Link to={`/admin/users/${encodeURIComponent(selected.id)}?tab=kyc&returnTo=${encodeURIComponent(view.returnTo)}`} style={styles.neutralBtn}>Открыть пользователя</Link>
          </div>}
          {!selected?.latestKyc ? (
            <p style={{ color: 'var(--text-tertiary)' }}>{selected ? 'У пользователя ещё нет заявки на проверку.' : 'Выберите заявку из списка.'}</p>
          ) : (
            <KycSubmissionReview
              submission={selected.latestKyc}
              email={selected.email}
              onReviewed={() => { setSelectedId(null); clientsRead.reload(); refreshAdminSummary(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
