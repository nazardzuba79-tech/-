import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { styles } from './adminStyles';
import { Badge } from '../../components/Badge';
import { SkeletonRow } from '../../components/Skeleton';
import { AdminStatCard } from './AdminStatCard';
import { AdminPagination } from './AdminPagination';
import { AdminToastContainer, useAdminToasts } from './AdminToast';
import { UsersIcon, ActivityIcon, ClockIcon, MoreHorizontalIcon, EyeIcon, PauseCircleIcon, BanIcon } from './AdminIcons';

type User = Awaited<ReturnType<typeof api.getAdminUsers>>[number];

const KYC_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  NOT_STARTED: { text: 'Не начата', color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' },
  PENDING: { text: 'На проверке', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  APPROVED: { text: 'Подтверждена', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  REJECTED: { text: 'Отклонена', color: 'var(--sell)', bg: 'var(--sell-dim)' },
};

const PAGE_SIZE = 20;
const GRID = '1.7fr 0.9fr 0.9fr 0.9fr 0.9fr 1.1fr 44px';
const AVATAR_COLORS = ['#4f46e5', '#039855', '#0284c7', '#dc6803', '#e11d48', '#7c3aed', '#0e7490', '#475467'];

function lastSeenLabel(lastLoginAt: string | null): string {
  if (!lastLoginAt) return '—';
  const days = Math.floor((Date.now() - new Date(lastLoginAt).getTime()) / 86_400_000);
  if (days <= 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return `${days} дн. назад`;
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
  const [page, setPage] = useState(1);
  const { toasts, push, dismiss } = useAdminToasts();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .getAdminUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const list = users ?? [];
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const stats = useMemo(() => {
    if (!users) return null;
    const total = users.length;
    const active = users.filter((u) => !u.isBlocked).length;
    const pending = users.filter((u) => u.kycStatus === 'PENDING').length;
    return { total, active, pending };
  }, [users]);

  function pct(n: number, total: number): string {
    return total === 0 ? '0' : ((n / total) * 100).toFixed(1);
  }

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

  return (
    <div>
      <h1 style={styles.title}>Пользователи</h1>
      <p style={styles.subtitle}>Управление и мониторинг всех зарегистрированных пользователей биржи.</p>

      {stats && (
        <div style={styles.statGrid}>
          <AdminStatCard label="Всего пользователей" value={stats.total.toLocaleString('ru-RU')} sub="Зарегистрировано" icon={UsersIcon} accent="brand" />
          <AdminStatCard label="Активные" value={stats.active.toLocaleString('ru-RU')} sub={`${pct(stats.active, stats.total)}% пользователей`} icon={ActivityIcon} accent="brand" />
          <AdminStatCard label="Ожидают верификации" value={stats.pending.toLocaleString('ru-RU')} sub="Требуют внимания" icon={ClockIcon} accent="warning" />
        </div>
      )}

      <div style={styles.table} className="admin-table-desktop">
        <div style={{ ...styles.tableHeader, gridTemplateColumns: GRID, minWidth: 900 }}>
          <span>Email</span>
          <span>Регистрация</span>
          <span>Посл. вход</span>
          <span>Верификация</span>
          <span>Статус</span>
          <span>Баланс</span>
          <span />
        </div>
        {users === null && (
          <>
            <SkeletonRow columns={[1.7, 0.9, 0.9, 0.9, 0.9, 1.1]} />
            <SkeletonRow columns={[1.7, 0.9, 0.9, 0.9, 0.9, 1.1]} />
            <SkeletonRow columns={[1.7, 0.9, 0.9, 0.9, 0.9, 1.1]} />
          </>
        )}
        {paged.map((u) => (
          <UserRow key={u.id} user={u} onOpen={() => navigate(`/admin/users/${u.id}`)} onBlock={handleBlock} onUnblock={handleUnblock} />
        ))}
        {users && list.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Пользователей пока нет.</p>}
      </div>

      <div className="admin-table-mobile" style={{ display: 'grid', gap: 12 }}>
        {paged.map((u) => (
          <MobileUserCard key={u.id} user={u} onOpen={() => navigate(`/admin/users/${u.id}`)} onBlock={handleBlock} onUnblock={handleUnblock} />
        ))}
      </div>

      {users && list.length > 0 && (
        <AdminPagination page={safePage} totalPages={totalPages} total={list.length} pageSize={PAGE_SIZE} itemLabel="из" onPageChange={setPage} />
      )}

      <AdminToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function balanceSummary(u: User): string {
  const nonZero = u.balances.filter((b) => Number(b.available) > 0 || Number(b.locked) > 0);
  return nonZero.length === 0 ? '—' : nonZero.map((b) => `${b.available} ${b.asset}`).join(', ');
}

function UserRow({ user: u, onOpen, onBlock, onUnblock }: { user: User; onOpen: () => void; onBlock: (u: User) => void; onUnblock: (u: User) => void }) {
  const badge = KYC_LABEL[u.kycStatus] ?? KYC_LABEL.NOT_STARTED;
  return (
    <div
      className="row-hover"
      style={{ ...styles.tableRow, gridTemplateColumns: GRID, minWidth: 900, cursor: 'pointer' }}
      onClick={onOpen}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ ...styles.avatarCircle, width: 30, height: 30, fontSize: 11, background: avatarColor(u.email), flex: 'none' }}>{initials(u.email)}</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 600 }}>{u.email}</span>
          {u.isAdmin && (
            <span style={{ marginLeft: 6 }}>
              <Badge text="ADMIN" color="var(--admin-brand)" bg="var(--admin-brand-dim)" />
            </span>
          )}
        </span>
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>{new Date(u.createdAt).toLocaleDateString('ru-RU')}</span>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{lastSeenLabel(u.lastLoginAt)}</span>
      <span>
        <Badge text={badge.text} color={badge.color} bg={badge.bg} />
      </span>
      <span>
        {u.isBlocked ? <Badge text="Заблокирован" color="var(--sell)" bg="var(--sell-dim)" /> : <Badge text="Активен" color="var(--buy)" bg="var(--buy-dim)" />}
      </span>
      <span className="mono" style={{ fontSize: 12 }}>
        {balanceSummary(u)}
      </span>
      <span onClick={(e) => e.stopPropagation()}>
        <ActionsMenu user={u} onOpen={onOpen} onBlock={onBlock} onUnblock={onUnblock} />
      </span>
    </div>
  );
}

function MobileUserCard({ user: u, onOpen, onBlock, onUnblock }: { user: User; onOpen: () => void; onBlock: (u: User) => void; onUnblock: (u: User) => void }) {
  const badge = KYC_LABEL[u.kycStatus] ?? KYC_LABEL.NOT_STARTED;
  return (
    <div className="admin-card-hover" style={styles.card} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ ...styles.avatarCircle, background: avatarColor(u.email) }}>{initials(u.email)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{new Date(u.createdAt).toLocaleDateString('ru-RU')}</div>
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <ActionsMenu user={u} onOpen={onOpen} onBlock={onBlock} onUnblock={onUnblock} />
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {u.isBlocked ? <Badge text="Заблокирован" color="var(--sell)" bg="var(--sell-dim)" /> : <Badge text="Активен" color="var(--buy)" bg="var(--buy-dim)" />}
        <Badge text={badge.text} color={badge.color} bg={badge.bg} />
        {u.isAdmin && <Badge text="ADMIN" color="var(--admin-brand)" bg="var(--admin-brand-dim)" />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-tertiary)' }}>Посл. вход: {lastSeenLabel(u.lastLoginAt)}</span>
        <span className="mono">{balanceSummary(u)}</span>
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
