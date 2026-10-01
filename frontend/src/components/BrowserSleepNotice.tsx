import { useSyncExternalStore } from 'react';
import { getBrowserPhase, onBrowserPhase } from '../lib/browserActivity';

/**
 * Browser lifecycle is operational plumbing, not customer-facing product UI.
 * Keep the phase marker for QA/lifecycle diagnostics, but never show global
 * "sleeping", "syncing", "updating" or refresh-failure banners.
 *
 * Product surfaces that genuinely cannot work without fresh data own their
 * actionable error states locally; the global lifecycle must stay silent.
 */
export function BrowserSleepNotice() {
  const phase = useSyncExternalStore(onBrowserPhase, getBrowserPhase);
  if (phase === 'active') return null;
  return <span hidden aria-hidden="true" data-browser-phase={phase} />;
}
