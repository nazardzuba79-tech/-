import { useEffect, useState } from 'react';
import { api, getToken } from './api';

type Me = Awaited<ReturnType<typeof api.getMe>>;

export type AdminGate =
  | { status: 'loading'; me: null }
  | { status: 'denied'; me: null }
  | { status: 'ok'; me: Me };

/**
 * The single admin gate the client side has.
 *
 * It was extracted from AdminLayout so the Analytics page could share the
 * same check; Analytics is now an ordinary signed-in feature and no longer
 * uses it, because what actually needed gating was the operational
 * provider-health data, not the page. That data moved behind
 * /analytics/diagnostics and /market/status, both server-side admin
 * routes. /admin remains this hook's caller.
 *
 * This is a UX convenience only — it decides what to render, nothing more.
 * Every privileged request is independently re-checked for role ADMIN on
 * the server (see the requireAdmin middleware), and the check here is
 * against `role` as reported by GET /me, never against an email address or
 * a user id: the backend is the only place an identity is ever compared.
 *
 * Callers render their own denied state so each keeps whatever redirect its
 * area already used; the current caller uses <Navigate to="/" replace />.
 */
export function useAdminGate(): AdminGate {
  const [gate, setGate] = useState<AdminGate>({ status: 'loading', me: null });

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setGate({ status: 'denied', me: null });
      return;
    }
    api
      .getMe()
      .then((data) => {
        if (cancelled) return;
        setGate(data.isAdmin ? { status: 'ok', me: data } : { status: 'denied', me: null });
      })
      .catch(() => {
        if (!cancelled) setGate({ status: 'denied', me: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return gate;
}
