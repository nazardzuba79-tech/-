import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/home/HomePage';
import { RegisterPage } from './pages/register/RegisterPage';
import { TradePage } from './pages/TradePage';
import { FuturesPage } from './pages/FuturesPage';
import { MarketsPage } from './pages/MarketsPage';
import { SettingsPage } from './pages/SettingsPage';
import { CardPage } from './pages/CardPage';
import { OtcPage } from './pages/OtcPage';
import { WalletPage } from './pages/WalletPage';
import { CopyTradingPage } from './pages/CopyTradingPage';
import { ArbitragePage } from './pages/ArbitragePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { LegalPage } from './pages/LegalPage';
import { ReferralRedirectPage } from './pages/ReferralRedirectPage';
import { defaultTradingPath } from './lib/tradingMode';
import { getToken } from './lib/api';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminWalletsPage } from './pages/admin/AdminWalletsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminUserDetailPage } from './pages/admin/AdminUserDetailPage';
import { AdminKycPage } from './pages/admin/AdminKycPage';
import { AdminWithdrawalsPage } from './pages/admin/AdminWithdrawalsPage';
import { AdminDepositsPage } from './pages/admin/AdminDepositsPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import { AdminAuditLogPage } from './pages/admin/AdminAuditLogPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  return getToken() ? children : <Navigate to="/" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* These two, and AuthPage's post-sign-in redirect, are the only
            places the app picks a terminal without the user naming one, so
            they are the only places the trading-mode preference applies —
            see lib/tradingMode. A direct /trade or /futures URL is its own
            route and is never rewritten. */}
        <Route path="/" element={getToken() ? <Navigate to={defaultTradingPath()} replace /> : <HomePage />} />
        <Route path="/login" element={getToken() ? <Navigate to={defaultTradingPath()} replace /> : <AuthPage />} />
        {/* Registration is its own screen (the approved two-column design)
            rather than a mode of the login form. Both entry points point
            straight here: the homepage header's primary CTA and the login
            card's own Регистрация tab. AuthPage keeps its /login behaviour
            untouched. */}
        <Route path="/register" element={getToken() ? <Navigate to={defaultTradingPath()} replace /> : <RegisterPage />} />
        <Route
          path="/trade"
          element={
            <RequireAuth>
              <TradePage />
            </RequireAuth>
          }
        />
        <Route
          path="/futures"
          element={
            <RequireAuth>
              <FuturesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/markets"
          element={
            <RequireAuth>
              <MarketsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/card"
          element={
            <RequireAuth>
              <CardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/wallet"
          element={
            <RequireAuth>
              <WalletPage />
            </RequireAuth>
          }
        />
        <Route
          path="/otc"
          element={
            <RequireAuth>
              <OtcPage />
            </RequireAuth>
          }
        />
        {/* Dashboard folded into Wallet (see WalletPage's doc comment) —
            redirect rather than a hard 404 for anything that still links
            to the old path. */}
        <Route path="/dashboard" element={<Navigate to="/wallet" replace />} />
        <Route
          path="/copy-trading"
          element={
            <RequireAuth>
              <CopyTradingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/arbitrage"
          element={
            <RequireAuth>
              <ArbitragePage />
            </RequireAuth>
          }
        />
        {/* Admin-only for now, but a normal page rather than part of the
            /admin shell. RequireAuth handles the signed-out case; the page
            itself runs the same useAdminGate check /admin does, so an
            ordinary user landing here directly is redirected to "/". */}
        <Route
          path="/analytics"
          element={
            <RequireAuth>
              <AnalyticsPage />
            </RequireAuth>
          }
        />
        {/* Public — reachable both signed-in (footer link) and from the
            login screen, without requiring auth like every other page. */}
        <Route path="/legal/:doc" element={<LegalPage />} />
        {/* A referral link (see Settings' Referral tab) — public, no auth,
            since it has to work for someone who's never signed up yet. Bare
            /:code (no "/r/" prefix) since the code itself already reads as
            a referral code; react-router ranks every static route above
            this dynamic one, so it never shadows /trade, /wallet, etc. */}
        <Route path="/:code" element={<ReferralRedirectPage />} />

        {/* Admin panel — deliberately not linked from anywhere in the
            normal UI, reachable only by a direct visit. AdminLayout is a
            UX-only gate; every request underneath is independently
            re-checked for role ADMIN on the server (see requireAdmin). */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="wallets" element={<AdminWalletsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/:id" element={<AdminUserDetailPage />} />
          <Route path="kyc" element={<AdminKycPage />} />
          <Route path="withdrawals" element={<AdminWithdrawalsPage />} />
          <Route path="deposits" element={<AdminDepositsPage />} />
          <Route path="products" element={<AdminProductsPage />} />
          <Route path="audit-log" element={<AdminAuditLogPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
