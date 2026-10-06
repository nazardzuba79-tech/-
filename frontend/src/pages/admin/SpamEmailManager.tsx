import { useEffect, useRef, useState } from 'react';
import { setSpamEmail, type SpamEmailEntry } from '../../lib/adminSpamEmails';
import { adminDate } from './adminPresentation';
export function SpamEmailManager({ entries, onSelect }: { entries: SpamEmailEntry[] | null; onSelect: (email: string, blocked: boolean) => void }) {
  const [open, setOpen] = useState(false), [email, setEmail] = useState('');
  return <section className="admin-spam-manager">
    <button type="button" className="admin-spam-control" aria-expanded={open} onClick={() => setOpen(!open)}>Спам-почты{entries ? ` · ${entries.length}` : ''}</button>
    {open && <div className="admin-spam-panel">
      <h2>Заблокированные email</h2><p>Вход, повторная регистрация и поддержка запрещены. Аккаунты и финансовые данные сохраняются.</p>
      <form onSubmit={e => { e.preventDefault(); onSelect(email, true); }}><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="name@example.com" /></label><button className="admin-spam-control" disabled={!entries}>Добавить в спам</button></form>
      {entries?.length === 0 && <p>Список пуст.</p>}
      <ul>{entries?.map(entry => <li key={entry.email}><div><strong>{entry.email}</strong><small>Добавил: {entry.addedBy} · {adminDate(entry.addedAt, true)}</small></div><button type="button" className="admin-spam-control" onClick={() => onSelect(entry.email, false)}>Не спам</button></li>)}</ul>
    </div>}
  </section>;
}
export function SpamEmailDialog({ email, blocked, onClose, onSaved }: { email: string; blocked: boolean; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  async function save() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { await setSpamEmail(email, blocked); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить.'); submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="admin-spam-dialog" aria-labelledby="spam-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="spam-title">{blocked ? 'Пометить как спам?' : 'Убрать из спама?'}</h2><strong>{email}</strong>
    <p>{blocked ? 'Активные сессии будут завершены. Вход, регистрация и обращения в поддержку станут недоступны. Данные аккаунта сохранятся.' : 'Email снова сможет входить, регистрироваться и обращаться в поддержку. Завершённые сессии не восстановятся — потребуется новый вход.'}</p>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" className="admin-spam-control" disabled={busy} onClick={onClose}>Отмена</button><button type="button" className="admin-spam-control" disabled={busy} onClick={() => void save()}>{busy ? 'Сохраняем…' : blocked ? 'Спам' : 'Не спам'}</button></footer>
  </dialog>;
}
