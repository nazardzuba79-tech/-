import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { styles } from './adminStyles';
import { RailLabel } from './AdminPrimitives';

export function AdminOverviewPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAdminOverview>> | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [clients, setClients] = useState<Awaited<ReturnType<typeof api.getAllClients>> | null>(null);
  const [incoming, setIncoming] = useState<Awaited<ReturnType<typeof api.getAdminIncomingDeposits>> | null>(null);
  const [clientsError, setClientsError] = useState(false);
  const [incomingError, setIncomingError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setClientsError(false); setIncomingError(false);
    // Provider reads must not delay the user/KYC queues or the DB summary.
    void Promise.allSettled([
      api.getAdminOverview().then(value => { if (active) setData(value); }).catch(() => { if (active) setError(true); }),
      api.getAllClients().then(value => { if (active) setClients(value); }).catch(() => { if (active) setClientsError(true); }),
      api.getAdminIncomingDeposits().then(value => { if (active) setIncoming(value); }).catch(() => { if (active) setIncomingError(true); }),
    ]).then(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const latestUsers = [...(clients ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);
  const pendingKyc = (clients ?? []).filter(c => c.latestKyc?.status === 'PENDING')
    .sort((a, b) => Date.parse(b.latestKyc!.createdAt) - Date.parse(a.latestKyc!.createdAt)).slice(0, 5);
  const latestIncoming = [...(incoming ?? [])].sort((a, b) => (Date.parse(b.timestamp ?? '') || 0) - (Date.parse(a.timestamp ?? '') || 0)).slice(0, 5);
  const metrics = [
    { label: 'Всего пользователей', value: data?.totalUsers, to: '/admin/users', note: 'Все зарегистрированные' },
    { label: 'KYC на проверке', value: data?.pendingKyc, to: '/admin/kyc', note: 'Пользователи в очереди' },
    { label: 'Выводы на проверке', value: data?.pendingWithdrawals, to: '/admin/withdrawals', note: 'Статус PENDING' },
    { label: 'Зачислено сегодня', value: data?.creditedDepositsToday, to: '/admin/deposits', note: 'Число зачислений · сутки UTC' },
  ];
  return <div>
    <div className="admin-page-heading"><div><h1 style={styles.title}>Обзор</h1><p style={styles.subtitle}>Новые пользователи и заявки — сразу к проверке</p></div><button style={styles.neutralBtn} disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Обновление…' : 'Обновить'}</button></div>
    <div className="admin-work-queues">
      <section className="admin-work-queue" aria-label="Новые пользователи">
        <header><h2>Новые пользователи</h2><Link to="/admin/users">Все →</Link></header>
        {clientsError && <p role="alert" className="admin-empty">Не удалось обновить пользователей.</p>}
        {latestUsers.map(user => <Link className="admin-queue-row" key={user.id} to={`/admin/users/${encodeURIComponent(user.id)}`}>
          <span><strong title={user.email}>{user.email}</strong><small>{new Date(user.createdAt).toLocaleString('ru-RU')}</small></span><span className="admin-queue-action">Открыть →</span>
        </Link>)}
        {!clientsError && !latestUsers.length && <p className="admin-empty">{clients ? 'Регистраций пока нет.' : 'Загрузка пользователей…'}</p>}
      </section>
      <section className="admin-work-queue" aria-label="Входящие пополнения">
        <header><h2>Входящие пополнения</h2><Link to="/admin/deposits">Все →</Link></header>
        {incomingError && <p role="alert" className="admin-empty">Лента недоступна. Повторите обновление.</p>}
        {latestIncoming.map(transfer => <Link className="admin-queue-row" key={`${transfer.chain}:${transfer.txHash}`} to={`/admin/deposits#${encodeURIComponent(`${transfer.chain}:${transfer.txHash}`)}`}>
          <RailLabel asset={transfer.asset} chain={transfer.chain} /><span><strong>{transfer.amount}</strong><small>Проверить →</small></span>
        </Link>)}
        {!incomingError && !latestIncoming.length && <p className="admin-empty">{incoming ? 'В доступной ленте новых переводов нет.' : 'Загрузка переводов…'}</p>}
        <p className="admin-queue-note">Последние доступные переводы. Перед зачислением проверьте транзакцию и получателя.</p>
      </section>
      <section className="admin-work-queue" aria-label="Верификации на проверке">
        <header><h2>Верификации · KYC</h2><Link to="/admin/kyc">Все →</Link></header>
        {clientsError && <p role="alert" className="admin-empty">Не удалось обновить заявки KYC.</p>}
        {pendingKyc.map(user => <Link className="admin-queue-row" key={user.id} to={`/admin/kyc?user=${encodeURIComponent(user.id)}`}>
          <span><strong title={user.email}>{user.email}</strong><small>{new Date(user.latestKyc!.createdAt).toLocaleString('ru-RU')}</small></span><span className="admin-queue-action">Проверить →</span>
        </Link>)}
        {!clientsError && !pendingKyc.length && <p className="admin-empty">{clients ? 'Нет заявок на проверку.' : 'Загрузка заявок…'}</p>}
      </section>
    </div>
    {error && <p role="alert" style={styles.errorBox}>Не удалось обновить сводку.{data ? ' Ниже последние полученные данные.' : ' Показатели недоступны.'}</p>}
    <div className="admin-overview-grid">{metrics.map(m => <Link key={m.label} to={m.to} className="admin-overview-metric"><span>{m.label}</span><strong>{m.value?.toLocaleString('ru-RU') ?? '—'}</strong><small>{m.note}</small></Link>)}
      <Link to="/admin/deposits" className="admin-overview-metric"><span>Непривязанные переводы</span><strong>—</strong><small>Открыть ленту провайдеров →</small></Link>
    </div>
    <p style={styles.hint}>{data ? `Данные на ${new Date(data.asOf).toLocaleString('ru-RU')}.` : 'Ожидание данных.'} Непривязанные переводы не хранятся как общая очередь в БД; проверяйте доступные сети в ленте пополнений.</p>
    {data && data.pendingWithdrawals > 0 && <section className="admin-attention"><h2>Также требуют внимания</h2>
      {data && data.pendingWithdrawals > 0 && <Link to="/admin/withdrawals"><span>Выводы · ожидают решения</span><strong>{data.pendingWithdrawals} →</strong></Link>}
    </section>}
  </div>;
}
