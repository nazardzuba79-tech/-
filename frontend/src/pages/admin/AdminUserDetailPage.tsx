import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { getAdminProfile, getAdminProfileBalances, getAdminHistory, type AdminProfile, type HistoryKind, type HistoryRow } from '../../lib/adminPagedApi';
import { styles } from './adminStyles';
import { Skeleton } from '../../components/Skeleton';
import { DeleteUserDialog, canDeleteUser } from './DeleteUserDialog';
import { KycSubmissionReview } from './KycSubmissionReview';
import { useAdminRead } from './useAdminRead';
import { AdminReadStatus } from './AdminReadStatus';
import { AdminPagination } from './AdminPagination';
import { CopyValue } from './AdminPrimitives';
import { adminDate, adminStatus, adminAction, maskAuditMetadata } from './adminPresentation';
import { refreshAdminSummary } from './adminWorkSummary';
import { AdminBalanceAdjustment } from './AdminBalanceAdjustment';
import { AdminAccountActions } from './AdminAccountActions';
import { AdminCompatibilityNotice, adminPageCount, adminPageEmpty } from './adminPageSupport';
import './adminPracticality.css';

const tabs = ['Общее', 'Балансы', 'Пополнения', 'Выводы', 'Ордера', 'Проверка личности', 'История действий'] as const;
type Tab = typeof tabs[number];
const histories: Partial<Record<Tab, HistoryKind>> = { Пополнения: 'deposits', Выводы: 'withdrawals', Ордера: 'orders', 'Проверка личности': 'kyc', 'История действий': 'audit' };
const tabKeys = ['overview', 'balances', 'deposits', 'withdrawals', 'orders', 'kyc', 'audit'] as const;
export function adminReturnPath(value: string | null): string {
  return value && /^\/admin\/(?:users|audit-log|kyc|deposits|withdrawals)(?:\?[^#\u0000-\u001f\u007f]*)?$/.test(value) ? value : '/admin/users';
}
export function AdminUserDetailPage() {
  const { id = '' } = useParams();
  return <AdminUserDetail key={id} id={id} />;
}
function AdminUserDetail({ id }: { id: string }) {
  const read = useAdminRead(id, signal => getAdminProfile(id, signal));
  const [params, setParams] = useSearchParams();
  const back = adminReturnPath(params.get('returnTo'));
  const tab = tabs[tabKeys.findIndex(key => key === params.get('tab'))] ?? 'Общее';
  const setTab = (name: Tab) => {
    const next = new URLSearchParams(params), key = tabKeys[tabs.indexOf(name)];
    if (key === 'overview') next.delete('tab'); else next.set('tab', key);
    setParams(next, { replace: true });
  };
  const [adjusting, setAdjusting] = useState(false), [deleting, setDeleting] = useState(false);
  const navigate = useNavigate(), detail = read.data;
  const [historyRevision, setHistoryRevision] = useState(0);
  const refreshed = () => { read.reload(); setHistoryRevision(value => value + 1); refreshAdminSummary(); };
  if (!detail) return read.error ? <div role="alert" style={styles.card}><p>{read.error}</p><button onClick={read.reload}>Повторить</button><Link to={back}>Все пользователи</Link></div> : <div aria-label="Загрузка пользователя"><Skeleton height={100} /><Skeleton height={200} /></div>;
  const accountKnown = detail.isBlocked !== null;
  const canAdjust = detail.compatibility?.mode !== 'legacy' && detail.balances !== null;
  return <div className="admin-detail-view">
    <Link to={back} className="admin-back">← Все пользователи</Link>
    <div className="admin-list-heading"><div><h1 style={styles.title}>{detail.email}</h1><CopyValue value={detail.id} label="ID пользователя" full /><p className="admin-muted">{!accountKnown ? 'Статус недоступен' : detail.isBlocked ? 'Заблокирован' : 'Активен'} · KYC: {adminStatus(detail.kycStatus)}</p></div>
      <details className="admin-user-actions"><summary>Дополнительные действия</summary><div>
        {canDeleteUser(detail) && <button onClick={() => setDeleting(true)}>Удалить аккаунт</button>}
      </div></details>
    </div>
    <AdminReadStatus {...read} hasData />
    <AdminCompatibilityNotice compatibility={detail.compatibility} />
    <div className="admin-tabs" role="tablist" aria-label="Разделы пользователя">{tabs.map(name => <button key={name} role="tab" aria-selected={tab === name} aria-controls="admin-detail-panel" onClick={() => setTab(name)}>{name}</button>)}</div>
    <div id="admin-detail-panel" role="tabpanel" aria-label={tab}>
      {tab === 'Общее' && <div className="admin-detail-overview">
        <section style={styles.card}><h2>Профиль</h2><dl className="admin-key-values">
          <dt>Роль</dt><dd>{detail.isAdmin ? 'Администратор' : 'Пользователь'}</dd>
          <dt>Регистрация</dt><dd>{adminDate(detail.createdAt)}</dd>
          <dt>Последний вход</dt><dd>{detail.lastLoginAt ? adminDate(detail.lastLoginAt) : !accountKnown ? '—' : 'Не зафиксирован'}</dd>
          <dt>Верификация</dt><dd><button className="admin-link" onClick={() => setTab('Проверка личности')}>{adminStatus(detail.kycStatus)}</button></dd>
          <dt>Учётная запись</dt><dd>{!accountKnown ? 'Статус недоступен' : detail.isBlocked ? `Заблокирована${detail.blockedReason ? `: ${detail.blockedReason}` : ''}` : 'Активна'}</dd>
          <dt>IP регистрации</dt><dd>{detail.registrationIp ?? '—'}</dd>
        </dl>{accountKnown ? <AdminAccountActions profile={detail} onChanged={refreshed} /> : <p className="admin-muted">Действия с учётной записью недоступны, пока её статус неизвестен.</p>}</section>
        <section style={styles.card}><h2>Работа с пользователем</h2><p>История загружается при открытии раздела, по 20 записей.</p>
          <div className="admin-shortcuts"><Link to={`/admin/deposits?userId=${encodeURIComponent(id)}`}>Пополнения пользователя →</Link><Link to={`/admin/withdrawals?search=${encodeURIComponent(id)}`}>Выводы пользователя →</Link><Link to={`/admin/audit-log?userId=${encodeURIComponent(id)}`}>Журнал действий →</Link></div>
          <p className="admin-muted">Время показано в Europe/Kyiv. Последний вход не означает присутствие онлайн.</p>
        </section>
      </div>}
      {tab === 'Балансы' && <ProfileBalances profile={detail} />}
      {tab === 'Пополнения' && <section style={styles.card} className="admin-deposit-adjustment" aria-label="Ручная корректировка спотового счёта">
        <button style={{ ...styles.primaryBtn, width: 'auto' }} disabled={!canAdjust} aria-describedby={canAdjust ? 'admin-adjustment-description' : 'admin-adjustment-description admin-adjustment-availability'} onClick={() => setAdjusting(true)}>Корректировка баланса</button>
        <p id="admin-adjustment-description" className="admin-muted">Ручное начисление или списание со спотового счёта. Не является подтверждением депозита.</p>
        {!canAdjust && <p id="admin-adjustment-availability" role="status">{detail.compatibility?.mode === 'legacy' ? 'Корректировка баланса недоступна на текущей версии сервера.' : 'Корректировка недоступна, пока данные спотового баланса не получены. Обновите данные пользователя.'}</p>}
      </section>}
      {histories[tab] && <AdminUserHistory key={tab} id={id} initialKind={histories[tab]!} revision={historyRevision} onChanged={refreshed} />}
    </div>
    {adjusting && canAdjust && detail.balances !== null && <AdminBalanceAdjustment key={id} profile={{ ...detail, balances: detail.balances }} onClose={() => setAdjusting(false)} onChanged={refreshed} />}
    {deleting && <DeleteUserDialog user={detail} onClose={() => setDeleting(false)} onDeleted={() => { refreshAdminSummary(); navigate(back, { replace: true }); }} />}
  </div>;
}
function ProfileBalances({ profile }: { profile: AdminProfile }) {
  // Old servers return the test balance only inside the aggregate detail route.
  // Fetch that payload only while the operator explicitly opens this tab.
  if (profile.balances === null || profile.demoBalances === null) return <LazyProfileBalances id={profile.id} />;
  return <div className="admin-detail-overview"><BalanceTable title="Спотовый счёт" rows={profile.balances} /><BalanceTable title="Тестовый счёт — отдельно" rows={profile.demoBalances} /></div>;
}
function LazyProfileBalances({ id }: { id: string }) {
  const read = useAdminRead(`balances:${id}`, signal => getAdminProfileBalances(id, signal));
  return <><AdminReadStatus {...read} hasData={!!read.data} />{read.data && <><AdminCompatibilityNotice compatibility={read.data.compatibility} /><div className="admin-detail-overview"><BalanceTable title="Спотовый счёт" rows={read.data.balances} /><BalanceTable title="Тестовый счёт — отдельно" rows={read.data.demoBalances} /></div></>}</>;
}
function BalanceTable({ title, rows }: { title: string; rows: AdminProfile['balances'] }) {
  return <section style={styles.card}><h2>{title}</h2>{rows === null ? <p>Данные баланса недоступны.</p> : !rows.length ? <p>Записей баланса нет.</p> : <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>Актив</th><th>Доступно</th><th>В резерве</th></tr></thead><tbody>{rows.map(row => <tr key={row.asset}><th>{row.asset}</th><td className="mono">{row.available}</td><td className="mono">{row.locked}</td></tr>)}</tbody></table></div>}<p className="admin-muted">Значения показаны по активам без пересчёта в общую сумму.</p></section>;
}
const orderKinds: [HistoryKind, string][] = [['orders', 'Спот'], ['futuresOrders', 'Фьючерсные ордера'], ['futuresPositions', 'Фьючерсные позиции'], ['cfdPositions', 'Позиции CFD'], ['purchases', 'Покупки']];
function AdminUserHistory({ id, initialKind, revision, onChanged }: { id: string; initialKind: HistoryKind; revision: number; onChanged: () => void }) {
  const [kind, setKind] = useState(initialKind), [page, setPage] = useState(1);
  const read = useAdminRead(`${id}:${kind}:${page}:${revision}`, signal => getAdminHistory(id, kind, page, signal));
  return <section style={styles.card}>
    {initialKind === 'orders' && <label className="admin-history-kind">Раздел <select value={kind} onChange={e => { setKind(e.target.value as HistoryKind); setPage(1); }}>{orderKinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
    <AdminReadStatus {...read} hasData={!!read.data} />
    {read.data && <><AdminCompatibilityNotice compatibility={read.data.compatibility} /><p className="admin-result-count">{adminPageCount(read.data)}</p>
      {!read.data.items.length ? <p>{adminPageEmpty(read.data, 'Записей нет.')}</p> : kind === 'kyc' ? read.data.items.map(row => <KycSubmissionReview key={row.id} submission={row as unknown as Awaited<ReturnType<typeof api.getAdminUserDetail>>['kycSubmissions'][number]} onReviewed={() => { read.reload(); onChanged(); }} />) : <div className="admin-history-list">{read.data.items.map(row => <HistoryItem key={row.id} row={row} kind={kind} />)}</div>}
      <AdminPagination page={read.data.page} totalPages={read.data.totalPages} total={read.data.total} pageSize={read.data.pageSize} compatibility={read.data.compatibility} itemLabel="из" onPageChange={setPage} /></>}
  </section>;
}
function value(row: HistoryRow, key: string): string { const item = row[key]; return typeof item === 'string' || typeof item === 'number' ? String(item) : '—'; }
function HistoryItem({ row, kind }: { row: HistoryRow; kind: HistoryKind }) {
  if (kind === 'audit') return <article className="admin-history-item"><div><strong>{adminAction(value(row, 'action'))}</strong><time>{adminDate(value(row, 'createdAt'))}</time></div><p>Кто: {value(row, 'performedByAdminEmail')} · Пользователь: {value(row, 'userEmail')}</p><details><summary>Детали действия</summary><pre>{JSON.stringify(maskAuditMetadata(row.metadata), null, 2)}</pre></details></article>;
  const position = kind === 'futuresPositions' || kind === 'cfdPositions';
  return <article className="admin-history-item"><div><strong>{value(row, 'asset') !== '—' ? value(row, 'asset') : value(row, 'pair') !== '—' ? value(row, 'pair') : value(row, 'symbol')}</strong><span>{adminStatus(value(row, 'status'))}</span><time>{adminDate(value(row, position ? 'openedAt' : 'createdAt'))}</time></div>
    <CopyValue value={row.id} label="ID записи" full />
    <dl className="admin-key-values">
      {(['deposits', 'withdrawals', 'purchases'].includes(kind)) ? <><dt>Сумма</dt><dd className="mono">{value(row, 'amount')} {value(row, 'asset')}</dd><dt>Сеть / продукт</dt><dd>{value(row, kind === 'deposits' ? 'chain' : kind === 'withdrawals' ? 'network' : 'productName')}</dd></> : <><dt>Направление</dt><dd>{adminStatus(value(row, 'side'))}</dd><dt>Количество</dt><dd className="mono">{value(row, position ? 'size' : 'originalQuantity')}</dd><dt>{position ? 'Цена входа' : 'Цена ордера'}</dt><dd className="mono">{value(row, position ? 'entryPrice' : 'price')}</dd>{!position && <><dt>Осталось</dt><dd className="mono">{value(row, 'remainingQuantity')}</dd></>}{position && <><dt>Реализованный P&L</dt><dd className="mono">{value(row, 'realizedPnl')}</dd><dt>Закрыта</dt><dd>{adminDate(value(row, 'closedAt'))}</dd></>}</>}
      {row.toAddress ? <><dt>Адрес назначения</dt><dd><CopyValue value={value(row, 'toAddress')} label="адрес" full /></dd></> : null}
      {row.txHash ? <><dt>TXID</dt><dd><CopyValue value={value(row, 'txHash')} label="TXID" full /></dd></> : null}
    </dl>
  </article>;
}
