import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { LanguageProvider } from './lib/i18n';
import { ToastProvider } from './lib/toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SupportWidget } from './components/SupportWidget';
import './index.css';
import { prefetchCopyMarketplace } from './lib/useCopyMarketplace';

// Start authenticated direct-entry I/O alongside the lazy page chunk, before
// React commits. This is route-scoped; other pages create no Copy traffic.
if (window.location.pathname.replace(/\/$/, '') === '/copy-trading') prefetchCopyMarketplace();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <ToastProvider>
          <App />
          <SupportWidget />
        </ToastProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
