import { useEffect, useRef, useState } from 'react';
import { createAdminTestAccount, setAdminTestPassword } from '../../lib/adminTestPasswordApi';

export function AdminTestAccountDialog({
  target, onClose, onSaved,
}: {
  target: { id: string; email: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const el = dialog.current; el?.showModal(); return () => el?.close();
  }, []);
  async function save() {
    if (submitting.current) return;
    if (password.length < 10 || password.length > 128) { setError('Пароль должен содержать 10–128 символов.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      if (target) await setAdminTestPassword(target.id, password);
      else await createAdminTestAccount(email, password);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Операция не выполнена.');
      submitting.current = false;
      setBusy(false);
    }
  }
  return <dialog ref={dialog} className="admin-spam-dialog" aria-labelledby="owner-test-account-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="owner-test-account-title">{target ? 'Назначить пароль тестового аккаунта' : 'Создать тестовый аккаунт'}</h2>
    <p>{target ? target.email : 'Создание аккаунта с нулевым балансом. Пароль будет доступен владельцу биржи в колонке «Пароль».'}</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      {!target && <label>Email <input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" /></label>}
      <label>Пароль <input type="password" required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" /></label>
      {target && <p>Для этого действия сервер проверит, что аккаунт не имеет KYC, депозитов, выводов и ордеров. Существующие сессии будут завершены.</p>}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button type="button" className="admin-spam-control" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="submit" className="admin-spam-control" disabled={busy || !password || (!target && !email)}>
          {busy ? 'Сохраняем…' : target ? 'Установить пароль' : 'Создать'}
        </button>
      </footer>
    </form>
  </dialog>;
}
