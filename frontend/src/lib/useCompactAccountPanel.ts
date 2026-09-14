import { useEffect, useState } from 'react';

/** A display preference only: callers keep their account readers mounted. */
export function useCompactAccountPanel(verifiedEmpty: boolean, context: string) {
  const [expandedContext, setExpandedContext] = useState<string | null>(null);
  // New activity, an error or a fresh unknown account must reveal the body.
  // Clear a previous manual reveal so a later confirmed-empty result may fold.
  useEffect(() => {
    if (!verifiedEmpty) setExpandedContext(null);
  }, [verifiedEmpty]);
  const compact = verifiedEmpty && expandedContext !== context;
  return {
    compact,
    canCompact: verifiedEmpty,
    reveal: (nextContext = context) => setExpandedContext(nextContext),
    toggle: () => {
      if (verifiedEmpty) setExpandedContext(compact ? context : null);
    },
  };
}
