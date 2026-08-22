import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { TradePage } from './pages/TradePage';
import { MarketsPage } from './pages/MarketsPage';
import { SettingsPage } from './pages/SettingsPage';
import { CardPage } from './pages/CardPage';
import { WalletPage } from './pages/WalletPage';
import { LegalPage } from './pages/LegalPage';
import { getToken } from './lib/api';

function RequireAuth({ children }: { children: JSX.Element }) {
  return getToken() ? children : <Navigate to="/" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={getToken() ? <Navigate to="/trade" replace /> : <AuthPage />} />
        <Route
          path="/trade"
          element={
            <RequireAuth>
              <TradePage />
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
        {/* Public — reachable both signed-in (footer link) and from the
            login screen, without requiring auth like every other page. */}
        <Route path="/legal/:doc" element={<LegalPage />} />
      </Routes>
    </BrowserRouter>
  );
}
