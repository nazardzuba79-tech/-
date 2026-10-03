import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { LanguageProvider } from './lib/i18n';
import { ToastProvider } from './lib/toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SupportWidget } from './components/SupportWidget';
import './index.css';
import './spotTerminalOverrides.css';
import { prefetchCopyMarketplace } from './lib/useCopyMarketplace';
import { startBrowserActivity } from './lib/browserActivity';
import { validateBrowserSession } from './lib/browserSession';
import { getToken, onSessionChange } from './lib/api';
import { BrowserSleepNotice } from './components/BrowserSleepNotice';
import { startDepositCopyLog } from './lib/depositCopyLog';

startBrowserActivity({
  validate: validateBrowserSession,
  identity: getToken,
  // Admin's initial gate and every privileged server request still authorize
  // access. A brief tab switch is not a full idle wake; trading stays unchanged.
  briefReturnScope: () => /^\/admin(?:\/|$)/.test(window.location.pathname) ? window.location.pathname : null,
  // Watching a visible queue is work even without pointer input. Hidden tabs
  // still pause immediately; this never changes server session expiry/auth.
  keepVisibleActive: () => /^\/admin(?:\/|$)/.test(window.location.pathname),
});

// «Копировали адрес»: one more try for a note a closed tab left behind.
startDepositCopyLog();

function SessionContent() {
  const token = React.useSyncExternalStore(onSessionChange, getToken);
  return <React.Fragment key={token ?? 'guest'}><App /><SupportWidget /></React.Fragment>;
}

// Start authenticated direct-entry I/O alongside the lazy page chunk, before
// React commits. This is route-scoped; other pages create no Copy traffic.
if (window.location.pathname.replace(/\/$/, '') === '/copy-trading') prefetchCopyMarketplace();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <ToastProvider>
          <SessionContent />
          <BrowserSleepNotice />
        </ToastProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
// Tells the boot guard in index.html that the entry chunk ran and React owns
// #root from here on: a failure after this point is the ErrorBoundary's to
// handle, not a reason for the guard to reload.
document.documentElement.setAttribute('data-app-started', '');
