import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { styles } from './adminStyles';
import { Badge } from '../../components/Badge';
import { SkeletonRow } from '../../components/Skeleton';
import { AdminStatCard } from './AdminStatCard';
import { AdminPagination } from './AdminPagination';
import { AdminToastContainer, useAdminToasts } from './AdminToast';
import { UsersIcon, ActivityIcon, ClockIcon, MoreHorizontalIcon, EyeIcon, PauseCircleIcon, BanIcon } from './AdminIcons';
import { useAdminUserActivity, type AdminPendingDeposit } from './adminUserActivity';
import { CreditDepositDrawer, addDecimalStrings } from './CreditDepositDrawer';
import { formatLastLoginAt } from './lastLoginLabel';

type User = Awaited<ReturnType<typeof api.getAdminUsers>>[number];

const KYC_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  NOT_STARTED: { text: 'Не начата', color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' },
  PENDING: { text: 'На проверке', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  APPROVED: { text: 'Подтверждена', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  REJECTED: { text: 'Отклонена', color: 'var(--sell)', bg: 'var(--sell-dim)' },
};

const PAGE_SIZE = 20;
// Email · Событие · Регистрация · Посл. вход · Верификация · Баланс · Действие.
// Blocked users get a badge next to their email, as the ADMIN badge does.
const GRID = 'minmax(0,1.7fr) minmax(0,1.25fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.2fr) 150px';
const TABLE_MIN_WIDTH = 1000;
type Tab = 'all' | 'new' | 'deposits' | 'kyc';
/** Pending deposit rows: a faint gold wash. New registrations: a faint violet one. */
const ROW_TINT = { deposit: 'rgba(240, 201, 100, 0.08)', fresh: 'rgba(99, 102, 241, 0.06)' } as const;
const AVATAR_COLORS = ['#4f46e5', '#039855', '#0284c7', '#dc6803', '#e11d48', '#7c3aed', '#0e7490', '#475467'];
// A deposit credited within this window still counts as "new" for the
// highlight in the Баланс column.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Keep the green activity dot on the existing rolling 24-hour window.
// Only the displayed label uses Kyiv calendar dates.
function LastSeenBadge({ lastLoginAt }: { lastLoginAt: string | null }) {
  const now = new Date();
  const login = lastLoginAt ? new Date(lastLoginAt) : null;
  const recent = login !== null && Number.isFinite(login.getTime()) && now.getTime() - login.getTime() <= ONE_DAY_MS;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: lastLoginAt === null ? 'var(--text-tertiary)' : recent ? 'var(--buy)' : 'var(--text-tertiary)',
          flex: 'none',
        }}
      />
      {formatLastLoginAt(lastLoginAt, now)}
    </span>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))} мин. назад`;
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.floor(hours / 24)} дн. назад`;
}

/** A long address breaks after «@» rather than mid-word, and is never cut off. */
function EmailText({ email }: { email: string }) {
  const at = email.indexOf('@');
  return at < 0 ? <>{email}</> : <>{email.slice(0, at + 1)}<wbr />{email.slice(at + 1)}</>;
}

function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

/** Все зарегистрированные пользователи биржи: KPI-сводка, поиск/фильтры,
 * таблица (карточки на мобильных) со сменой блокировки прямо из списка. */
export function AdminUsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [recentDeposits, setRecentDeposits] = useState<Map<string, { amount: string; asset: string; createdAt: string }>>(new Map());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [crediting, setCrediting] = useState<{ deposit: AdminPendingDeposit; user: User } | null>(null);
  const { toasts, push, dismiss } = useAdminToasts();
  const navigate = useNavigate();
  // The only recurring read on this page: counts + pending deposits, every
  // ~25 s while visible, nothing while hidden (see adminUserActivity.ts).
  const { activity, refresh: refreshActivity } = useAdminUserActivity();

  const loadUsers = useCallback(() => {
    api
      .getAdminUsers()
      .then((next) => { setUsers(next); setLoadError(false); })
      .catch(() => setLoadError(true));
    // The server returns only the newest deposit per user from the last 24h.
    // Do not download the full admin deposit history just to paint badges.
    api
      .getAdminRecentDepositsByUser()
      .then((deposits) => {
        const map = new Map<string, { amount: string; asset: string; createdAt: string }>();
        for (const d of deposits) map.set(d.userId, { amount: d.amount, asset: d.asset, createdAt: d.createdAt });
        setRecentDeposits(map);
      })
      .catch(() => {});
  }, []);

  useEffect(loadUsers, [loadUsers]);

  // The user list is re-read only when the activity read says something the
  // loaded list cannot know: a new registration (total changed) or a pending
  // deposit that appeared or was resolved (balances). Never on a timer.
  const signature = activity ? `${activity.totalUsers}|${activity.pendingDeposits.map((d) => d.id).join(',')}` : null;
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (lastSignature.current !== null && lastSignature.current !== signature) loadUsers();
    lastSignature.current = signature;
  }, [signature, loadUsers]);

  const pendingByUser = useMemo(() => {
    const map = new Map<string, AdminPendingDeposit[]>();
    for (const d of activity?.pendingDeposits ?? []) map.set(d.userId, [...(map.get(d.userId) ?? []), d]);
    return map;
  }, [activity]);

  const now = Date.now();
  const isNew = (u: User) => now - new Date(u.createdAt).getTime() <= ONE_DAY_MS;
  const hasPending = (u: User) => pendingByUser.has(u.id);

  // Work first: deposits waiting for an admin, then new registrations, then
  // everyone else — newest first inside each group.
  const ordered = useMemo(() => {
    const rank = (u: User) => (pendingByUser.has(u.id) ? 0 : isNew(u) ? 1 : 2);
    const at = (u: User) => {
      const pending = pendingByUser.get(u.id);
      return pending ? Math.max(...pending.map((d) => new Date(d.createdAt).getTime())) : new Date(u.createdAt).getTime();
    };
    return [...(users ?? [])].sort((a, b) => rank(a) - rank(b) || at(b) - at(a));
  }, [users, pendingByUser]);

  const matchesTab = (u: User) => tab === 'all' || (tab === 'new' ? isNew(u) : tab === 'deposits' ? hasPending(u) : u.kycStatus === 'PENDING');
  const list = ordered.filter(u => u.email.toLowerCase().includes(search.toLowerCase()) && (!filter || (filter === 'blocked' ? u.isBlocked : u.kycStatus === filter)) && matchesTab(u));
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const counts = useMemo(() => {
    const all = users ?? [];
    return {
      new: all.filter(isNew).length,
      deposits: all.filter((u) => pendingByUser.has(u.id)).length,
      kyc: all.filter((u) => u.kycStatus === 'PENDING').length,
    };
  }, [users, pendingByUser]);

  // Amounts are summed per asset only — different assets are never added together.
  const pendingByAsset = useMemo(() => {
    const sums = new Map<string, string>();
    for (const d of activity?.pendingDeposits ?? []) sums.set(d.asset, addDecimalStrings(sums.get(d.asset) ?? '0', d.amount) ?? d.amount);
    return [...sums].map(([asset, amount]) => `${amount} ${asset}`).join(' · ');
  }, [activity]);

  async function handleBlock(u: User) {
    const reason = window.prompt(`Причина блокировки ${u.email}:`);
    if (reason === null) return;
    await api.blockUser(u.id, reason);
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, isBlocked: true, blockedReason: reason } : x)) ?? prev);
    push(`${u.email} заблокирован`, 'warning');
  }

  async function handleUnblock(u: User) {
    await api.unblockUser(u.id);
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, isBlocked: false } : x)) ?? prev);
    push(`${u.email} разблокирован`);
  }

  function openCredit(u: User) {
    const pending = pendingByUser.get(u.id);
    if (pending?.length) setCrediting({ deposit: pending[0], user: u });
  }

  function creditDone(status: string) {
    if (!crediting) return;
    if (status === 'CREDITED') {
      push(`Зачислено +${crediting.deposit.amount} ${crediting.deposit.asset} — ${crediting.user.email}`);
      setCrediting(null);
    }
    // The activity read drops the credited deposit; its signature change re-reads the users (balances).
    void refreshActivity();
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'all', label: 'Все' },
    { key: 'new', label: 'Новые', count: counts.new },
    { key: 'deposits', label: 'Пополнения', count: counts.deposits },
    { key: 'kyc', label: 'KYC', count: counts.kyc },
  ];

  return (
    <div>
      <h1 style={styles.title}>Пользователи</h1>
      <p style={styles.subtitle}>Управление и мониторинг всех зарегистрированных пользователей биржи.</p>

      {(users || activity) && (
        <div style={{ ...styles.statGrid, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }} className="admin-user-stats admin-user-stats-4">
          <AdminStatCard label="Всего пользователей" value={(activity?.totalUsers ?? users?.length ?? 0).toLocaleString('ru-RU')} sub="Зарегистрировано" icon={UsersIcon} accent="brand" />
          <AdminStatCard label="Новые регистрации" value={(activity?.newUsers24h ?? counts.new).toLocaleString('ru-RU')} sub="За последние 24 часа" icon={ActivityIcon} accent="brand" />
          <AdminStatCard
            label="Ожидают зачисления"
            value={(activity?.pendingDeposits.length ?? 0).toLocaleString('ru-RU')}
            sub={activity === null ? 'Загрузка…' : pendingByAsset || 'Нет пополнений в очереди'}
            icon={ClockIcon}
            accent="warning"
          />
          <AdminStatCard label="Ожидают верификации" value={(activity?.pendingKyc ?? counts.kyc).toLocaleString('ru-RU')} sub="KYC на проверке" icon={ClockIcon} accent="warning" />
        </div>
      )}

      <div className="admin-user-tabs" role="tablist" aria-label="Быстрые фильтры">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-user-tab={t.key}
            className={tab === t.key ? 'active' : undefined}
            onClick={() => { setTab(t.key); setPage(1); }}
          >
            {t.label}{t.count !== undefined && <span className="admin-user-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="admin-toolbar"><input aria-label="Поиск пользователей" style={styles.input} placeholder="Email пользователя" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /><select aria-label="Фильтр пользователей" style={styles.input} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="">Все пользователи</option><option value="PENDING">KYC на проверке</option><option value="blocked">Заблокированные</option></select></div>
      {loadError && <p role="alert" style={styles.errorBox}>Не удалось загрузить пользователей. Обновите страницу.</p>}
      <div style={styles.table} className="admin-table-desktop">
        <div style={{ ...styles.tableHeader, gridTemplateColumns: GRID, minWidth: TABLE_MIN_WIDTH }}>
          <span>Email</span>
          <span>Событие</span>
          <span>Регистрация</span>
          <span>Посл. вход</span>
          <span>Верификация</span>
          <span style={styles.balanceHeaderCell}>Баланс</span>
          <span style={{ textAlign: 'right' }}>Действие</span>
        </div>
        {users === null && (
          <>
            <SkeletonRow columns={[1.7, 1.25, 0.8, 1, 0.9, 1.2]} />
            <SkeletonRow columns={[1.7, 1.25, 0.8, 1, 0.9, 1.2]} />
            <SkeletonRow columns={[1.7, 1.25, 0.8, 1, 0.9, 1.2]} />
          </>
        )}
        {paged.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            events={eventsFor(u, isNew(u), pendingByUser.get(u.id), recentDeposits.get(u.id))}
            onOpen={() => navigate(`/admin/users/${u.id}`)}
            onCredit={openCredit}
            onBlock={handleBlock}
            onUnblock={handleUnblock}
          />
        ))}
        {users && list.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{tab === 'all' && !search && !filter ? 'Пользователей пока нет.' : 'Никого не найдено.'}</p>}
      </div>

      <div className="admin-table-mobile" style={{ display: 'grid', gap: 12 }}>
        {paged.map((u) => (
          <MobileUserCard
            key={u.id}
            user={u}
            events={eventsFor(u, isNew(u), pendingByUser.get(u.id), recentDeposits.get(u.id))}
            onOpen={() => navigate(`/admin/users/${u.id}`)}
            onCredit={openCredit}
            onBlock={handleBlock}
            onUnblock={handleUnblock}
          />
        ))}
      </div>

      {users && list.length > 0 && (
        <AdminPagination page={safePage} totalPages={totalPages} total={list.length} pageSize={PAGE_SIZE} itemLabel="из" onPageChange={setPage} />
      )}

      {crediting && (
        <CreditDepositDrawer
          deposit={crediting.deposit}
          email={crediting.user.email}
          available={crediting.user.balances.find((b) => b.asset === crediting.deposit.asset)?.available ?? '0'}
          onClose={() => setCrediting(null)}
          onDone={creditDone}
        />
      )}

      <AdminToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function balanceSummary(u: User): string {
  const nonZero = u.balances.filter((b) => Number(b.available) > 0 || Number(b.locked) > 0);
  return nonZero.length === 0 ? '—' : nonZero.map((b) => `${b.available} ${b.asset}`).join(', ');
}

type RecentDeposit = { amount: string; asset: string; createdAt: string } | undefined;

/** What happened to this user, as the СОБЫТИЕ column shows it. */
interface UserEvents {
  fresh: boolean;
  pending: AdminPendingDeposit[];
  /** The newest deposit of the last 24h, when it is no longer waiting — i.e. credited. */
  credited: RecentDeposit;
}

function eventsFor(u: User, fresh: boolean, pending: AdminPendingDeposit[] | undefined, recent: RecentDeposit): UserEvents {
  const waiting = pending ?? [];
  // Deposit statuses are PENDING, BELOW_MINIMUM or CREDITED: the newest recent
  // deposit that is not in the waiting list has been credited.
  const credited = recent && !waiting.some((d) => d.createdAt === recent.createdAt && d.amount === recent.amount) ? recent : undefined;
  return { fresh, pending: waiting, credited };
}

function rowTint(e: UserEvents): string | undefined {
  return e.pending.length ? ROW_TINT.deposit : e.fresh ? ROW_TINT.fresh : undefined;
}

function EventBadges({ user, events }: { user: User; events: UserEvents }) {
  const first = events.pending[0];
  return (
    <span className="admin-user-events" data-user-events={user.id}>
      {events.fresh && <span className="admin-event admin-event-new" data-event="new">НОВЫЙ</span>}
      {first && (
        <span className="admin-event admin-event-deposit" data-event="deposit" title={`${first.status} · ${relativeTime(first.createdAt)}`}>
          ПОПОЛНЕНИЕ <b className="mono">+{first.amount} {first.asset}</b>
          {events.pending.length > 1 && <span> · ещё {events.pending.length - 1}</span>}
        </span>
      )}
      {!first && events.credited && (
        <span className="admin-event admin-event-credited" data-event="credited" title={relativeTime(events.credited.createdAt)}>
          ЗАЧИСЛЕНО <b className="mono">+{events.credited.amount} {events.credited.asset}</b>
        </span>
      )}
      {!events.fresh && !first && !events.credited && <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
    </span>
  );
}

function CreditButton({ user, events, onCredit }: { user: User; events: UserEvents; onCredit: (u: User) => void }) {
  if (!events.pending.length) return null;
  return (
    <button type="button" data-credit-user={user.id} className="admin-credit-btn" onClick={(e) => { e.stopPropagation(); onCredit(user); }}>
      Зачислить
    </button>
  );
}

function UserRow({
  user: u,
  events,
  onOpen,
  onCredit,
  onBlock,
  onUnblock,
}: {
  user: User;
  events: UserEvents;
  onOpen: () => void;
  onCredit: (u: User) => void;
  onBlock: (u: User) => void;
  onUnblock: (u: User) => void;
}) {
  const badge = KYC_LABEL[u.kycStatus] ?? KYC_LABEL.NOT_STARTED;
  return (
    <div
      className="row-hover"
      data-user-row={u.id}
      data-row-tint={events.pending.length ? 'deposit' : events.fresh ? 'new' : undefined}
      style={{ ...styles.tableRow, gridTemplateColumns: GRID, minWidth: TABLE_MIN_WIDTH, cursor: 'pointer', background: rowTint(events) }}
      onClick={onOpen}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ ...styles.avatarCircle, width: 30, height: 30, fontSize: 11, background: avatarColor(u.email), flex: 'none' }}>{initials(u.email)}</span>
        <span className="admin-user-email" title={u.email}>
          <span style={{ fontWeight: 600 }}><EmailText email={u.email} /></span>
          {u.isAdmin && (
            <span style={{ marginLeft: 6 }}>
              <Badge text="ADMIN" color="var(--admin-brand)" bg="var(--admin-brand-dim)" />
            </span>
          )}
          {u.isBlocked && (
            <span style={{ marginLeft: 6 }}>
              <Badge text="Заблокирован" color="var(--sell)" bg="var(--sell-dim)" />
            </span>
          )}
        </span>
      </span>
      <EventBadges user={u} events={events} />
      <span style={{ color: 'var(--text-secondary)' }}>{new Date(u.createdAt).toLocaleDateString('ru-RU')}</span>
      <LastSeenBadge lastLoginAt={u.lastLoginAt} />
      <span>
        <Badge text={badge.text} color={badge.color} bg={badge.bg} />
      </span>
      <span className="mono" style={{ ...styles.balanceCell, fontSize: 12 }}>
        <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{balanceSummary(u)}</span>
      </span>
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        <CreditButton user={u} events={events} onCredit={onCredit} />
        <ActionsMenu user={u} onOpen={onOpen} onBlock={onBlock} onUnblock={onUnblock} />
      </span>
    </div>
  );
}

function MobileUserCard({
  user: u,
  events,
  onOpen,
  onCredit,
  onBlock,
  onUnblock,
}: {
  user: User;
  events: UserEvents;
  onOpen: () => void;
  onCredit: (u: User) => void;
  onBlock: (u: User) => void;
  onUnblock: (u: User) => void;
}) {
  const badge = KYC_LABEL[u.kycStatus] ?? KYC_LABEL.NOT_STARTED;
  return (
    <div className="admin-card-hover" data-user-card={u.id} style={{ ...styles.card, background: rowTint(events) ?? styles.card.background }} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ ...styles.avatarCircle, background: avatarColor(u.email) }}>{initials(u.email)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{new Date(u.createdAt).toLocaleDateString('ru-RU')}</div>
        </div>
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CreditButton user={u} events={events} onCredit={onCredit} />
          <ActionsMenu user={u} onOpen={onOpen} onBlock={onBlock} onUnblock={onUnblock} />
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {u.isBlocked && <Badge text="Заблокирован" color="var(--sell)" bg="var(--sell-dim)" />}
        <Badge text={badge.text} color={badge.color} bg={badge.bg} />
        {u.isAdmin && <Badge text="ADMIN" color="var(--admin-brand)" bg="var(--admin-brand-dim)" />}
        <EventBadges user={u} events={events} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12 }}>
        <LastSeenBadge lastLoginAt={u.lastLoginAt} />
        <span className="mono" style={{ ...styles.balanceCell, alignItems: 'flex-end' }}>
          <span style={{ fontWeight: 600 }}>{balanceSummary(u)}</span>
        </span>
      </div>
    </div>
  );
}

function ActionsMenu({ user, onOpen, onBlock, onUnblock }: { user: User; onOpen: () => void; onBlock: (u: User) => void; onUnblock: (u: User) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen((o) => !o)} style={styles.actionsMenuBtn} className="admin-nav-link" aria-label="Действия">
        <MoreHorizontalIcon size={17} />
      </button>
      {open && (
        <div className="admin-dropdown-in" style={styles.filterMenu}>
          <button
            style={{ ...styles.filterMenuItem, display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          >
            <EyeIcon size={15} /> Профиль
          </button>
          {user.isBlocked ? (
            <button
              style={{ ...styles.filterMenuItem, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--buy)' }}
              onClick={() => {
                setOpen(false);
                onUnblock(user);
              }}
            >
              <PauseCircleIcon size={15} /> Разблокировать
            </button>
          ) : (
            <button
              style={{ ...styles.filterMenuItem, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sell)' }}
              onClick={() => {
                setOpen(false);
                onBlock(user);
              }}
            >
              <BanIcon size={15} /> Заблокировать
            </button>
          )}
        </div>
      )}
    </div>
  );
}
