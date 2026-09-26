import { useCallback, useEffect, useRef, useState } from 'react';
import { styles } from './adminStyles';
import { adminDepositApi, AdminDepositApiError, newIdempotencyKey, STATE_LABEL, type PackagePreview } from './adminDepositApi';

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

const shortHash = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h);

/**
 * «Проверить и зачислить»: one user's package (one asset, one network).
 * Shows exactly what the server will credit: every transfer, the total, the
 * minimum check, the current balance and the balance after. Nothing is sent
 * until «Подтвердить зачисление», which is disabled below the minimum; the
 * server refuses it too. The request names the reviewed package (ids + its
 * fingerprint) and carries one idempotency key per opened drawer, so a double
 * click or a retry can never credit twice. No amount is ever sent.
 */
export function CreditDepositDrawer({ userId, chain, asset, email, onClose, onDone }: {
  userId: string;
  chain: string;
  asset: string;
  email: string;
  onClose: () => void;
  onDone: (result: { status: 'CREDITED'; totalAmount: string; asset: string }) => void;
}) {
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const inFlight = useRef(false);
  const key = useRef(newIdempotencyKey());

  const load = useCallback(() => {
    setLoadError(false);
    adminDepositApi.preview({ userId, chain, asset })
      .then((next) => { setPreview(next); key.current = newIdempotencyKey(); })
      .catch(() => setLoadError(true));
  }, [userId, chain, asset]);
  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function confirm() {
    if (!preview || inFlight.current || !preview.minimumReached) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await adminDepositApi.confirm({
        userId, chain, asset, depositIds: preview.transfers.map((t) => t.id), token: preview.token, idempotencyKey: key.current,
      });
      onDone({ status: result.status, totalAmount: result.totalAmount, asset: result.asset });
    } catch (err) {
      const e = err instanceof AdminDepositApiError ? err : null;
      setError(e?.message ?? 'Не удалось зачислить пакет. Ничего не зачислено.');
      // A changed package is shown again for a fresh review, never swapped silently.
      if (e?.code === 'PACKAGE_CHANGED' || e?.code === 'ALREADY_CREDITED') load();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const p = preview;
  return (
    <>
      <div style={styles.drawerOverlay} onClick={() => { if (!busy) onClose(); }} />
      <aside role="dialog" aria-modal="true" aria-labelledby="credit-package-title" data-credit-drawer={`${userId}|${chain}|${asset}`} style={styles.drawerPanel}>
        <div style={styles.drawerHeader}>
          <strong id="credit-package-title" style={{ fontSize: 15 }}>Зачисление пакета</strong>
          <button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose} style={styles.actionsMenuBtn}>✕</button>
        </div>
        <div style={styles.drawerBody}>
          <Field label="Пользователь" value={email} />
          <Field label="User ID" value={userId} mono />
          <Field label="Актив / сеть" value={`${asset} / ${chain === 'tron' ? 'TRC20' : chain}`} />
          {loadError && <div role="alert" style={styles.errorBox}>Не удалось загрузить пакет.</div>}
          {!p && !loadError && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Загрузка…</p>}
          {p && (
            <>
              <p style={styles.drawerSectionLabel}>Подтверждённые переводы ({p.transfers.length})</p>
              <div data-package-transfers style={{ display: 'grid', gap: 6 }}>
                {p.transfers.map((t) => (
                  <div key={t.id} data-package-transfer={t.id} style={{ ...styles.row, gap: 10, fontSize: 12 }}>
                    <span className="mono" title={t.txHash} style={{ color: 'var(--text-secondary)', minWidth: 0, overflowWrap: 'anywhere' }}>{shortHash(t.txHash)}</span>
                    <span className="mono" style={{ textAlign: 'right' }}>
                      <strong>{t.amount} {p.asset}</strong>
                      <small style={{ display: 'block', color: 'var(--text-tertiary)' }}>подтв. {t.confirmations}/{t.minConfirmations}{t.finalized ? ' · окончательно' : ''}</small>
                    </span>
                  </div>
                ))}
                {p.transfers.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Нет подтверждённых переводов.</span>}
              </div>
              {p.unconfirmedCount > 0 && (
                <p data-package-unconfirmed style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
                  Ещё не подтверждено сетью: {p.unconfirmedTotal} {p.asset} ({p.unconfirmedCount}) — не входит в сумму.
                </p>
              )}
              <p style={styles.drawerSectionLabel}>Итог</p>
              <Field label="Всего подтверждено" value={<strong data-package-total>{p.total} {p.asset}</strong>} mono />
              <Field label="Минимум" value={`${p.minDepositUsd} USD`} />
              {p.usdPolicy === 'MARKET_PRICE' && <Field label="Оценка" value={`${p.usdValue} USD (цена ${p.priceUsd}, ${p.pricedAt ? new Date(p.pricedAt).toLocaleTimeString('ru-RU') : '—'})`} mono />}
              <Field label="Минимум достигнут" value={<span data-package-minimum={p.minimumReached ? 'yes' : 'no'}>{p.minimumReached ? 'Да' : 'Нет'}</span>} />
              {!p.minimumReached && p.remaining !== null && <Field label="Осталось доплатить" value={`${p.remaining} ${p.asset}`} mono />}
              {!p.minimumReached && p.remaining === null && p.remainingUsd !== null && <Field label="Осталось доплатить" value={`≈ ${p.remainingUsd} USD`} mono />}
              <Field label="Статус" value={STATE_LABEL[p.state]} />
              <p style={styles.drawerSectionLabel}>Баланс {p.asset}</p>
              <Field label="Сейчас доступно" value={<span data-balance-now>{p.balanceAvailable}</span>} mono />
              <Field label="После зачисления" value={<span data-balance-after>{p.balanceAfter}</span>} mono />
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 12 }}>
                Перед зачислением сервер заново проверит каждый перевод в сети. Зачисляется весь пакет целиком или ничего.
                Сумма не берётся из этой формы. Ниже минимума зачисление недоступно.
              </p>
              {p.state === 'NEEDS_REVIEW' && <div role="status" style={{ ...styles.errorBox, background: 'var(--accent-dim)', color: 'var(--text-primary)' }}>Нет актуальной цены актива: минимум не может быть проверен.</div>}
            </>
          )}
          {error && <div role="alert" style={styles.errorBox}>{error}</div>}
        </div>
        <div style={{ ...styles.drawerFooter, gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" data-cancel-credit disabled={busy} onClick={onClose} style={styles.neutralBtn}>Отмена</button>
          <button type="button" data-confirm-credit disabled={busy || !p || !p.minimumReached || p.transfers.length === 0} onClick={confirm} style={styles.approveBtn}>
            {busy ? 'Зачисление…' : 'Подтвердить зачисление'}
          </button>
        </div>
      </aside>
    </>
  );
}
