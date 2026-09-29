import { API_BASE, clearToken, getToken } from './api';

/** One request on return, using the raw transport so validation precedes display reads. */
export async function validateBrowserSession() {
  const token = getToken();
  if (!token) return;
  const controller = new AbortController();
  // Bounded session-read deadline; hosting availability is independent of tab sleep.
  // No retry, heartbeat, or request to suspend the backend.
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await globalThis.fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      cache: 'no-store',
    });
    if (getToken() !== token) throw new Error('Session changed');
    if (response.status === 401 || response.status === 403) {
      clearToken();
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      throw new Error('Session expired');
    }
    if (!response.ok) throw new Error('Session validation unavailable');
    await response.json();
    if (getToken() !== token) throw new Error('Session changed');
  } finally { clearTimeout(timeout); }
}
