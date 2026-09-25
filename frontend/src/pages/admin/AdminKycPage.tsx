import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { styles } from './adminStyles';
import { KycSubmissionReview } from './KycSubmissionReview';
import { useSearchParams } from 'react-router-dom';

type Client = Awaited<ReturnType<typeof api.getAllClients>>[number];

/** Верификация (KYC) — очередь заявок на проверку: кто подал, когда,
 * документы прямо в админке, одобрить/отклонить с причиной. */
export function AdminKycPage() {
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('user'));
  const [delivery, setDelivery] = useState<{ configured: boolean; recipient: string | null } | null>(null);
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  function reload() {
    api.getAllClients().then(setClients).catch(() => {});
  }

  useEffect(reload, []);
  useEffect(() => { api.getKycDelivery().then(setDelivery).catch(() => {}); }, []);

  async function sendTest() {
    setTestState('sending');
    try { setDelivery(await api.sendKycTestEmail()); setTestState('sent'); }
    catch { setTestState('failed'); }
  }

  const queue = clients.filter((c) => c.latestKyc && (showAll || c.latestKyc.status === 'PENDING'));
  const selected = queue.find((c) => c.id === selectedId) ?? queue[0] ?? null;

  return (
    <div>
      <h1 style={styles.title}>Верификация (KYC)</h1>

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
              ? <>Копии заявок с документом приходят на почту <b>{delivery.recipient}</b>.</>
              : <>Почта для документов не настроена — копии заявок никуда не отправляются. Нужны переменные KYC_ADMIN_EMAIL и SMTP_* на сервере.</>}
            {testState === 'sent' && <> Тестовое письмо отправлено.</>}
            {testState === 'failed' && <span style={{ color: 'var(--sell)' }}> Тестовое письмо не отправилось — проверьте настройки SMTP.</span>}
          </span>
          {delivery.configured && (
            <button type="button" disabled={testState === 'sending'} onClick={sendTest} style={styles.rejectBtn}>
              {testState === 'sending' ? 'Отправка…' : 'Отправить тестовое письмо'}
            </button>
          )}
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
                {c.latestKyc && new Date(c.latestKyc.createdAt).toLocaleString('ru-RU')} · {c.latestKyc?.status}
              </span>
            </button>
          ))}
          {queue.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Заявок нет.</p>}
        </div>

        <div style={styles.card}>
          {!selected?.latestKyc ? (
            <p style={{ color: 'var(--text-tertiary)' }}>Выберите заявку слева.</p>
          ) : (
            <KycSubmissionReview
              submission={selected.latestKyc}
              email={selected.email}
              onReviewed={() => { setSelectedId(null); reload(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
