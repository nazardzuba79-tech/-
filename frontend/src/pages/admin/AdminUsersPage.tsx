import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdminUsersPage, type AdminUser } from '../../lib/adminPagedApi';
import { styles } from './adminStyles';
import { useAdminRead } from './useAdminRead';
import { useAdminView } from './useAdminView';
import { AdminPagination } from './AdminPagination';
import { AdminReadStatus } from './AdminReadStatus';
import { DeleteUserDialog, canDeleteUser } from './DeleteUserDialog';
import { DepositCopyBell } from './DepositCopyBell';
import { ignoreCopySignal } from './depositCopyReviewClient';
import { adminDate } from './adminPresentation';
import { useAdminWorkSummary, refreshAdminSummary, type SummaryKey } from './adminWorkSummary';
import { Skeleton } from '../../components/Skeleton';
import './adminPracticality.css';

export const ADMIN_USERS_TIMEOUT_MS = 20_000;
const kyc: Record<string, string> = { NOT_STARTED: 'Не начата', PENDING: 'На проверке', APPROVED: 'Подтверждена', REJECTED: 'Отклонена' };
const attention: [SummaryKey, string][] = [['readyPackages', 'Пакеты к зачислению'], ['pendingPackages', 'Незачисленные пакеты'], ['unlinkedTransfers', 'Непривязанные переводы'], ['activeWithdrawals', 'Активные выводы'], ['pendingKyc', 'KYC на проверке'], ['openOtc', 'OTC-заявки']];
const unitLabels: Record<string, string> = { packages: 'пакетов', transfers: 'переводов', withdrawals: 'заявок на вывод', users: 'пользователей', submissions: 'заявок', requests: 'заявок' };
export function AdminUsersPage() {
  const { params, update, page, returnTo, scrollRef, rememberScroll, restoreScroll } = useAdminView({ deferScrollRestore: true });
  const search = params.get('search') ?? '', status = params.get('status') ?? 'all';
  const sort = params.get('sort') ?? 'createdAt', direction = params.get('direction') ?? 'desc';
  const requestedQuery = new URLSearchParams({ page: String(page), pageSize: '20', search, status, sort, direction }).toString();
  const [query, setQuery] = useState(requestedQuery);
  const settledSearch = new URLSearchParams(query).get('search') ?? '';
  useEffect(() => {
    // Search and its page reset are one request, never an intermediate read
    // for the old search on page one. Non-search navigation stays immediate.
    if (search === settledSearch) { setQuery(requestedQuery); return; }
    const timer = setTimeout(() => setQuery(requestedQuery), 250);
    return () => clearTimeout(timer);
  }, [requestedQuery, search, settledSearch]);
  const read = useAdminRead(`users:${query}`, signal => getAdminUsersPage(query, signal), { timeoutMs: ADMIN_USERS_TIMEOUT_MS });
  useEffect(() => { if (read.data && query === requestedQuery) restoreScroll(); }, [read.data, query, requestedQuery, restoreScroll]);
  const summary = useAdminWorkSummary();
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState('');
  const users = read.data?.items ?? [];
  const open = (user: AdminUser) => `/admin/users/${encodeURIComponent(user.id)}?returnTo=${encodeURIComponent(returnTo)}`;
  const changed = () => { read.reload(); refreshAdminSummary(); };
  const actions = (user: AdminUser) => <div className="admin-user-actions">
    <Link className="admin-open-button" to={open(user)}>Открыть</Link>
    {canDeleteUser(user) && <details><summary aria-label={`Дополнительные действия: ${user.email}`}>···</summary><button type="button" style={styles.rejectBtn} onClick={() => setDeleting(user)}>Удалить аккаунт</button></details>}
  </div>;
  const signals = (user: AdminUser) => <DepositCopyBell key={`${user.id}:${user.lastDepositCopy?.id ?? 'unknown'}`} userId={user.id} event={user.lastDepositCopy} failed={user.depositCopyLookupFailed}
    onIgnore={async () => { if (user.lastDepositCopy) await ignoreCopySignal(user.id, user.lastDepositCopy.id); changed(); }} />;
  const balances = (user: AdminUser) => user.balances.length ? user.balances.map(b => <div key={b.asset} className="admin-balance-pair"><strong>{b.asset}</strong><span>{b.available} доступно</span><small>{b.locked} в резерве</small></div>) : <span>—</span>;
  return <div className="admin-users-workspace">
    <h1 style={styles.title}>Пользователи</h1><p style={styles.subtitle}>Найдите пользователя или откройте очередь, которая требует решения.</p>
    <section className="admin-attention" aria-label="Требует внимания">
      <div className="admin-section-heading"><h2>Требует внимания</h2><span>Пользователей: {summary.data?.widgets.totalUsers.value ?? '—'} · новых за 24 часа: {summary.data?.widgets.newUsers24h.value ?? '—'}</span></div>
      <div className="admin-attention-grid">{attention.map(([key, label]) => {
        const widget = summary.data?.widgets[key];
        return <Link key={key} to={widget?.href ?? '#'} aria-disabled={!widget} onClick={e => { if (!widget) e.preventDefault(); }}><strong>{widget?.value ?? '—'}</strong><span>{label}</span><small>{!widget ? summary.error ? 'Не удалось получить' : 'Загрузка…' : widget.status === 'unavailable' ? 'Не удалось получить' : unitLabels[widget.unit] ?? 'записей'}</small></Link>;
      })}</div><AdminReadStatus {...summary} hasData={!!summary.data} />
    </section>
    <div className="admin-list-heading"><h2>Список пользователей</h2>{read.data && <AdminPagination page={read.data.page} totalPages={read.data.totalPages} total={read.data.total} pageSize={20} itemLabel="из" onPageChange={value => update({ page: value })} placement="top" />}</div>
    <div className="admin-toolbar admin-users-filters">
      <input aria-label="Поиск пользователей" style={styles.input} placeholder="Email или ID пользователя" value={search} onChange={e => update({ search: e.target.value, page: 1 })} />
      <select aria-label="Фильтр пользователей" style={styles.input} value={status} onChange={e => update({ status: e.target.value, page: 1 })}><option value="all">Все пользователи</option><option value="new">Новые за 24 часа</option><option value="kyc-pending">KYC на проверке</option><option value="active">Активные аккаунты</option><option value="blocked">Заблокированные</option></select>
      <select aria-label="Сортировка пользователей" style={styles.input} value={sort} onChange={e => update({ sort: e.target.value, page: 1 })}><option value="createdAt">По регистрации</option><option value="lastLoginAt">По последнему входу</option><option value="email">По email</option></select>
      <select aria-label="Порядок сортировки" style={styles.input} value={direction} onChange={e => update({ direction: e.target.value, page: 1 })}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select>
    </div><AdminReadStatus {...read} hasData={!!read.data} />
    {notice && <p role="status">{notice}</p>}{!read.data && read.loading && <Skeleton height={240} />}
    {read.data && <p className="admin-result-count">Найдено: {read.data.total}. Последний вход показывает дату авторизации, а не присутствие онлайн.</p>}
    {read.data && !users.length && <p>Никого не найдено. Измените условия поиска.</p>}
    {!!users.length && <div className="admin-table-desktop" style={styles.table} ref={scrollRef} onScroll={rememberScroll}><table className="admin-users-table"><thead><tr><th>Email / ID</th><th>Пароль</th><th>Регистрация</th><th>Последний вход</th><th>Верификация</th><th>Баланс</th><th>Действие</th></tr></thead><tbody>{users.map(user => <tr key={user.id} data-user-row={user.id}>
      <td><Link to={open(user)}>{user.email}</Link><small>{user.id}</small>{user.isBlocked && <span className="admin-state-warning">Заблокирован</span>}{signals(user)}</td>
      <td className="mono" data-user-password={user.id}>{user.password ?? '—'}</td><td>{adminDate(user.createdAt)}</td><td>{adminDate(user.lastLoginAt)}</td><td>{kyc[user.kycStatus] ?? '—'}</td><td>{balances(user)}</td><td>{actions(user)}</td>
    </tr>)}</tbody></table></div>}
    <div className="admin-table-mobile">{users.map(user => <article key={user.id} data-user-card={user.id} className="admin-user-mobile" style={styles.card}>
      <Link to={open(user)}><strong>{user.email}</strong></Link><small>{user.id}</small><dl><dt>Пароль</dt><dd className="mono">{user.password ?? '—'}</dd><dt>Регистрация</dt><dd>{adminDate(user.createdAt)}</dd><dt>Последний вход</dt><dd>{adminDate(user.lastLoginAt)}</dd><dt>Верификация</dt><dd>{kyc[user.kycStatus] ?? '—'}</dd><dt>Баланс</dt><dd>{balances(user)}</dd></dl>{signals(user)}{actions(user)}
    </article>)}</div>
    {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setNotice('Аккаунт удалён.'); setDeleting(null); changed(); }} />}
  </div>;
}
