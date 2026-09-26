import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { styles } from './adminStyles';
import { KycSubmissionReview } from './KycSubmissionReview';
import { useSearchParams } from 'react-router-dom';

type Client = Awaited<ReturnType<typeof api.getAllClients>>[number];

/** Верификация (KYC) — очередь заявок на проверку: кто подал, когда,
 * проверено/отклонить с причиной. Документы новых заявок приходят на почту
 * администратора через Cloudflare KYC edge и на сервер биржи не попадают. */
export function AdminKycPage() {
  const [searchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('user'));
  const [delivery, setDelivery] = useState<{ configured: boolean; recipient: string | null } | null>(null);
  function reload() {
    api.getAllClients().then(setClients).catch(() => {});
  }

  useEffect(reload, []);
  useEffect(() => { api.getKycDelivery().then(setDelivery).catch(() => {}); }, []);

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
              ? <>Документы новых заявок приходят на почту <b>{delivery.recipient}</b> через Cloudflare — через сервер биржи они не проходят и здесь не хранятся.</>
              : <>KYC-шлюз Cloudflare сейчас недоступен — пока он не заработает, новые заявки не принимаются.</>}
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
