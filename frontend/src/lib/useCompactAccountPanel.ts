import { useEffect, useState } from 'react';

/**
 * Whether the terminal's bottom account panel is folded.
 *
 * IT STARTS OPEN. That is the whole of this change, and it is worth saying
 * why, because the previous default was deliberate and wrong.
 *
 * The panel used to fold itself whenever the account was verifiably empty —
 * no orders, no positions — on the reasoning that empty tables are wasted
 * space the chart could use. The result was that a new account, which is
 * every account at first, opened the terminal with the chart at full height
 * and the orders panel already collapsed to a 44px strip. Nobody asked for
 * that, and it hid the row of tabs a trader navigates by. Bybit and Binance
 * both open with the panel showing and let the trader take the height back
 * when they want it.
 *
 * So the fold is now a user action and nothing else: the panel is open on
 * every load, and stays open until someone presses the control. Collapsing
 * is still only offered while there is genuinely nothing in the tables —
 * a panel holding live positions may not be folded away.
 *
 * A DELIBERATE NON-FEATURE: the choice is not persisted. Reload, and the
 * panel is open again. A remembered fold is how the old default came back
 * to bite; if a trader wants the chart tall they press one key, and the
 * next visit starts from the state everyone agreed on.
 *
 * A display preference only: callers keep their account readers mounted.
 */
export function useCompactAccountPanel(verifiedEmpty: boolean, context: string) {
  const [collapsedContext, setCollapsedContext] = useState<string | null>(null);
  // New activity, an error or a fresh unknown account must reveal the body.
  // A position that opens while the panel is folded is exactly the thing the
  // trader needs to see, so the fold is dropped rather than kept.
  useEffect(() => {
    if (!verifiedEmpty) setCollapsedContext(null);
  }, [verifiedEmpty]);
  const compact = verifiedEmpty && collapsedContext === context;
  return {
    compact,
    canCompact: verifiedEmpty,
    /** Switching tab always shows the body; only the control folds it. */
    reveal: () => setCollapsedContext(null),
    toggle: () => {
      if (verifiedEmpty) setCollapsedContext(compact ? null : context);
    },
  };
}
