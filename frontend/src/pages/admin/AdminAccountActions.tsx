import { useEffect, useRef, useState } from 'react';
import { api, getToken, onSessionChange } from '../../lib/api';
import type { AdminProfile } from '../../lib/adminPagedApi';
import { AdminModal } from './AdminPrimitives';
import { styles } from './adminStyles';

/** Existing account actions, isolated from the default read-only profile. */
const unresolved = new Map<string, { session: string | null; operation: object }>();
onSessionChange(() => unresolved.clear());
export function AdminAccountActions({ profile, onChanged }: { profile: AdminProfile; onChanged: () => void }) {
  const [mode, setMode] = useState<'block' | 'unblock' | 'demo' | null>(null), [reason, setReason] = useState('');
  const [asset, setAsset] = useState('USDT'), [amount, setAmount] = useState(''), [confirm, setConfirm] = useState(false);
  const restored = unresolved.get(profile.id)?.session === getToken();
  const unknownMessage = 'Результат не определён. Проверьте профиль и журнал действий. Повтор заблокирован в этой сессии.';
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(restored), [message, setMessage] = useState(restored ? unknownMessage : '');
  const active = useRef(true), inFlight = useRef(false), token = useRef(getToken()), deadline = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { active.current = true; return () => { active.current = false; clearTimeout(deadline.current); }; }, []);
  const valid = () => active.current && getToken() === token.current;
  async function apply() {
    if (inFlight.current || !valid() || unknown) return;
    inFlight.current = true; setBusy(true); setMessage('');
    const operation = {};
    unresolved.set(profile.id, {session: token.current, operation});
    const release = () => { if (getToken() === token.current && unresolved.get(profile.id)?.operation === operation) unresolved.delete(profile.id); };
    let expired = false;
    const timer = setTimeout(() => { if (!valid()) return; expired = true; setBusy(false); setUnknown(true); setMessage(unknownMessage); }, 15_000);
    deadline.current = timer;
    try {
      if (mode === 'block' || mode === 'unblock') await (mode === 'unblock' ? api.unblockUser(profile.id) : api.blockUser(profile.id, reason.trim()));
      else await api.demoTopUp(profile.id, asset.trim().toUpperCase(), amount.trim(), reason.trim());
      release();
      if (!valid() || expired) return;
      onChanged(); setMessage('Операция подтверждена.'); setConfirm(false); setMode(null);
    } catch (error: any) {
      const refused = [400, 401, 403, 404, 409].includes(error?.status);
      if (refused) release();
      if (!valid() || expired) return;
      if (refused) setMessage('Операция отклонена. Проверьте данные и доступ.');
      else { setUnknown(true); setMessage(unknownMessage); }
    } finally { clearTimeout(timer); if (valid() && !expired) { setBusy(false); inFlight.current = false; } }
  }
  return <><details className="admin-account-actions"><summary>Управление учётной записью</summary>{/* Owner (2026-10-03): no new blocks; an account blocked earlier can still be restored. */}{profile.isBlocked && <button onClick={() => { setMode('unblock'); setConfirm(false); }}>Разблокировать</button>}<button onClick={() => { setMode('demo'); setConfirm(false); }}>Тестовое начисление</button></details>
    {message && <p role="status">{message}</p>}
    {mode && <AdminModal title={mode === 'demo' ? 'Тестовое начисление' : mode === 'unblock' ? 'Разблокировка пользователя' : 'Блокировка пользователя'} busy={busy} onClose={() => setMode(null)}>
      <div className="admin-modal-body">
      <p><strong>{profile.email}</strong><br />ID: {profile.id}</p>
      {unknown ? <p role="alert">{message} Новый повтор здесь недоступен до проверки журнала.</p> : !confirm ? <form className="admin-form-grid" onSubmit={e => { e.preventDefault(); setConfirm(true); }}>
        {mode === 'demo' && <><p>Счёт: тестовый. Средства и резервы спотового счёта не изменятся.</p><label>Актив<input value={asset} onChange={e => setAsset(e.target.value)} required /></label><label>Сумма со знаком + / −<input value={amount} onChange={e => setAmount(e.target.value)} required inputMode="decimal" /></label></>}
        {mode !== 'unblock' && <label>Причина<textarea required value={reason} onChange={e => setReason(e.target.value)} /></label>}<button style={styles.neutralBtn}>Проверить действие</button>
      </form> : <><p>{mode === 'demo' ? `Тестовый счёт: ${amount} ${asset.toUpperCase()}` : mode === 'unblock' ? 'Доступ пользователя будет восстановлен.' : 'Доступ пользователя будет заблокирован.'}</p>{mode !== 'unblock' && <p>Причина: {reason}</p>}<button disabled={busy} style={styles.primaryBtn} onClick={apply}>Подтвердить</button></>}
      </div>
      <footer><button disabled={busy} onClick={() => setMode(null)}>Отмена</button></footer>
    </AdminModal>}
  </>;
}
