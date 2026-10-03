import { useState } from 'react';
import { api } from '../../lib/api';
import { getAdminKycDeliveryAbortable } from '../../lib/adminReadApi';
import { styles } from './adminStyles';
import { KycSubmissionReview } from './KycSubmissionReview';
import { useSearchParams } from 'react-router-dom';
import { useAdminRead } from './useAdminRead';

type Client = Awaited<ReturnType<typeof api.getAllClients>>[number];

/** Верификация (KYC) — очередь заявок на проверку: кто подал, когда,
 * проверено/отклонить с причиной. Документы новых заявок приходят на почту
 * администратора через Cloudflare KYC edge и на сервер биржи не попадают. */
export function AdminKycPage() {
  const [searchParams] = useSearchParams();
  const clientsRead = useAdminRead<Client[]>('kyc-clients', signal => api.getAllClients(signal));
  const clients = clientsRead.data;
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('user'));
  const deliveryRead = useAdminRead('kyc-delivery', getAdminKycDeliveryAbortable);
  const delivery = deliveryRead.data;

  const queue = (clients ?? []).filter((c) => c.latestKyc && (showAll || c.latestKyc.status === 'PENDING'));
  const selected = queue.find((c) => c.id === selectedId) ?? queue[0] ?? null;

  return (
    <div>
      <h1 style={styles.title}>Верификация (KYC)</h1>
      <div className="admin-toolbar">
        <span role="status" style={styles.hint}>
          {clientsRead.refreshing ? 'Обновляем…' : clientsRead.loading ? 'Загрузка заявок…' : clientsRead.error && clients ? 'Данные устарели' : clientsRead.updatedAt ? `Обновлено в ${new Date(clientsRead.updatedAt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Kyiv' })} · Europe/Kyiv` : 'Данные не загружены'}
        </span>
        <button type="button" style={styles.neutralBtn} disabled={clientsRead.loading || clientsRead.refreshing} onClick={() => { clientsRead.reload(); deliveryRead.reload(); }}>Обновить</button>
      </div>
      {clientsRead.error && <div role="alert" style={{ ...styles.errorBox, marginBottom: 16 }}>
        Не удалось загрузить заявки. {clients ? 'Показан последний загруженный список; данные могут быть устаревшими.' : 'Проверьте соединение и повторите загрузку.'}
      </div>}
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

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Показать все заявки, не только ожидающие проверки
      </label>

      <div className="admin-kyc-grid">
        <div style={{ ...styles.table, maxHeight: 640, overflowY: 'auto' }}>
          {queue.map((c) => (
            <button
              key={c.id}
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
              <span style={{ fontWeight: 600, fontSize: 13 }}>{c.email}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {c.latestKyc && new Date(c.latestKyc.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })} · {c.latestKyc?.status === 'PENDING' ? 'Ожидает проверки' : c.latestKyc?.status === 'APPROVED' ? 'Одобрена' : c.latestKyc?.status === 'REJECTED' ? 'Отклонена' : 'Неизвестный статус'}
              </span>
            </button>
          ))}
          {clients !== null && !clientsRead.error && queue.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Заявок нет.</p>}
        </div>

        <div style={styles.card}>
          {!selected?.latestKyc ? (
            <p style={{ color: 'var(--text-tertiary)' }}>Выберите заявку слева.</p>
          ) : (
            <KycSubmissionReview
              submission={selected.latestKyc}
              email={selected.email}
              onReviewed={() => { setSelectedId(null); clientsRead.reload(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
