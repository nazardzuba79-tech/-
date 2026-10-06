import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdminUsersPage, type AdminUser } from '../../lib/adminPagedApi';
import { setAdminUserHidden } from '../../lib/adminUserVisibilityApi';
import { styles } from './adminStyles';
import { useAdminRead } from './useAdminRead';
import { useAdminView } from './useAdminView';
import { AdminPagination } from './AdminPagination';
import { AdminReadStatus } from './AdminReadStatus';
import { DeleteUserDialog, canDeleteUser } from './DeleteUserDialog';
import { DepositCopyBell, DepositCopyTabBell, hasPendingCopy } from './DepositCopyBell';
import { hasUnresolvedCopies, ignoreCopySignal } from './depositCopyReviewClient';
import { adminDate } from './adminPresentation';
import { formatLastLoginAt, kyivDayDifference } from './lastLoginLabel';
import { useAdminWorkSummary, refreshAdminSummary } from './adminWorkSummary';
import { Skeleton } from '../../components/Skeleton';
import './adminPracticality.css';

export const ADMIN_USERS_TIMEOUT_MS = 20_000;
// Owner (2026-10-03), as in the earlier console: verified accounts in a green pill, no verification is a dash.
// Documents waiting for review and refusals stay visible: the KYC queue depends on them.
const kycBadge: Record<string, [string, string]> = { PENDING: ['pending', 'На проверке'], APPROVED: ['approved', 'Подтверждена'], REJECTED: ['rejected', 'Отклонена'] };
const kycCell = (status: string) => kycBadge[status] ? <span className={`admin-kyc admin-kyc-${kycBadge[status][0]}`}>{kycBadge[status][1]}</span> : '—';
// «Новые за 24 часа» moved into the list as a НОВЫЙ mark beside the email; the deposits card carries the copy bell.
const indicators = [['totalUsers', 'Всего пользователей'], ['pendingPackages', 'Пополнения'], ['pendingKyc', 'Ожидают KYC']] as const;
const NEW_USER_MS = 86_400_000;
// As in the earlier console: a green dot for a login today (Kyiv calendar day), grey for older ones.
const lastLogin = (value: string | null | undefined) => {
  const at = value ? new Date(value) : null;
  const valid = at !== null && Number.isFinite(at.getTime());
  const today = valid && kyivDayDifference(at!, new Date()) === 0;
  return <span className="admin-last-login" data-logged-today={today || undefined} title={today ? 'Заходил сегодня' : undefined}>
    {valid && <i aria-hidden="true" />}{formatLastLoginAt(value ?? null)}</span>;
};
const isNewUser = (createdAt: string) => { const at = Date.parse(createdAt); return Number.isFinite(at) && Date.now() - at < NEW_USER_MS; };
// Display strings only: no floating-point conversion or rounding of balances.
const compactAmount = (value: string | null | undefined) => {
  if (value == null) return '—';
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  const [integer, decimal = ''] = value.split('.');
  const fraction = decimal.replace(/0+$/, '');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fraction ? `.${fraction}` : '');
};
export function AdminUsersPage() {
  const { params, update, page, returnTo, scrollRef, rememberScroll, restoreScroll } = useAdminView({ deferScrollRestore: true });
  const search = params.get('search') ?? '', status = params.get('status') ?? 'all';
  // No direction control: dates read newest first, email A→Z.
  const sort = params.get('sort') ?? 'createdAt', direction = sort === 'email' ? 'asc' : 'desc';
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
  const copies = useAdminRead('deposit-copy-signal', hasUnresolvedCopies);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const users = read.data?.items ?? [];
  const copySignal = copies.data === true || users.some(hasPendingCopy);
  const legacyStats: Partial<Record<string, number>> | undefined = read.data?.legacyStats;
  const open = (user: AdminUser) => `/admin/users/${encodeURIComponent(user.id)}?returnTo=${encodeURIComponent(returnTo)}`;
  const changed = () => { read.reload(); copies.reload(); refreshAdminSummary(); };
  const changeVisibility = async (user: AdminUser, hidden: boolean) => {
    if (visibilityBusy) return;
    setVisibilityBusy(user.id); setNotice('');
    try {
      await setAdminUserHidden(user.id, hidden);
      setNotice(hidden ? 'Аккаунт скрыт из админки.' : 'Аккаунт снова отображается.');
      changed();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось изменить видимость аккаунта.');
    } finally { setVisibilityBusy(null); }
  };
  const actions = (user: AdminUser) => <div className="admin-user-actions">
    {user.adminHidden ? <button type="button" className="admin-unhide-button" disabled={visibilityBusy === user.id}
      onClick={() => void changeVisibility(user, false)}>Показать снова</button> : <>
      <Link className="admin-open-button" to={open(user)}>Открыть</Link>
      <button type="button" className="admin-hide-button" disabled={visibilityBusy === user.id}
        aria-label="Скрыть аккаунт" onClick={() => void changeVisibility(user, true)}>Скрыть</button>
      {canDeleteUser(user) && <button type="button" className="admin-delete-button" style={styles.rejectBtn} aria-label="Удалить аккаунт"
        title={`Удалить аккаунт ${user.email}`} onClick={() => setDeleting(user)}>Удалить</button>}
    </>}
  </div>;
  // Owner (2026-10-03): no «Статус» column and no blocked mark; only НОВЫЙ beside the email.
  // The email is plain, selectable text so it can be copied; «Открыть» opens the profile.
  const newMark = (user: AdminUser) => isNewUser(user.createdAt) ? <span className="admin-event admin-event-new admin-user-new" data-event="new">НОВЫЙ</span> : null;
  const signals = (user: AdminUser) => <DepositCopyBell key={`${user.id}:${user.lastDepositCopy?.id ?? 'unknown'}`} userId={user.id} event={user.lastDepositCopy} failed={user.depositCopyLookupFailed}
    onIgnore={async () => { if (user.lastDepositCopy) await ignoreCopySignal(user.id, user.lastDepositCopy.id); changed(); }} />;
  const balances = (user: AdminUser) => user.balances.length ? user.balances.map(b => <div key={b.asset} className="admin-user-balance"><span><strong>{b.asset}</strong> {compactAmount(b.available)}</span>{!/^0(?:\.0+)?$/.test(b.locked ?? '') && <small>В резерве: {compactAmount(b.locked)}</small>}</div>) : <span>—</span>;
  return <div className="admin-users-workspace">
    <h1 style={styles.title}>Пользователи</h1><p style={styles.subtitle}>Поиск аккаунтов, проверка данных и управление пользователями.</p>
    <section className="admin-users-kpis" aria-label="Показатели пользователей">
      {indicators.map(([key, label]) => {
        const widget = summary.data?.widgets[key];
        const value = widget?.status === 'ready' ? widget.value : legacyStats?.[key];
        if (key !== 'pendingPackages') return <div className="admin-users-kpi" key={key}><span>{label}</span><strong>{value ?? '—'}</strong></div>;
        return <Link className="admin-users-kpi admin-users-kpi-link" key={key} data-copy-signal={copySignal || undefined}
          to={copySignal ? '/admin/deposits#copies' : '/admin/deposits'}><span>{copySignal && <DepositCopyTabBell />}{label}</span><strong>{value ?? '—'}</strong></Link>;
      })}
      {summary.error && <div className="admin-kpi-note" role="status"><span>{summary.data ? 'Показатели могли устареть.' : 'Отдельные показатели пока недоступны.'}</span><button type="button" onClick={() => summary.reload()} disabled={summary.loading}>Обновить показатели</button></div>}
    </section>
    <div className="admin-list-heading"><h2>Список пользователей</h2>{read.data && <AdminPagination page={read.data.page} totalPages={read.data.totalPages} total={read.data.total} pageSize={20} itemLabel="из" onPageChange={value => update({ page: value })} placement="top" />}</div>
    <div className="admin-toolbar admin-users-filters">
      <input aria-label="Поиск пользователей" className="admin-user-filter-control" placeholder="Email или ID пользователя" value={search} onChange={e => update({ search: e.target.value, page: 1 })} />
      <select aria-label="Фильтр пользователей" className="admin-user-filter-control" value={status} onChange={e => update({ status: e.target.value, page: 1 })}><option value="all">Все пользователи</option><option value="new">Новые за 24 часа</option><option value="kyc-pending">KYC на проверке</option><option value="hidden">Скрытые</option></select>
      <select aria-label="Сортировка пользователей" className="admin-user-filter-control" value={sort} onChange={e => update({ sort: e.target.value, page: 1 })}><option value="createdAt">По регистрации</option><option value="lastLoginAt">По последнему входу</option><option value="email">По email</option></select>
    </div>{/* Owner (2026-10-03): no refresh line or result count above the list; a failed read still offers «Повторить». */}
    {read.error && <AdminReadStatus {...read} hasData={!!read.data} />}
    {notice && <p role="status">{notice}</p>}{!read.data && read.loading && <Skeleton height={240} />}
    {read.data && !users.length && <p>Никого не найдено. Измените условия поиска.</p>}
    {!!users.length && <div className="admin-table-desktop" style={styles.table} ref={scrollRef} onScroll={rememberScroll}><table className="admin-users-table"><thead><tr><th>Email</th><th>Пароль</th><th>Регистрация</th><th>Последний вход</th><th>KYC</th><th>Баланс</th><th>Действия</th></tr></thead><tbody>{users.map(user => user.adminHidden ? <tr key={user.id} data-user-row={user.id} data-hidden-account>
      <td className="admin-user-email-cell"><span className="admin-hidden-account">Скрытый аккаунт</span><small className="admin-hidden-id">ID ·••••{user.id.slice(-6)}</small></td>
      <td>—</td><td>{user.hiddenAt ? `Скрыт ${adminDate(user.hiddenAt, true)}` : '—'}</td><td>—</td><td>—</td><td>—</td><td>{actions(user)}</td>
    </tr> : <tr key={user.id} data-user-row={user.id}>
      <td className="admin-user-email-cell"><span className="admin-user-email">{user.email}</span>{newMark(user)}{signals(user)}</td>
      <td className="mono" data-user-password={user.id}>{user.password ?? '—'}</td><td>{adminDate(user.createdAt, true)}</td><td>{lastLogin(user.lastLoginAt)}</td><td>{kycCell(user.kycStatus)}</td><td>{balances(user)}</td><td>{actions(user)}</td>
    </tr>)}</tbody></table></div>}
    <div className="admin-table-mobile">{users.map(user => user.adminHidden ? <article key={user.id} data-user-card={user.id} data-hidden-account className="admin-user-mobile" style={styles.card}>
      <strong className="admin-hidden-account">Скрытый аккаунт</strong><small className="admin-hidden-id">ID ·••••{user.id.slice(-6)}</small>
      <p className="admin-muted">{user.hiddenAt ? `Скрыт ${adminDate(user.hiddenAt, true)}` : ''}</p>{actions(user)}
    </article> : <article key={user.id} data-user-card={user.id} className="admin-user-mobile" style={styles.card}>
      <strong className="admin-user-email">{user.email}</strong>{newMark(user)}<dl><dt>Пароль</dt><dd className="mono">{user.password ?? '—'}</dd><dt>Регистрация</dt><dd>{adminDate(user.createdAt, true)}</dd><dt>Последний вход</dt><dd>{lastLogin(user.lastLoginAt)}</dd><dt>KYC</dt><dd>{kycCell(user.kycStatus)}</dd><dt>Баланс</dt><dd>{balances(user)}</dd></dl>{signals(user)}{actions(user)}
    </article>)}</div>
    {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setNotice('Аккаунт удалён.'); setDeleting(null); changed(); }} />}
  </div>;
}
