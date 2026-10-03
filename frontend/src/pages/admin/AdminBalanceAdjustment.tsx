import { useEffect, useRef, useState } from 'react';
import { getToken, onSessionChange } from '../../lib/api';
import { postAdminAdjustment, readAdminAdjustment, adjustmentPreview, type AdjustmentIntent, type AdjustmentReceipt } from '../../lib/adminBalanceApi';
import type { AdminProfile } from '../../lib/adminPagedApi';
import { AdminModal, CopyValue } from './AdminPrimitives';
import { styles } from './adminStyles';

// Uncertain operations survive navigation in this tab, never logout or storage.
const pending = new Map<string, { session: string; intent: AdjustmentIntent }>();
onSessionChange(() => pending.clear());
export function AdminBalanceAdjustment({ profile, onClose, onChanged }: { profile: AdminProfile & { balances: NonNullable<AdminProfile['balances']> }; onClose: () => void; onChanged: () => void }) {
  const session = getToken(), saved = pending.get(profile.id);
  const initial = saved?.session === session ? saved.intent : null;
  const [asset, setAsset] = useState(initial?.asset ?? 'USDT'), [amount, setAmount] = useState(initial?.amount ?? ''), [reason, setReason] = useState(initial?.reason ?? '');
  const [intent, setIntent] = useState<AdjustmentIntent | null>(initial), [phase, setPhase] = useState<'edit' | 'confirm' | 'unknown' | 'success'>(initial ? 'unknown' : 'edit');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState<AdjustmentReceipt | null>(null);
  const request = useRef<AbortController | null>(null), deadline = useRef<ReturnType<typeof setTimeout>>(), owner = useRef(session), close = useRef(onClose); close.current = onClose;
  useEffect(() => { const off = onSessionChange(() => { clearTimeout(deadline.current); request.current?.abort(); request.current = null; close.current(); }); return () => { off(); clearTimeout(deadline.current); request.current?.abort(); request.current = null; }; }, []);
  const canonicalAsset = asset.trim().toUpperCase();
  const before = profile.balances.find(row => row.asset === canonicalAsset)?.available ?? '0';
  const after = adjustmentPreview(before, amount.trim());
  async function perform(recover: boolean) {
    if (!intent || request.current || !session || owner.current !== getToken()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    pending.set(profile.id, { session, intent });
    const owns = () => request.current === controller && getToken() === session;
    const timer = setTimeout(() => { if (!owns()) return; request.current = null; controller.abort(); setBusy(false); setPhase('unknown'); setError('Время ожидания истекло. Результат не определён.'); }, 15_000);
    deadline.current = timer;
    try {
      const result = await (recover ? readAdminAdjustment(profile.id, intent.idempotencyKey, controller.signal) : postAdminAdjustment(profile.id, intent, controller.signal));
      if (!owns()) return;
      if (result.operationId !== intent.idempotencyKey || result.userId !== profile.id || result.status !== 'APPLIED') throw new Error('Invalid receipt');
      pending.delete(profile.id); setReceipt(result); setPhase('success'); onChanged();
    } catch (e: any) {
      if (!owns()) return;
      // Only a definitive validation/auth refusal permits a different intent.
      if (!recover && [400, 401, 403].includes(e?.status)) { pending.delete(profile.id); setIntent(null); setPhase('edit'); setError(e.message); }
      else { setPhase('unknown'); setError(recover && e?.status === 404 ? 'Подтверждённый результат пока не найден. Повтор разрешён только с исходным ключом.' : 'Результат не определён. Сначала проверьте операцию; повтор использует тот же ключ.'); }
    } finally { clearTimeout(timer); if (owns()) { request.current = null; setBusy(false); } }
  }
  return <AdminModal title="Корректировка спотового баланса" onClose={onClose} busy={busy}>
    <p><strong>{profile.email}</strong></p><CopyValue value={profile.id} label="ID пользователя" full /><p>Счёт: Спот. Резерв и тестовый счёт не изменяются.</p>
    {phase === 'edit' && <form className="admin-form-grid" onSubmit={event => { event.preventDefault(); if (after === null || after.startsWith('-') || !reason.trim()) { setError('Проверьте сумму, доступный баланс и обязательную причину.'); return; } setIntent({ asset: canonicalAsset, amount: amount.trim(), reason: reason.trim(), idempotencyKey: crypto.randomUUID() }); setError(''); setPhase('confirm'); }}>
      <label>Актив<input required maxLength={10} value={asset} onChange={e => setAsset(e.target.value.toUpperCase())} /></label>
      <label>Сумма со знаком + / −<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="10 или -10" /></label>
      <label>Причина<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <p>Доступно: {before} {canonicalAsset}. После: {after ?? '—'} {canonicalAsset}.</p><button style={styles.primaryBtn}>Проверить корректировку</button>
    </form>}
    {phase === 'confirm' && <><dl className="admin-key-values"><dt>Актив / счёт</dt><dd>{intent?.asset} · Спот</dd><dt>Было</dt><dd>{before}</dd><dt>Изменение</dt><dd>{intent?.amount.startsWith('-') ? intent.amount : `+${intent?.amount}`}</dd><dt>Будет по текущему снимку</dt><dd>{after}</dd><dt>Причина</dt><dd>{intent?.reason}</dd></dl><p className="admin-muted">Фактический баланс до и после подтвердит сервер в квитанции.</p><div className="admin-dialog-actions"><button disabled={busy} onClick={() => setPhase('edit')}>Назад</button><button disabled={busy} style={styles.primaryBtn} onClick={() => perform(false)}>Подтвердить корректировку</button></div></>}
    {phase === 'unknown' && <><p role="status">Не создавайте повторную корректировку с новым ключом.</p><CopyValue value={intent?.idempotencyKey} label="ключ операции" full /><p>{intent?.amount} {intent?.asset} · {intent?.reason}</p><div className="admin-dialog-actions"><button disabled={busy} onClick={() => perform(true)}>Проверить результат</button><button disabled={busy} onClick={() => perform(false)}>Повторить с исходным ключом</button></div></>}
    {phase === 'success' && receipt && <div role="status"><h3>Корректировка подтверждена</h3><p>{receipt.availableBefore} → {receipt.available} {receipt.asset}</p><p>В резерве: {receipt.locked} {receipt.asset}</p><CopyValue value={receipt.operationId} label="ключ операции" full /></div>}
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Ожидаем подтверждение…</p>}
    <button disabled={busy} style={styles.neutralBtn} onClick={onClose}>{phase === 'success' ? 'Закрыть' : 'Отмена'}</button>
  </AdminModal>;
}
