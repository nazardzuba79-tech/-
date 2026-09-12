import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { styles } from './adminStyles';

export function AdminOverviewPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAdminOverview>> | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  async function reload() {
    setLoading(true); setError(false);
    try { setData(await api.getAdminOverview()); } catch { setError(true); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  const metrics = [
    { label: 'Всего пользователей', value: data?.totalUsers, to: '/admin/users', note: 'Все зарегистрированные' },
    { label: 'KYC на проверке', value: data?.pendingKyc, to: '/admin/kyc', note: 'Пользователи в очереди' },
    { label: 'Выводы на проверке', value: data?.pendingWithdrawals, to: '/admin/withdrawals', note: 'Статус PENDING' },
    { label: 'Зачислено сегодня', value: data?.creditedDepositsToday, to: '/admin/deposits', note: 'Число зачислений · сутки UTC' },
  ];
  return <div>
    <div className="admin-page-heading"><div><h1 style={styles.title}>Обзор</h1><p style={styles.subtitle}>Операционная сводка VOLTEX</p></div><button style={styles.neutralBtn} disabled={loading} onClick={reload}>{loading ? 'Обновление…' : 'Обновить'}</button></div>
    {error && <p role="alert" style={styles.errorBox}>Не удалось обновить сводку.{data ? ' Ниже последние полученные данные.' : ' Показатели недоступны.'}</p>}
    <div className="admin-overview-grid">{metrics.map(m => <Link key={m.label} to={m.to} className="admin-overview-metric"><span>{m.label}</span><strong>{m.value?.toLocaleString('ru-RU') ?? '—'}</strong><small>{m.note}</small></Link>)}
      <Link to="/admin/deposits" className="admin-overview-metric"><span>Непривязанные переводы</span><strong>—</strong><small>Открыть ленту провайдеров →</small></Link>
    </div>
    <p style={styles.hint}>{data ? `Данные на ${new Date(data.asOf).toLocaleString('ru-RU')}.` : 'Ожидание данных.'} Непривязанные переводы не хранятся как общая очередь в БД; проверяйте доступные сети в ленте пополнений.</p>
    <section className="admin-attention"><h2>Требуют внимания</h2>
      {data && data.pendingKyc > 0 && <Link to="/admin/kyc"><span>KYC · ожидают проверки</span><strong>{data.pendingKyc} →</strong></Link>}
      {data && data.pendingWithdrawals > 0 && <Link to="/admin/withdrawals"><span>Выводы · ожидают решения</span><strong>{data.pendingWithdrawals} →</strong></Link>}
      {data && data.pendingKyc === 0 && data.pendingWithdrawals === 0 && <p className="admin-empty">Нет ожидающих KYC и выводов. Входящие переводы проверяются отдельно.</p>}
      {!data && <p className="admin-empty">{error ? 'Очереди недоступны.' : 'Загрузка очередей…'}</p>}
    </section>
    <section className="admin-attention"><h2>Операции со средствами</h2><Link to="/admin/wallets"><span>Адреса пополнения</span><small>Актив → сеть → публичный адрес →</small></Link><Link to="/admin/deposits"><span>Входящие переводы и зачисления</span><small>Проверка и сопоставление →</small></Link><Link to="/admin/audit-log"><span>Журнал действий</span><small>История изменений →</small></Link></section>
  </div>;
}
