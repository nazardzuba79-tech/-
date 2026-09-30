import { useSyncExternalStore } from 'react';
import { getBrowserPhase, onBrowserPhase } from '../lib/browserActivity';
import { useLanguage } from '../lib/i18n';
import './BrowserSleepNotice.css';

export function BrowserSleepNotice() {
  const phase = useSyncExternalStore(onBrowserPhase, getBrowserPhase);
  const { t } = useLanguage();
  // A normal pause keeps the last received values without an overlay or a
  // Continue control. Page reload and the existing safe resume lifecycle work
  // independently of this presentation component.
  if (phase === 'active' || phase === 'sleeping') return null;
  const loading = phase === 'validating' || phase === 'syncing';
  return <aside className="browser-sleep-notice" role="status" aria-live="polite" data-browser-phase={phase}>
    <span>{t(loading ? 'browserSyncing' : 'browserSyncError')}</span>
  </aside>;
}
