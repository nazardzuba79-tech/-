import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { LanguageProvider } from '../lib/i18n';
import { ToastProvider } from '../lib/toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AuthPage } from '../pages/AuthPage';
import { RegisterPage } from '../pages/register/RegisterPage';
import { CopyTradingPage } from '../pages/CopyTradingPage';
import { WalletPage } from '../pages/WalletPage';
import { WalletPerformancePage } from '../pages/wallet-performance/WalletPerformancePage';
import { MarketsPage } from '../pages/MarketsPage';
import { FuturesPage } from '../pages/FuturesPage';
import { TradePage } from '../pages/TradePage';
import { HomePage } from '../pages/home/HomePage';
import { LegalPage } from '../pages/LegalPage';
import '../index.css';
// Home, Wallet and Register use the repository's scoped Tailwind utility
// layer. Production receives it through SettingsPage's lazy route import;
// the isolated review entry does not import SettingsPage, so it must opt in
// explicitly or those pages render as unstyled document flow on staging.
import '../pages/settings-arctic/tailwind-utilities.css';
import './review.css';

// A separate, public component-review entry point, NOT an authenticated app.
// Production App.tsx and its permission guards remain unchanged.
function Review() {
  return <BrowserRouter>
    <aside className="review-notice" role="note">
      <strong>VOLTEX · ISOLATED VISUAL REVIEW</strong>
      <span>No production connection. Do not enter real credentials. Account data and all API writes are disabled. Copy Trading figures are synthetic; market feeds may be unavailable.</span>
      <nav aria-label="Review pages">{['login', 'register', 'copy-trading', 'wallet', 'markets', 'futures'].map(path => <Link key={path} to={`/${path}`}>{path}</Link>)}</nav>
    </aside>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/copy-trading" element={<CopyTradingPage />} />
      <Route path="/wallet" element={<WalletPage />} />
      <Route path="/wallet/performance" element={<WalletPerformancePage />} />
      <Route path="/markets" element={<MarketsPage />} />
      <Route path="/futures" element={<FuturesPage />} />
      <Route path="/trade" element={<TradePage />} />
      <Route path="/legal/:doc" element={<LegalPage />} />
      <Route path="*" element={<p className="review-unavailable">This screen requires an authenticated staging backend and is not available in visual review. <Link to="/copy-trading">Back to review</Link></p>} />
    </Routes>
  </BrowserRouter>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><LanguageProvider><ToastProvider><Review /></ToastProvider></LanguageProvider></ErrorBoundary></React.StrictMode>,
);
