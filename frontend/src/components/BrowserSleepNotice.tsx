import { useSyncExternalStore } from 'react';
import { getBrowserPhase, onBrowserPhase } from '../lib/browserActivity';
import { useLanguage } from '../lib/i18n';
import './BrowserSleepNotice.css';

export function BrowserSleepNotice() {
  const phase = useSyncExternalStore(onBrowserPhase, getBrowserPhase);
  const { t } = useLanguage();
  if (phase === 'active') return null;
  // Retain the existing phase marker for lifecycle diagnostics without a
  // visible notice, announcement, focus target or Continue control. Reload
  // and the safe resume lifecycle are independent of this component.
  if (phase === 'sleeping') return <span hidden aria-hidden="true" data-browser-phase={phase} />;
  const loading = phase === 'validating' || phase === 'syncing';
  return <aside className="browser-sleep-notice" role="status" aria-live="polite" data-browser-phase={phase}>
    <span>{t(loading ? 'browserSyncing' : 'browserSyncError')}</span>
  </aside>;
}
