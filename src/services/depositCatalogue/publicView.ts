import { DEPOSIT_RAILS, railKey } from './registry';
import type { CatalogueDocument } from './schema';

/** Every registry rail resolved against the stored document (overrides win over the baseline). */
export function resolvedEntries(document: CatalogueDocument) {
  const entries = new Map([...document.baseline, ...document.overrides].map(e => [railKey(e), e]));
  return DEPOSIT_RAILS.map(rail => {
    const entry = entries.get(railKey(rail));
    return { ...rail, address: entry?.address ?? '', memo: entry?.memo ?? '', memoLabel: entry?.memoLabel || (rail.memoAllowed ? rail.memoLabel : ''),
      enabled: entry?.enabled ?? false, status: (!entry?.address ? 'unconfigured' : entry.enabled ? 'configured' : 'disabled') as 'configured' | 'unconfigured' | 'disabled' };
  });
}

/**
 * What any visitor may see: active destinations only (enabled with an
 * address), without the admin status field. Render and the Cloudflare public
 * read both use this function, and both version it as the SHA-256 hex of
 * `publicCatalogueBody(entries)`, so the two answers are byte-identical.
 */
export function publicEntries(document: CatalogueDocument) {
  return resolvedEntries(document).filter(e => e.status === 'configured').map(({ status: _status, ...entry }) => entry);
}
export const publicCatalogueBody = (entries: ReturnType<typeof publicEntries>) => JSON.stringify(entries);
