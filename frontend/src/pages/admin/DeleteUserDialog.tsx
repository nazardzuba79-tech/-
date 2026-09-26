import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';

export function canDeleteUser(user: { isAdmin: boolean; email: string }) {
  return !user.isAdmin && user.email.trim().toLowerCase() !== 'voltex.crypto@gmail.com';
}

/** Shared by the list and detail page; the server independently authorizes deletion. */
export function DeleteUserDialog({ user, onClose, onDeleted }: {
  user: { id: string; email: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function remove() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.deleteUser(user.id);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onDeleted();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить аккаунт. Повторите попытку.');
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="admin-modal" aria-labelledby="delete-user-title" aria-describedby="delete-user-description"
      onCancel={(event) => { event.preventDefault(); if (!submitting.current) onClose(); }}
      style={{ background: 'var(--panel)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, width: 'min(480px, calc(100vw - 32px))', boxSizing: 'border-box', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto' }}>
      <h2 id="delete-user-title" style={{ margin: '0 0 16px', fontSize: 20 }}>Удалить аккаунт?</h2>
      <p style={{ overflowWrap: 'anywhere' }}>Email: <strong>{user.email}</strong></p>
      <div id="delete-user-description" style={{ fontSize: 14, lineHeight: 1.6 }}>
        Это действие удалит:
        <ul style={{ paddingLeft: 20 }}>
          <li>аккаунт и сессии;</li>
          <li>внутренние балансы, ордера и позиции;</li>
          <li>демо/тестовые данные;</li>
          <li>KYC metadata;</li>
          <li>внутреннюю историю пользователя.</li>
        </ul>
        <p>Blockchain-переводы не удаляются из реестра сети.</p>
      </div>
      {error && <div role="alert" style={styles.errorBox}>{error}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button autoFocus disabled={busy} onClick={onClose} style={{ ...styles.rejectBtn, background: 'var(--panel)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>Отмена</button>
        <button disabled={busy} onClick={() => void remove()} style={{ ...styles.rejectBtn, background: 'var(--sell)', color: '#fff', borderColor: 'var(--sell)' }}>
          {busy ? 'Удаление…' : 'Удалить аккаунт безвозвратно'}
        </button>
      </div>
    </dialog>
  );
}
