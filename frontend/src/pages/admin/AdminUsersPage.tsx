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

const GRID = '1.8fr 1fr 1fr 1fr 1.4fr';

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
        <div style={{ ...styles.tableHeader, gridTemplateColumns: GRID, minWidth: 760 }}>
          <span>Email</span>
          <span>Регистрация</span>
          <span>IP регистрации</span>
          <span>Верификация</span>
          <span>Баланс</span>
        </div>
        {users === null && (
          <>
            <SkeletonRow columns={[2, 1, 1, 1, 1.4]} />
            <SkeletonRow columns={[2, 1, 1, 1, 1.4]} />
            <SkeletonRow columns={[2, 1, 1, 1, 1.4]} />
          </>
        )}
        {users?.map((u) => {
          const badge = KYC_LABEL[u.kycStatus] ?? KYC_LABEL.NOT_STARTED;
          const nonZero = u.balances.filter((b) => Number(b.available) > 0 || Number(b.locked) > 0);
          return (
            <Link key={u.id} to={`/admin/users/${u.id}`} className="row-hover" style={{ ...styles.tableRow, gridTemplateColumns: GRID, minWidth: 760, textDecoration: 'none', color: 'inherit' }}>
              <span style={{ fontWeight: 600 }}>
                {u.email} {u.isAdmin && <Badge text="ADMIN" color="var(--accent)" bg="var(--accent-dim)" />}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{new Date(u.createdAt).toLocaleDateString('ru-RU')}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{u.registrationIp ?? '—'}</span>
              <span>
                <Badge text={badge.text} color={badge.color} bg={badge.bg} />
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
