import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { styles } from './adminStyles';
import { SearchInput } from '../../components/SearchInput';
import { Badge } from '../../components/Badge';
import { SkeletonRow } from '../../components/Skeleton';

type User = Awaited<ReturnType<typeof api.getAdminUsers>>[number];

const KYC_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  NOT_STARTED: { text: 'Не начата', color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' },
  PENDING: { text: 'На проверке', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  APPROVED: { text: 'Подтверждена', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  REJECTED: { text: 'Отклонена', color: 'var(--sell)', bg: 'var(--sell-dim)' },
};

const GRID = '1.6fr 0.9fr 0.9fr 0.9fr 0.9fr 1.2fr';

function lastSeenLabel(lastLoginAt: string | null): string {
  if (!lastLoginAt) return '—';
  const days = Math.floor((Date.now() - new Date(lastLoginAt).getTime()) / 86_400_000);
  if (days <= 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return `${days} дн. назад`;
}

/** Данные регистрации пользователей — таблица всех клиентов с поиском по
 * email; переход на карточку конкретного пользователя с полной историей. */
export function AdminUsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => {
      api.getAdminUsers(search || undefined).then(setUsers);
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  return (
    <div>
      <h1 style={styles.title}>Пользователи</h1>

      <SearchInput value={search} onChange={setSearch} placeholder="Поиск по email" style={{ marginBottom: 16, maxWidth: 360 }} />

      <div style={styles.table}>
        <div style={{ ...styles.tableHeader, gridTemplateColumns: GRID, minWidth: 860 }}>
          <span>Email</span>
          <span>Регистрация</span>
          <span>Посл. вход</span>
          <span>Верификация</span>
          <span>Статус</span>
          <span>Баланс</span>
        </div>
        {users === null && (
          <>
            <SkeletonRow columns={[1.6, 0.9, 0.9, 0.9, 0.9, 1.2]} />
            <SkeletonRow columns={[1.6, 0.9, 0.9, 0.9, 0.9, 1.2]} />
            <SkeletonRow columns={[1.6, 0.9, 0.9, 0.9, 0.9, 1.2]} />
          </>
        )}
        {users?.map((u) => {
          const badge = KYC_LABEL[u.kycStatus] ?? KYC_LABEL.NOT_STARTED;
          const nonZero = u.balances.filter((b) => Number(b.available) > 0 || Number(b.locked) > 0);
          return (
            <Link key={u.id} to={`/admin/users/${u.id}`} className="row-hover" style={{ ...styles.tableRow, gridTemplateColumns: GRID, minWidth: 860, textDecoration: 'none', color: 'inherit' }}>
              <span style={{ fontWeight: 600 }}>
                {u.email} {u.isAdmin && <Badge text="ADMIN" color="var(--accent)" bg="var(--accent-dim)" />}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{new Date(u.createdAt).toLocaleDateString('ru-RU')}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{lastSeenLabel(u.lastLoginAt)}</span>
              <span>
                <Badge text={badge.text} color={badge.color} bg={badge.bg} />
              </span>
              <span>
                {u.isBlocked ? (
                  <Badge text="Заблокирован" color="var(--sell)" bg="var(--sell-dim)" />
                ) : (
                  <Badge text="Активен" color="var(--buy)" bg="var(--buy-dim)" />
                )}
              </span>
              <span className="mono" style={{ fontSize: 12 }}>
                {nonZero.length === 0 ? '—' : nonZero.map((b) => `${b.available} ${b.asset}`).join(', ')}
              </span>
            </Link>
          );
        })}
        {users?.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Никого не найдено.</p>}
      </div>
    </div>
  );
}
