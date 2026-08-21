import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { TradePage } from './pages/TradePage';
import { ProductsPage } from './pages/ProductsPage';
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
          path="/products"
          element={
            <RequireAuth>
              <ProductsPage />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
