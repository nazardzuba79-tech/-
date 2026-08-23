import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';

type Withdrawal = Awaited<ReturnType<typeof api.getAdminWithdrawals>>[number];

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

const GRID = '1.6fr 0.8fr 0.8fr 1.6fr 1fr 0.9fr 1.6fr';

/** Вывод криптовалюты — очередь заявок: одобрить, затем отметить
 * отправленным с txid, либо отклонить с причиной. История всех обработанных
 * выводов с указанием, какой админ что сделал. */
export function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.getAdminWithdrawals().then(setWithdrawals);
  }

  useEffect(reload, []);

  async function handleApprove(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await api.approveWithdrawal(id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выполнить действие.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkSent(id: string) {
    const txHash = window.prompt('Хэш транзакции (txid):');
    if (!txHash) return;
    setError(null);
    setBusyId(id);
    try {
      await api.markWithdrawalSent(id, txHash);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выполнить действие.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    const reason = window.prompt('Причина отказа (необязательно):') ?? undefined;
    setError(null);
    setBusyId(id);
    try {
      await api.rejectWithdrawal(id, reason || undefined);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выполнить действие.');
    } finally {
      setBusyId(null);
    }
  }

  const pending = (withdrawals ?? []).filter((w) => w.status === 'PENDING' || w.status === 'APPROVED');

  return (
    <div>
      <h1 style={styles.title}>Вывод криптовалюты</h1>
      {error && <div style={{ ...styles.errorBox, marginBottom: 16 }}>{error}</div>}

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Активные заявки</h3>
      <div style={{ ...styles.table, marginBottom: 32 }}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: GRID, minWidth: 980 }}>
          <span>Пользователь</span>
          <span>Актив</span>
          <span>Сеть</span>
          <span>Адрес</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span>Статус</span>
          <span />
        </div>
        {pending.map((w) => (
          <div key={w.id} style={{ ...styles.tableRow, gridTemplateColumns: GRID, minWidth: 980 }}>
            <span style={{ fontSize: 12 }}>{w.userEmail}</span>
            <span className="mono">{w.asset}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{w.network}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={w.toAddress}>{w.toAddress}</span>
            <span className="mono" style={{ textAlign: 'right' }}>{w.amount}</span>
            <span>
              {(() => {
                const b = statusBadge(w.status);
                return <span style={{ color: b.color, background: b.bg, borderRadius: 20, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{b.text}</span>;
              })()}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {w.status === 'PENDING' && (
                <button disabled={busyId === w.id} onClick={() => handleApprove(w.id)} style={styles.approveBtn}>
                  Одобрить
                </button>
              )}
              {w.status === 'APPROVED' && (
                <button disabled={busyId === w.id} onClick={() => handleMarkSent(w.id)} style={styles.approveBtn}>
                  Отправлено
                </button>
              )}
              <button disabled={busyId === w.id} onClick={() => handleReject(w.id)} style={styles.rejectBtn}>
                Отклонить
              </button>
            </div>
          </div>
        ))}
        {withdrawals && pending.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Активных заявок нет.</p>
        )}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>История обработанных выводов</h3>
      <div style={styles.table}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 1fr 1fr 1.6fr', minWidth: 900 }}>
          <span>Дата</span>
          <span>Пользователь</span>
          <span>Актив</span>
          <span style={{ textAlign: 'right' }}>Сумма</span>
          <span>Статус</span>
          <span>Txid / причина</span>
        </div>
        {withdrawals?.map((w) => (
          <div key={w.id} style={{ ...styles.tableRow, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 1fr 1fr 1.6fr', minWidth: 900 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(w.createdAt).toLocaleString('ru-RU')}</span>
            <span style={{ fontSize: 12 }}>{w.userEmail}</span>
            <span className="mono">{w.asset}</span>
            <span className="mono" style={{ textAlign: 'right' }}>{w.amount}</span>
            <span>
              {(() => {
                const b = statusBadge(w.status);
                return <span style={{ color: b.color, background: b.bg, borderRadius: 20, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{b.text}</span>;
              })()}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={w.txHash ?? w.rejectionReason ?? undefined}>
              {w.txHash ?? w.rejectionReason ?? '—'}
            </span>
          </div>
        ))}
        {withdrawals?.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Заявок ещё не было.</p>}
      </div>
    </div>
  );
}
