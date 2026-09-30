import { useEffect, useState, useSyncExternalStore } from 'react';
import { getBrowserPhase, onBrowserPhase } from '../lib/browserActivity';
import { useLanguage } from '../lib/i18n';
import './BrowserSleepNotice.css';

/**
 * How long a return-to-tab refresh may run before it is worth a line on
 * screen. A routine one settles well inside this, and a notice that flashes
 * up and away on every return read as unfinished (owner, 2026-09-30: the
 * «Обновляем данные…» plaque next to Bybit, which shows none). A slow one
 * still says so, and a real failure always does.
 */
export const SYNC_NOTICE_DELAY_MS = 3000;

export function BrowserSleepNotice() {
  const phase = useSyncExternalStore(onBrowserPhase, getBrowserPhase);
  const { t } = useLanguage();
  const loading = phase === 'validating' || phase === 'syncing';
  const [slow, setSlow] = useState(false);
  // One clock across validating → syncing; it restarts only when a new
  // refresh begins.
  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), SYNC_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  if (phase === 'active') return null;
  // Retain the existing phase marker for lifecycle diagnostics without a
  // visible notice, announcement, focus target or Continue control: while
  // sleeping, and while a refresh is still inside its quiet window. Reload
  // and the safe resume lifecycle are independent of this component.
  if (phase === 'sleeping' || (loading && !slow)) return <span hidden aria-hidden="true" data-browser-phase={phase} />;
  return <aside className="browser-sleep-notice" role="status" aria-live="polite" data-browser-phase={phase}>
    <span>{t(loading ? 'browserSyncing' : 'browserSyncError')}</span>
  </aside>;
}
