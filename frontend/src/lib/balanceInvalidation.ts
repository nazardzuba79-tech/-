import { getToken } from './api';
// Action-driven invalidation only. No timer, polling or account data in storage.
const eventName = 'voltex:balance-invalidated';
const storageKey = 'voltex:balance-revision';
function account() { try { return JSON.parse(atob((getToken() ?? '').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub as string; } catch { return null; } }
export function invalidateSpendableBalances() {
  window.dispatchEvent(new Event(eventName));
  try { localStorage.setItem(storageKey,JSON.stringify({ account:account(),nonce:crypto.randomUUID() })); } catch { /* same-tab invalidation already delivered */ }
}
export function onSpendableBalancesChanged(fn: () => void) {
  const changed = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return;
    try { if (JSON.parse(event.newValue).account === account()) fn(); } catch { /* malformed external storage */ }
  };
  window.addEventListener(eventName,fn); window.addEventListener('storage',changed);
  return () => { window.removeEventListener(eventName,fn); window.removeEventListener('storage',changed); };
}
