import { useEffect, useState } from 'react';
import { styles } from './adminStyles';
import { CheckCircle2Icon, AlertTriangleIcon, XIcon } from './AdminIcons';

export interface AdminToastData {
  id: number;
  message: string;
  variant: 'success' | 'warning';
}

export function AdminToastContainer({ toasts, onDismiss }: { toasts: AdminToastData[]; onDismiss: (id: number) => void }) {
  return (
    <div style={styles.toastStack}>
      {toasts.map((t) => (
        <AdminToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function AdminToastItem({ toast, onDismiss }: { toast: AdminToastData; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 2600);
    const r = setTimeout(() => onDismiss(toast.id), 3000);
    return () => {
      clearTimeout(t);
      clearTimeout(r);
    };
  }, [toast.id, onDismiss]);

  const isSuccess = toast.variant === 'success';

  return (
    <div className="admin-toast-in" style={{ ...styles.toast, opacity: leaving ? 0 : 1, transition: 'opacity 0.3s ease' }}>
      <span style={{ color: isSuccess ? 'var(--buy)' : 'var(--accent)', display: 'inline-flex' }}>
        {isSuccess ? <CheckCircle2Icon size={18} /> : <AlertTriangleIcon size={18} />}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex' }}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

let counter = 0;
export function useAdminToasts() {
  const [toasts, setToasts] = useState<AdminToastData[]>([]);

  function push(message: string, variant: AdminToastData['variant'] = 'success') {
    const id = ++counter;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, push, dismiss };
}
