import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/home/HomePage';
import { RouteShell } from './RouteShell';
import { defaultTradingPath } from './lib/tradingMode';
import { loginPathFor, readNext } from './lib/returnTo';
import { getToken } from './lib/api';
import { prefetchCopyMarketplace } from './lib/useCopyMarketplace';

const RegisterPage = lazy(() => import('./pages/register/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const TradePage = lazy(() => import('./pages/TradePage').then((m) => ({ default: m.TradePage })));
const FuturesPage = lazy(() => import('./pages/FuturesPage').then((m) => ({ default: m.FuturesPage })));
const PrivateTradingPage = lazy(() => import('./pages/private-trading/PrivateTradingPage').then((m) => ({ default: m.PrivateTradingPage })));
const MarketsPage = lazy(() => import('./pages/MarketsPage').then((m) => ({ default: m.MarketsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const CardPage = lazy(() => import('./pages/CardPage').then((m) => ({ default: m.CardPage })));
const OtcPage = lazy(() => import('./pages/OtcPage').then((m) => ({ default: m.OtcPage })));
const WalletPage = lazy(() => import('./pages/WalletPage').then((m) => ({ default: m.WalletPage })));
const BankingPage = lazy(() => import('./pages/BankingPage').then((m) => ({ default: m.BankingPage })));
const CopyTradingPage = lazy(() => {
  prefetchCopyMarketplace();
  return import('./pages/CopyTradingPage').then((m) => ({ default: m.CopyTradingPage }));
});
const ArbitragePage = lazy(() => import('./pages/ArbitragePage').then((m) => ({ default: m.ArbitragePage })));
const TradingBotsPage = lazy(() => import('./pages/TradingBotsPage').then((m) => ({ default: m.TradingBotsPage })));
const LegalPage = lazy(() => import('./pages/LegalPage').then((m) => ({ default: m.LegalPage })));
const ReferralRedirectPage = lazy(() => import('./pages/ReferralRedirectPage').then((m) => ({ default: m.ReferralRedirectPage })));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const AdminWalletsPage = lazy(() => import('./pages/admin/AdminWalletsPage').then((m) => ({ default: m.AdminWalletsPage })));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage = lazy(() => import('./pages/admin/AdminUserDetailPage').then((m) => ({ default: m.AdminUserDetailPage })));
const AdminKycPage = lazy(() => import('./pages/admin/AdminKycPage').then((m) => ({ default: m.AdminKycPage })));
const AdminWithdrawalsPage = lazy(() => import('./pages/admin/AdminWithdrawalsPage').then((m) => ({ default: m.AdminWithdrawalsPage })));
const AdminDepositsPage = lazy(() => import('./pages/admin/AdminDepositsPage').then((m) => ({ default: m.AdminDepositsPage })));
const AdminAuditLogPage = lazy(() => import('./pages/admin/AdminAuditLogPage').then((m) => ({ default: m.AdminAuditLogPage })));
const AdminSupportPage = lazy(() => import('./pages/admin/AdminSupportPage').then((m) => ({ default: m.AdminSupportPage })));

/** Query-string routing stays here so the ordinary Futures path has exactly
 * one lazy chunk: App -> FuturesPage. The exceptional private card surface is
 * separately lazy and remains server-authorized after this selector. */
function FuturesEntry() {
  const [params] = useSearchParams();
  return params.get('card') ? <PrivateTradingPage /> : <FuturesPage />;
}

function usePrefetchLikelyRoutes() {
  useEffect(() => {
    if (!getToken()) return;
    const warm = () => {
      const terminal = defaultTradingPath();
      void (terminal === '/futures' ? import('./pages/FuturesPage') : import('./pages/TradePage')).catch(() => {});
      void import('./pages/WalletPage').catch(() => {});
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      const handle = idle(warm, { timeout: 3000 });
      return () => (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(warm, 1500);
    return () => clearTimeout(timer);
  }, []);
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation();
  return getToken() ? children : <Navigate to={loginPathFor(location)} replace />;
}

/** The token has to be read while this renders, not while the route table is
 * built. App holds no state, so an element decided at load time never changes:
 * a visitor who pressed «Выйти» while signed in was still handed the frozen
 * redirect to the terminal, and the terminal's own guard then sent them to the
 * sign-in page — instead of the home page `handleLogout` navigates to. Every
 * other route already defers the read to a component; this one now does too. */
function RootEntry() {
  return getToken() ? <Navigate to={defaultTradingPath()} replace /> : <HomePage />;
}

function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  const location = useLocation();
  if (!getToken()) return children;
  return <Navigate to={readNext(location.search) ?? defaultTradingPath()} replace />;
}

export function App() {
  usePrefetchLikelyRoutes();
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteShell />}>
      <Routes>
        <Route path="/" element={<RootEntry />} />
        <Route path="/login" element={<RedirectIfAuthed><AuthPage /></RedirectIfAuthed>} />
        <Route path="/register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
        <Route path="/trade" element={<RequireAuth><TradePage /></RequireAuth>} />
        <Route path="/futures" element={<RequireAuth><FuturesEntry /></RequireAuth>} />
        <Route path="/markets" element={<RequireAuth><MarketsPage /></RequireAuth>} />
        <Route path="/banking" element={<RequireAuth><BankingPage /></RequireAuth>} />
        <Route path="/earn" element={<Navigate to="/banking" replace />} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/card" element={<RequireAuth><CardPage /></RequireAuth>} />
        <Route path="/wallet" element={<RequireAuth><WalletPage /></RequireAuth>} />
        <Route path="/otc" element={<RequireAuth><OtcPage /></RequireAuth>} />
        <Route path="/dashboard" element={<Navigate to="/wallet" replace />} />
        <Route path="/copy-trading" element={<RequireAuth><CopyTradingPage /></RequireAuth>} />
        <Route path="/arbitrage" element={<RequireAuth><ArbitragePage /></RequireAuth>} />
        <Route path="/trading-bots" element={<RequireAuth><TradingBotsPage /></RequireAuth>} />
        <Route path="/analytics" element={<Navigate to="/markets?view=analytics" replace />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="/:code" element={<ReferralRedirectPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          {/* No overview step: the console opens on the list an operator
              actually works from. */}
          <Route index element={<Navigate to="users" replace />} />
          <Route path="wallets" element={<AdminWalletsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/:id" element={<AdminUserDetailPage />} />
          <Route path="kyc" element={<AdminKycPage />} />
          <Route path="withdrawals" element={<AdminWithdrawalsPage />} />
          <Route path="deposits" element={<AdminDepositsPage />} />
          <Route path="audit-log" element={<AdminAuditLogPage />} />
          <Route path="support" element={<AdminSupportPage />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
