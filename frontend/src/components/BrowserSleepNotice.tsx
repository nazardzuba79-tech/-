import { useSyncExternalStore } from 'react';
import { getBrowserPhase, onBrowserPhase, resumeBrowser } from '../lib/browserActivity';
import { useLanguage } from '../lib/i18n';
import './BrowserSleepNotice.css';

export function BrowserSleepNotice() {
  const phase = useSyncExternalStore(onBrowserPhase, getBrowserPhase);
  const { t } = useLanguage();
  if (phase === 'active') return null;
  const loading = phase === 'validating' || phase === 'syncing';
  return <aside className="browser-sleep-notice" role="status" aria-live="polite" data-browser-phase={phase}>
    <span>{t(loading ? 'browserSyncing' : phase === 'error' ? 'browserSyncError' : 'browserSleeping')}</span>
    {!loading && <button type="button" onClick={() => void resumeBrowser()}>{t('browserContinue')}</button>}
  </aside>;
}
