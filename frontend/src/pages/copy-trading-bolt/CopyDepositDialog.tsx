import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import './CopyDepositDialog.css';

/** Eligibility presentation only. The existing account/threshold and Copy
 * action remain in CopyButton; this dialog neither reads nor writes money. */
export function CopyDepositDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialogRef} className="copy-deposit-dialog" aria-labelledby={titleId}
      onClick={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <h2 id={titleId}>Копировать этого трейдера можно при депозите от $10 000.</h2>
      <div className="copy-deposit-dialog-actions">
        <Link to="/wallet?action=deposit" onClick={onClose}>Пополнить депозит</Link>
        <button type="button" onClick={onClose}>Закрыть</button>
      </div>
    </dialog>, document.body,
  );
}
