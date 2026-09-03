import { useEffect, useState } from 'react';
import { api, getToken } from './api';

type Me = Awaited<ReturnType<typeof api.getMe>>;

export type AdminGate =
  | { status: 'loading'; me: null }
  | { status: 'denied'; me: null }
  | { status: 'ok'; me: Me };

/**
 * The single admin gate the client side has. Extracted from AdminLayout so
 * that a privileged page living outside /admin (the Analytics page) is
 * guarded by exactly the same check rather than by a second, subtly
 * different copy of it.
 *
 * This is a UX convenience only — it decides what to render, nothing more.
 * Every privileged request is independently re-checked for role ADMIN on
 * the server (see the requireAdmin middleware), and the check here is
 * against `role` as reported by GET /me, never against an email address or
 * a user id: the backend is the only place an identity is ever compared.
 *
 * Callers render their own denied state so each keeps whatever redirect its
 * area already used; both current callers use <Navigate to="/" replace />.
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
