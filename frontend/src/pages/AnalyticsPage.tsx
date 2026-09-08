import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { AnalyticsWorkspace } from './analytics/AnalyticsWorkspace';

/**
 * Market and derivatives analytics.
 *
 * ── Access ──────────────────────────────────────────────────────────
 *
 * Available to any signed-in user. It used to run `useAdminGate` and
 * redirect everyone else to "/", which was correct while the page was an
 * empty admin placeholder AND while its endpoint carried provider circuit
 * state. Neither is true now: Analytics is an ordinary exchange feature,
 * and every number it shows is already visible on /markets or the futures
 * terminal.
 *
 * The gate did not disappear, it moved to where the sensitive data
 * actually is. Provider health — circuit state, cooldowns, rate-limit
 * counters — is served by `GET /analytics/diagnostics` and
 * `GET /market/status`, both still `requireAuth + requireAdmin`, and the
 * user-facing `getSnapshot()` has no access to the health registry at all.
 * That separation is structural rather than a field filter, so a later
 * edit cannot widen it by accident.
 *
 * `RequireAuth` in App.tsx remains the boundary for signed-out visitors,
 * and the server independently re-checks auth on every request — the
 * client-side guard was never what actually closed this route.
 *
 * The shell is deliberately thin: Nav and Footer are the app's own,
 * unmodified, and everything else lives in AnalyticsWorkspace.
 */
export function AnalyticsPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Nav active="/analytics" />
      <AnalyticsWorkspace />
      <Footer />
    </div>
  );
}
