import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { styles } from './adminStyles';
import { Skeleton } from '../../components/Skeleton';

type LogEntry = Awaited<ReturnType<typeof api.getAdminAuditLog>>[number];

const GRID = '1.2fr 1.4fr 1.4fr 1.6fr 2fr';

/** Простой журнал действий — кто одобрил/отклонил/изменил и когда. Читает
 * напрямую из AuditLog, которую уже пишет каждое чувствительное admin-действие
 * (верификация, выводы, кошельки, корректировки баланса). */
export function AdminAuditLogPage() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    api.getAdminAuditLog(actionFilter ? { action: actionFilter } : undefined).then(setEntries);
  }, [actionFilter]);

  return (
    <div>
      <h1 style={styles.title}>Журнал действий</h1>

      <select style={{ ...styles.input, width: 260, marginBottom: 16 }} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
        <option value="">Все действия</option>
        <option value="KYC_APPROVED">KYC_APPROVED</option>
        <option value="KYC_REJECTED">KYC_REJECTED</option>
        <option value="WITHDRAWAL_APPROVED">WITHDRAWAL_APPROVED</option>
        <option value="WITHDRAWAL_SENT">WITHDRAWAL_SENT</option>
        <option value="WITHDRAWAL_REJECTED">WITHDRAWAL_REJECTED</option>
        <option value="TREASURY_WALLET_UPDATED">TREASURY_WALLET_UPDATED</option>
        <option value="TREASURY_WALLET_RESET">TREASURY_WALLET_RESET</option>
        <option value="BALANCE_ADJUSTED">BALANCE_ADJUSTED</option>
        <option value="USER_REGISTERED">USER_REGISTERED</option>
      </select>

      <div style={styles.table}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: GRID, minWidth: 900 }}>
          <span>Дата</span>
          <span>Действие</span>
          <span>Пользователь</span>
          <span>Выполнил</span>
          <span>Детали</span>
        </div>
        {entries === null && <Skeleton height={80} />}
        {entries?.map((e) => (
          <div key={e.id} style={{ ...styles.tableRow, gridTemplateColumns: GRID, minWidth: 900 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(e.createdAt).toLocaleString('ru-RU')}</span>
            <span className="mono" style={{ fontSize: 12 }}>{e.action}</span>
            <span style={{ fontSize: 12 }}>{e.userEmail ?? '—'}</span>
            <span style={{ fontSize: 12 }}>{e.performedByAdminEmail ?? '—'}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={JSON.stringify(e.metadata)}>
              {JSON.stringify(e.metadata)}
            </span>
          </div>
        ))}
        {entries?.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Записей нет.</p>}
      </div>
    </div>
  );
}
