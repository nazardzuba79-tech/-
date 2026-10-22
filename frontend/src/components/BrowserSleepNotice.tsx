import { useSyncExternalStore } from 'react';
import { getBrowserPhase, getBrowserResumeFailure, onBrowserPhase, resumeBrowser, type BrowserResumeFailure } from '../lib/browserActivity';
import { useOptionalLanguage, type Key } from '../lib/i18n';
import { RU } from '../lib/i18n/locales/ru';
import './BrowserSleepNotice.css';

/**
 * Browser lifecycle is operational plumbing, not customer-facing product UI.
 * Sleeping, validating and syncing keep only the hidden phase marker for
 * QA/lifecycle diagnostics: never a global "sleeping", "syncing" or
 * "updating" banner. Product surfaces that cannot work without fresh data
 * own their actionable error states locally.
 *
 * A wake that FAILED is the one exception (owner, 2026-10-21): every click,
 * key and double click is refused until a wake succeeds, so without a
 * visible reason and a retry control the tab reads as broken until F5.
 * `error` alone shows one compact notice naming the request that failed,
 * with «Повторить попытку» — the same session validation and sync barrier
 * again, never a forced active state — and «Обновить страницу».
 */
export function BrowserSleepNotice() {
  const phase = useSyncExternalStore(onBrowserPhase, getBrowserPhase);
  const failure = useSyncExternalStore(onBrowserPhase, getBrowserResumeFailure);
  const language = useOptionalLanguage();
  const t = (key: Key): string => (language ? language.t(key) : RU[key] ?? key);
  if (phase === 'active') return null;
  if (phase !== 'error') return <span hidden aria-hidden="true" data-browser-phase={phase} />;
  return (
    <div className="browser-resume-notice" role="alert" data-browser-notice="" data-browser-phase="error" data-browser-failure={failure?.kind}>
      <div className="browser-resume-notice__text">
        <strong>{t('browserSyncError')}</strong>
        <span>{t('browserResumeBlocked')}</span>
        {failure && <code className="browser-resume-notice__detail">{describeFailure(failure, t)}</code>}
      </div>
      <div className="browser-resume-notice__actions">
        <button type="button" className="browser-resume-notice__retry" autoFocus onClick={() => { void resumeBrowser(); }}>{t('browserRetry')}</button>
        <button type="button" className="browser-resume-notice__reload" onClick={() => window.location.reload()}>{t('browserReload')}</button>
      </div>
    </div>
  );
}

function describeFailure(failure: BrowserResumeFailure, t: (key: Key) => string): string {
  switch (failure.kind) {
    case 'session': return `${t('browserFailure.session')}: ${failure.detail}`;
    case 'timeout': return `${t('browserFailure.timeout')}${failure.pending.length ? `: ${failure.pending.slice(0, 3).join(', ')}` : ''}`;
    default: return `${t('browserFailure.read')}: ${failure.detail}${failure.status ? ` (${failure.status})` : ''}`;
  }
}
