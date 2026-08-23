import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;
// Errors stay up longer — they usually need to actually be read, not just
// glanced at like a confirmation does.
const AUTO_DISMISS_MS: Record<ToastType, number> = { success: 4000, info: 4000, error: 7000 };
const ICONS: Record<ToastType, string> = { success: '✓', error: '✕', info: 'ⓘ' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, type, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS[type]);
    },
    [dismiss]
  );

  const value: ToastContextValue = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={styles.stack}>
        {toasts.map((item) => (
          <div
            key={item.id}
            className="toast-item"
            style={{ ...styles.toast, ...TYPE_STYLES[item.type] }}
            onClick={() => dismiss(item.id)}
          >
            <span style={{ ...styles.icon, color: ICON_COLOR[item.type] }}>{ICONS[item.type]}</span>
            <span style={styles.message}>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICON_COLOR: Record<ToastType, string> = {
  success: 'var(--buy)',
  error: 'var(--sell)',
  info: 'var(--accent)',
};

const TYPE_STYLES: Record<ToastType, React.CSSProperties> = {
  success: { borderLeft: '3px solid var(--buy)' },
  error: { borderLeft: '3px solid var(--sell)' },
  info: { borderLeft: '3px solid var(--accent)' },
};

const styles: Record<string, React.CSSProperties> = {
  stack: {
    position: 'fixed',
    // Clears the floating support-chat launcher button (56px + 24px
    // margin, see SupportWidget) so the two don't visually overlap.
    bottom: 92,
    right: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 1000,
    maxWidth: 360,
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '12px 14px',
    boxShadow: 'var(--shadow-lg)',
    cursor: 'pointer',
    pointerEvents: 'auto',
  },
  icon: {
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
    lineHeight: '18px',
  },
  message: {
    fontSize: 12.5,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
  },
};
