import { useEffect, useState } from 'react';
import { krakenSocket, SocketStatus } from '../lib/krakenSocket';
import { useLanguage } from '../lib/i18n';

// Grace period before showing the banner — a normal reconnect (brief
// network blip, the 1-1.5s initial handshake) shouldn't flash a scary red
// bar on every page load. A connection that's still down after this,
// INCLUDING one that never succeeded even once, genuinely should be shown —
// silently sitting on stale/absent live data with no explanation is worse.
const SHOW_AFTER_MS = 2000;

export function ConnectionBanner() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<SocketStatus>(krakenSocket.getStatus());
  const [show, setShow] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    const unsubscribe = krakenSocket.subscribeStatus((s) => {
      setStatus(s);
      if (s === 'connected') {
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        setShow(false);
      } else if (timer === null) {
        timer = window.setTimeout(() => setShow(true), SHOW_AFTER_MS);
      }
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  if (!show) return null;

  return (
    <div style={styles.banner} role="status">
      <span style={styles.dot} />
      {status === 'connecting' ? t('connection.reconnecting') : t('connection.lost')}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px',
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--sell)',
    flexShrink: 0,
  },
};
