import { getToken, onSessionChange } from './api';
import { adminRead } from './adminReadApi';

// Capabilities only: no balances, passwords, documents or histories are cached.
// A refresh must always read current data after any administrative mutation.
let session = getToken();
let generation = 0;
const missing = new Set<string>();
onSessionChange(() => { session = getToken(); generation++; missing.clear(); });

export async function compatibleAdminRead<T>(capability: string, path: string,
  legacy: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal, identityRoute = false): Promise<T> {
  const token = getToken();
  if (token !== session) { session = token; generation++; missing.clear(); }
  const currentGeneration = generation;
  const check = () => { if (signal?.aborted || getToken() !== token || generation !== currentGeneration) throw new DOMException('Session changed', 'AbortError'); };
  check();
  if (!missing.has(capability)) {
    try { const result = await adminRead<T>(path, signal); check(); return result; }
    catch (error) {
      const failure = error as { status?: number; code?: string };
      // A current-session 401 deliberately clears the token in adminRead.
      // Preserve SESSION_EXPIRED rather than replacing it with cancellation.
      if (failure.status !== 404) throw error;
      check();
      // /users/page on the older router matches /users/:id and therefore returns
      // User not found. That alias is NOT evidence of a missing account.
      if (identityRoute && failure.code === 'USER_NOT_FOUND') throw error;
    }
  }
  const result = await legacy(signal);
  check();
  missing.add(capability);
  return result;
}
