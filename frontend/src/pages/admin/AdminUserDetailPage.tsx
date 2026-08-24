import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { Badge } from '../../components/Badge';
import { Skeleton } from '../../components/Skeleton';

type Detail = Awaited<ReturnType<typeof api.getAdminUserDetail>>;

const KYC_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  NOT_STARTED: { text: 'Не начата', color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' },
  PENDING: { text: 'На проверке', color: 'var(--accent)', bg: 'var(--accent-dim)' },
  APPROVED: { text: 'Подтверждена', color: 'var(--buy)', bg: 'var(--buy-dim)' },
  REJECTED: { text: 'Отклонена', color: 'var(--sell)', bg: 'var(--sell-dim)' },
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.card}>
      <h3 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>{title}</h3>
      {children}
    </div>
  );
}

/** Карточка пользователя — полная история: депозиты, выводы, ордера,
 * покупки, KYC-заявки, плюс ручная корректировка баланса. */
export function AdminUserDetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSuccess, setAdjustSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const navigate = useNavigate();

  const [demoAsset, setDemoAsset] = useState('');
  const [demoAmount, setDemoAmount] = useState('');
  const [demoNote, setDemoNote] = useState('');
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoSuccess, setDemoSuccess] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  function reload() {
    api
      .getAdminUserDetail(id)
      .then(setDetail)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      });
  }

  useEffect(reload, [id]);

  async function handleBlock() {
    const reason = window.prompt('Причина блокировки (обязательно):');
    if (!reason || !reason.trim()) return;
    setAccountError(null);
    setAccountBusy(true);
    try {
      await api.blockUser(id, reason.trim());
      reload();
    } catch (err) {
      setAccountError(err instanceof ApiError ? err.message : 'Не удалось заблокировать пользователя.');
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleUnblock() {
    setAccountError(null);
    setAccountBusy(true);
    try {
      await api.unblockUser(id);
      reload();
    } catch (err) {
      setAccountError(err instanceof ApiError ? err.message : 'Не удалось разблокировать пользователя.');
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    if (!window.confirm(`Удалить аккаунт ${detail.email} без возможности восстановления?`)) return;
    setAccountError(null);
    setAccountBusy(true);
    try {
      await api.deleteUser(id);
      navigate('/admin/users');
    } catch (err) {
      setAccountError(err instanceof ApiError ? err.message : 'Не удалось удалить пользователя.');
      setAccountBusy(false);
    }
  }

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    setAdjustError(null);
    setAdjustSuccess(null);
    setBusy(true);
    try {
      const result = await api.adjustUserBalance(id, asset.trim().toUpperCase(), amount.trim(), reason.trim());
      setAdjustSuccess(`Новый доступный баланс: ${result.available} ${result.asset}`);
      setAsset('');
      setAmount('');
      setReason('');
      reload();
    } catch (err) {
      setAdjustError(err instanceof ApiError ? err.message : 'Не удалось скорректировать баланс.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDemoTopUp(e: React.FormEvent) {
    e.preventDefault();
    setDemoError(null);
    setDemoSuccess(null);
    setDemoBusy(true);
    try {
      const result = await api.demoTopUp(id, demoAsset.trim().toUpperCase(), demoAmount.trim(), demoNote.trim() || undefined);
      setDemoSuccess(`Новый demo-баланс: ${result.available} ${result.asset}`);
      setDemoAsset('');
      setDemoAmount('');
      setDemoNote('');
      reload();
    } catch (err) {
      setDemoError(err instanceof ApiError ? err.message : 'Не удалось начислить demo-баланс.');
    } finally {
      setDemoBusy(false);
    }
  }

  if (notFound) return <p>Пользователь не найден.</p>;
  if (!detail) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={100} />
        <Skeleton height={200} />
      </div>
    );
  }

  const kycBadge = KYC_LABEL[detail.kycStatus] ?? KYC_LABEL.NOT_STARTED;

  return (
    <div>
      <Link to="/admin/users" style={{ color: 'var(--text-tertiary)', fontSize: 12, textDecoration: 'none' }}>
        ← Все пользователи
      </Link>
      <h1 style={styles.title}>{detail.email}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Section title="Профиль">
          <Row label="Email" value={detail.email} />
          <Row label="Роль" value={detail.isAdmin ? 'Администратор' : 'Пользователь'} />
          <Row label="Регистрация" value={new Date(detail.createdAt).toLocaleString('ru-RU')} />
          <Row label="IP при регистрации" value={detail.registrationIp ?? '—'} />
          <Row label="Верификация" value={<Badge text={kycBadge.text} color={kycBadge.color} bg={kycBadge.bg} />} />
          <Row label="Последний вход" value={detail.lastLoginAt ? new Date(detail.lastLoginAt).toLocaleString('ru-RU') : 'Ни разу не входил'} />
          <Row
            label="Статус"
            value={
              detail.isBlocked ? (
                <Badge text={`Заблокирован${detail.blockedReason ? `: ${detail.blockedReason}` : ''}`} color="var(--sell)" bg="var(--sell-dim)" />
              ) : (
                <Badge text="Активен" color="var(--buy)" bg="var(--buy-dim)" />
              )
            }
          />
        </Section>

        <Section title="Баланс">
          {detail.balances.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Баланс пуст.</p>}
          {detail.balances.map((b) => (
            <Row key={b.asset} label={b.asset} value={<span className="mono">{b.available} доступно, {b.locked} заблокировано</span>} />
          ))}
        </Section>
      </div>

      {!detail.isAdmin && (
        <>
          <Section title="Учётная запись">
            <p style={styles.hint}>
              Блокировка запрещает вход в аккаунт (существующая сессия истечёт сама, максимум через 12 часов) — используйте для нарушения правил.
              Удаление доступно только для аккаунтов без истории операций (нет депозитов, выводов, ордеров, покупок) — например, для тех, кто
              зарегистрировался и давно не заходит, ничего не внёс.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              {detail.isBlocked ? (
                <button onClick={handleUnblock} disabled={accountBusy} style={styles.approveBtn}>
                  Разблокировать
                </button>
              ) : (
                <button onClick={handleBlock} disabled={accountBusy} style={styles.rejectBtn}>
                  Заблокировать
                </button>
              )}
              <button onClick={handleDelete} disabled={accountBusy} style={{ ...styles.rejectBtn, borderColor: 'var(--sell)' }}>
                Удалить аккаунт
              </button>
            </div>
            {accountError && <div style={styles.errorBox}>{accountError}</div>}
          </Section>

          <div style={{ height: 16 }} />
        </>
      )}

      <Section title="Ручная корректировка баланса">
        <p style={styles.hint}>
          Меняет только доступный баланс. Требует причину — она сохраняется в журнале действий.
        </p>
        <form onSubmit={handleAdjust} style={{ ...styles.form, display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 10, alignItems: 'end' }}>
          <label style={styles.label}>
            Актив
            <input style={styles.input} value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="USDT" required />
          </label>
          <label style={styles.label}>
            Сумма (± )
            <input style={styles.input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10 или -10" required />
          </label>
          <label style={styles.label}>
            Причина
            <input style={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина корректировки" required />
          </label>
          <button type="submit" style={styles.primaryBtn} disabled={busy}>
            Применить
          </button>
        </form>
        {adjustError && <div style={styles.errorBox}>{adjustError}</div>}
        {adjustSuccess && <div style={styles.successBox}>{adjustSuccess}</div>}
      </Section>

      <div style={{ height: 16 }} />

      <Section title="Demo-баланс (песочница)">
        <p style={styles.hint}>
          Тестовые средства, полностью отдельные от реального баланса и резервов — только для проверки торговли на странице «Demo». Начисление всегда
          логируется в журнал действий с пометкой «demo top-up».
        </p>
        {detail.demoBalances.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Demo-баланс пуст.</p>
        ) : (
          detail.demoBalances.map((b) => (
            <Row
              key={b.asset}
              label={`DEMO · ${b.asset}`}
              value={<span className="mono">{b.available} доступно, {b.locked} заблокировано</span>}
            />
          ))
        )}
        <form onSubmit={handleDemoTopUp} style={{ ...styles.form, display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 10, alignItems: 'end' }}>
          <label style={styles.label}>
            Актив
            <input style={styles.input} value={demoAsset} onChange={(e) => setDemoAsset(e.target.value)} placeholder="BTC" required />
          </label>
          <label style={styles.label}>
            Сумма (± )
            <input style={styles.input} value={demoAmount} onChange={(e) => setDemoAmount(e.target.value)} placeholder="272" required />
          </label>
          <label style={styles.label}>
            Заметка (необязательно)
            <input style={styles.input} value={demoNote} onChange={(e) => setDemoNote(e.target.value)} placeholder="Например: первичное начисление" />
          </label>
          <button type="submit" style={styles.primaryBtn} disabled={demoBusy}>
            Начислить demo
          </button>
        </form>
        {demoError && <div style={styles.errorBox}>{demoError}</div>}
        {demoSuccess && <div style={styles.successBox}>{demoSuccess}</div>}
      </Section>

      <div style={{ height: 16 }} />

      <Section title="Ордера">
        {detail.orders.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Ордеров нет.</p>}
        {detail.orders.map((o) => (
          <Row
            key={o.id}
            label={`${o.pair} · ${o.side} · ${o.type}`}
            value={<span className="mono">{o.remainingQuantity}/{o.originalQuantity} · {o.status} · {new Date(o.createdAt).toLocaleDateString('ru-RU')}</span>}
          />
        ))}
      </Section>

      <div style={{ height: 16 }} />

      <Section title="Депозиты">
        {detail.deposits.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Депозитов нет.</p>}
        {detail.deposits.map((d) => (
          <Row
            key={d.id}
            label={`${d.asset} / ${d.chain}`}
            value={<span className="mono">{d.amount} · {d.status} · {new Date(d.createdAt).toLocaleDateString('ru-RU')}</span>}
          />
        ))}
      </Section>

      <div style={{ height: 16 }} />

      <Section title="Выводы">
        {detail.withdrawals.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Выводов нет.</p>}
        {detail.withdrawals.map((w) => (
          <Row
            key={w.id}
            label={`${w.asset} / ${w.network}`}
            value={<span className="mono">{w.amount} · {w.status} · {new Date(w.createdAt).toLocaleDateString('ru-RU')}</span>}
          />
        ))}
      </Section>

      <div style={{ height: 16 }} />

      <Section title="Покупки">
        {detail.purchases.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Покупок нет.</p>}
        {detail.purchases.map((p) => (
          <Row
            key={p.id}
            label={p.productName}
            value={<span className="mono">{p.amount} {p.asset} · {p.status} · {new Date(p.createdAt).toLocaleDateString('ru-RU')}</span>}
          />
        ))}
      </Section>

      <div style={{ height: 16 }} />

      <Section title="Заявки на верификацию (KYC)">
        {detail.kycSubmissions.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Заявок нет.</p>}
        {detail.kycSubmissions.map((k) => (
          <Row
            key={k.id}
            label={`${k.fullName} · ${k.documentType}`}
            value={<span className="mono">{k.status} · {new Date(k.createdAt).toLocaleDateString('ru-RU')}</span>}
          />
        ))}
      </Section>
    </div>
  );
}
