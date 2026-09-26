import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import type { AdminPendingDeposit } from './adminUserActivity';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'PENDING — ожидает зачисления',
  BELOW_MINIMUM: 'BELOW_MINIMUM — ниже минимальной суммы',
};

/** Exact decimal addition of two non-negative decimal strings (no floating point). */
export function addDecimalStrings(a: string, b: string): string | null {
  const re = /^\d+(\.\d+)?$/;
  if (!re.test(a) || !re.test(b)) return null;
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const scale = Math.max(af.length, bf.length);
  const sum = BigInt(ai + af.padEnd(scale, '0')) + BigInt(bi + bf.padEnd(scale, '0'));
  if (scale === 0) return sum.toString();
  const digits = sum.toString().padStart(scale + 1, '0');
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return digits.slice(0, -scale) + (fraction ? `.${fraction}` : '');
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ ...styles.row, gap: 12 }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13, flex: 'none' }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ fontSize: 13, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

/**
 * CONFIRMATION BEFORE ANY CREDIT. Every figure here is the server's deposit
 * record; the request that follows is the existing Пополнения flow
 * (`api.creditDepositManually` → POST /admin/deposits/manual-credit), which
 * sends no amount — the server re-verifies the transfer on-chain, refuses a
 * second credit of the same transaction and writes the audit log. Nothing is
 * sent until «Подтвердить зачисление».
 */
export function CreditDepositDrawer({ deposit, email, available, onClose, onDone }: {
  deposit: AdminPendingDeposit;
  email: string;
  /** The user's current available balance in `deposit.asset`, from the loaded user row; null if unknown. */
  available: string | null;
  onClose: () => void;
  onDone: (status: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  // Synchronous: two clicks in one tick both see `busy === false`; the ref does not.
  const inFlight = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const after = available !== null ? addDecimalStrings(available, deposit.amount) : null;

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.creditDepositManually({ userId: deposit.userId, chain: deposit.chain, txHash: deposit.txHash, asset: deposit.asset });
      if (result.status === 'CREDITED') {
        onDone(result.status);
        return;
      }
      setOutcome(result.status === 'BELOW_MINIMUM'
        ? 'Не зачислено: депозит ниже минимальной суммы и ещё не набрал подтверждений сети. Баланс не изменён.'
        : `Не зачислено: депозит ожидает подтверждений сети (${result.confirmations}). Баланс не изменён.`);
      onDone(result.status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось зачислить депозит.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <div style={styles.drawerOverlay} onClick={() => { if (!busy) onClose(); }} />
      <aside role="dialog" aria-modal="true" aria-labelledby="credit-deposit-title" data-credit-drawer={deposit.id} style={styles.drawerPanel}>
        <div style={styles.drawerHeader}>
          <strong id="credit-deposit-title" style={{ fontSize: 15 }}>Зачисление депозита</strong>
          <button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose} style={styles.actionsMenuBtn}>✕</button>
        </div>
        <div style={styles.drawerBody}>
          <Field label="Пользователь" value={email} />
          <Field label="User ID" value={deposit.userId} mono />
          <Field label="Актив" value={deposit.asset} />
          <Field label="Сеть" value={deposit.chain} />
          <Field label="Сумма" value={<strong>{deposit.amount} {deposit.asset}</strong>} mono />
          <Field label="TXID" value={deposit.txHash} mono />
          <Field label="Создан" value={new Date(deposit.createdAt).toLocaleString('ru-RU')} />
          <Field label="Статус" value={STATUS_LABEL[deposit.status] ?? deposit.status} />
          <Field label="Подтверждений" value={deposit.confirmations} mono />
          <p style={styles.drawerSectionLabel}>Баланс {deposit.asset}</p>
          <Field label="Сейчас доступно" value={available ?? '—'} mono />
          {after !== null && <Field label="После зачисления" value={after} mono />}
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 12 }}>
            Сумма не берётся из этой формы: сервер заново проверяет перевод в сети и зачисляет ровно сумму транзакции,
            только если набрано достаточно подтверждений. Повторно одну транзакцию зачислить нельзя.
          </p>
          {outcome && <div role="status" style={{ ...styles.errorBox, background: 'var(--accent-dim)', color: 'var(--text-primary)' }}>{outcome}</div>}
          {error && <div role="alert" style={styles.errorBox}>{error}</div>}
        </div>
        <div style={{ ...styles.drawerFooter, gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" data-cancel-credit disabled={busy} onClick={onClose} style={styles.neutralBtn}>{outcome ? 'Закрыть' : 'Отмена'}</button>
          {!outcome && (
            <button type="button" data-confirm-credit disabled={busy} onClick={confirm} style={styles.approveBtn}>
              {busy ? 'Зачисление…' : 'Подтвердить зачисление'}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
