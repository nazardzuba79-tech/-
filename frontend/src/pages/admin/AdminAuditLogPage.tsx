import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdminAuditPage } from '../../lib/adminPagedApi';
import { styles } from './adminStyles';
import { useAdminRead } from './useAdminRead';
import { useAdminView } from './useAdminView';
import { AdminReadStatus } from './AdminReadStatus';
import { AdminPagination } from './AdminPagination';
import { CopyValue } from './AdminPrimitives';
import { adminDate, adminAction, adminStatus, ADMIN_ACTIONS, maskAuditMetadata } from './adminPresentation';
import { adminQueueDateBounds } from './adminQueueDates';
import { AdminCompatibilityNotice, adminPageCount, adminPageEmpty } from './adminPageSupport';
import { AdminFilterDisclosure } from './AdminFilterDisclosure';
import { useAdminCompact } from './useAdminCompact';
import './adminPracticality.css';

export function AdminAuditLogPage() {
  const { params, update, page, returnTo } = useAdminView();
  const compact = useAdminCompact();
  const search = params.get('search') ?? '', action = params.get('action') ?? '', userId = params.get('userId') ?? '';
  const from = params.get('from') ?? '', to = params.get('to') ?? '';
  const requestedQuery = new URLSearchParams({ page: String(page), pageSize: '20', ...(search ? { search } : {}), ...(action ? { action } : {}), ...(userId ? { userId } : {}), ...adminQueueDateBounds(from, to) }).toString();
  const [query, setQuery] = useState(requestedQuery);
  const settledSearch = new URLSearchParams(query).get('search') ?? '';
  const settledUser = new URLSearchParams(query).get('userId') ?? '';
  useEffect(() => {
    if (search === settledSearch && userId === settledUser) { setQuery(requestedQuery); return; }
    const timer = setTimeout(() => setQuery(requestedQuery), 250);
    return () => clearTimeout(timer);
  }, [requestedQuery, search, userId, settledSearch, settledUser]);
  const read = useAdminRead(`audit:${query}`, signal => getAdminAuditPage(query, signal));
  const secondaryActive = [action, userId, from, to].filter(Boolean).length;
  const secondaryHint = [action && (ADMIN_ACTIONS[action as keyof typeof ADMIN_ACTIONS] ?? action), userId && `ID ${userId}`, from && `от ${from}`, to && `до ${to}`].filter(Boolean).join(' · ');
  return <div><h1 style={styles.title}>Журнал действий</h1><p style={styles.subtitle}>Кто изменил данные, для какого пользователя и когда. Время — Europe/Kyiv.</p>
    <div className={`admin-audit-filters${compact ? ' admin-audit-filters-compact' : ''}`}><label className="admin-filter-search">Поиск<input aria-label="Поиск в журнале" placeholder="Email, ID или код действия" value={search} onChange={e => update({ search: e.target.value, page: 1 })} /></label>
      <AdminFilterDisclosure compact={compact} active={secondaryActive} hint={secondaryHint} onReset={() => update({ action: '', userId: '', from: '', to: '', page: 1 })}>
        <label>Действие<select value={action} onChange={e => update({ action: e.target.value, page: 1 })}><option value="">Все действия</option>{Object.entries(ADMIN_ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>ID пользователя<input value={userId} onChange={e => update({ userId: e.target.value, page: 1 })} /></label>
        <label>Дата от<input type="date" value={from} max={to || undefined} onChange={e => update({ from: e.target.value, page: 1 })} /></label>
        <label>Дата до<input type="date" value={to} min={from || undefined} onChange={e => update({ to: e.target.value, page: 1 })} /></label>
      </AdminFilterDisclosure>
    </div><AdminReadStatus {...read} hasData={!!read.data} />
    {read.data && <><AdminCompatibilityNotice compatibility={read.data.compatibility} /><div className="admin-list-heading"><p className="admin-result-count">{adminPageCount(read.data)}</p><AdminPagination page={read.data.page} totalPages={read.data.totalPages} total={read.data.total} pageSize={20} compatibility={read.data.compatibility} itemLabel="из" onPageChange={value => update({ page: value })} placement="top" /></div>
      {!read.data.items.length && <p>{adminPageEmpty(read.data)}</p>}
      <div className="admin-audit-list">{read.data.items.map(entry => <article key={entry.id}>
        <header><strong>{adminAction(entry.action)}</strong><time>{adminDate(entry.createdAt)}</time></header>
        <dl className="admin-key-values"><dt>Выполнил</dt><dd>{entry.performedByAdminEmail ?? 'Не указан в записи'}</dd><dt>Пользователь</dt><dd>{entry.userId ? <Link to={`/admin/users/${encodeURIComponent(entry.userId)}?returnTo=${encodeURIComponent(returnTo)}`}>{entry.userEmail ?? entry.userId}</Link> : 'Не относится к пользователю'}</dd><dt>Результат</dt><dd>{typeof entry.metadata?.status === 'string' ? adminStatus(entry.metadata.status) : entry.metadata?.success === false ? 'Ошибка' : 'Действие зарегистрировано'}</dd></dl>
        <details><summary>Детали и изменения</summary><p>Код: {entry.action}</p><CopyValue value={entry.id} label="ID действия" full /><pre>{JSON.stringify(maskAuditMetadata(entry.metadata), null, 2)}</pre></details>
      </article>)}</div></>}
  </div>;
}
