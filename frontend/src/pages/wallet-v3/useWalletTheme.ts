import { useCallback, useEffect, useState } from 'react';

/**
 * THE WALLET'S OWN LIGHT/DARK SWITCH.
 *
 * The approved design is a light workspace with a dark variant beside it,
 * and the choice belongs to the reader, not to the operating system: an
 * operator who set the ledger to dark expects it dark on the next visit
 * too, whatever their laptop is doing that evening. So the preference is
 * stored and never inferred from `prefers-color-scheme`.
 *
 * It is applied as `data-wallet-theme` on the document element rather than
 * on the page's own node, because the Wallet's dialogs are portalled to the
 * body: one attribute themes both `.vx-wallet` and `.vx-wallet-modal-root`
 * (see wallet.css). Nothing outside the Wallet reads it — every rule that
 * does is scoped to those two classes — and it is removed when the page
 * unmounts, so it cannot linger on Trade or Futures.
 */
export type WalletTheme = 'light' | 'dark';

const STORAGE_KEY = 'exchange_wallet_theme';
const ATTRIBUTE = 'data-wallet-theme';

function stored(): WalletTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    // Private windows and blocked storage: the workspace still renders, it
    // just opens light and does not remember the choice.
    return 'light';
  }
}

export function useWalletTheme(): { theme: WalletTheme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<WalletTheme>(stored);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(ATTRIBUTE, theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // best-effort — the toggle just won't persist across reloads
    }
    return () => root.removeAttribute(ATTRIBUTE);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((current) => (current === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggleTheme };
}
