import { useSyncExternalStore } from 'react';
import { getBrowserPhase, getBrowserResumeFailure, onBrowserPhase, resumeBrowser } from '../lib/browserActivity';
import { useOptionalLanguage, type Key } from '../lib/i18n';
import { RU } from '../lib/i18n/locales/ru';
import './BrowserSleepNotice.css';

/** On a failed wake retain a small, generic retry control without exposing
 * internal fetch URLs, errors, status codes or request names to traders.
 * Session validation and trading-action lock remain in browserActivity. */
export function BrowserSleepNotice() {
  const phase = useSyncExternalStore(onBrowserPhase, getBrowserPhase);
  const failure = useSyncExternalStore(onBrowserPhase, getBrowserResumeFailure);
  const language = useOptionalLanguage();
  const t = (key: Key): string => (language ? language.t(key) : RU[key] ?? key);
  if (phase === 'active') return null;
  if (phase !== 'error') return <span hidden aria-hidden="true" data-browser-phase={phase} />;
  return (
    <div className="browser-resume-notice" role="alert" data-browser-notice="" data-browser-phase="error" data-browser-failure={failure?.kind}>
      <span className="browser-resume-notice__text">{t('browserResumeBlocked')}</span>
      <button type="button" className="browser-resume-notice__retry" onClick={() => { void resumeBrowser(); }}>{t('browserRetry')}</button>
    </div>
  );
}
