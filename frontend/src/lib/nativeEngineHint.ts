/**
 * Which engine this user's Futures ticket belonged to last time — a DISPLAY
 * hint only, remembered across tabs so the ticket can paint its final shape
 * on the first frame (owner, 2026-09-29: «Только уменьшение» appeared first
 * and TP/SL a moment later, when the access verdict arrived).
 *
 * It decides whether a control is drawn while the verdict is still unknown,
 * nothing else: no order can be placed until the engine reports `ready`, and
 * the server's verdict replaces the hint the moment it arrives. It is keyed
 * by the user id only (the JWT `sub`), never by the token itself.
 */
const PREFIX = 'voltex:native-engine:v1:';

function userScope(token: string | null): string | null {
  if (!token || typeof atob !== 'function') return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const raw = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(raw + '='.repeat((4 - raw.length % 4) % 4)));
    return typeof claims?.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

function hintStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/** True when this user was last bound to the simulation engine. */
export function readNativeEngineHint(token: string | null, storage?: Storage | null): boolean {
  const scope = userScope(token), store = hintStorage(storage);
  if (!scope || !store) return false;
  try { return store.getItem(PREFIX + scope) === '1'; } catch { return false; }
}

/** Record the server's verdict: set for the simulation engine, cleared for the real one. */
export function writeNativeEngineHint(token: string | null, native: boolean, storage?: Storage | null): void {
  const scope = userScope(token), store = hintStorage(storage);
  if (!scope || !store) return;
  try {
    if (native) store.setItem(PREFIX + scope, '1');
    else store.removeItem(PREFIX + scope);
  } catch { /* storage refused: the hint simply stays unknown */ }
}
