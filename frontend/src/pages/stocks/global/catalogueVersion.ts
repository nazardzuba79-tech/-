// The gateway names the catalogue version on every state answer and leaves the catalogue (about 17 KB, reloaded
// at most once a minute) out when the read already holds that version (?catalogue=<version>). This keeps the
// last full catalogue and completes each answer from it.
export type CatalogueCache<T> = { version: string; list: T[] } | null;
const VERSION = /^[a-f0-9]{16}$/;

export function catalogueQuery<T>(cache: CatalogueCache<T>): string {
  return cache ? '&catalogue=' + cache.version : '';
}

/** The answer's catalogue (from the cache when the gateway left it out) and the cache to keep, or null when the
 * answer cannot be completed; the caller then drops the cache, so the next read asks for the full catalogue. */
export function settleCatalogue<T>(cache: CatalogueCache<T>, answer: { catalogue?: unknown; catalogueVersion?: unknown }): { list: T[]; cache: CatalogueCache<T> } | null {
  const version = typeof answer.catalogueVersion === 'string' && VERSION.test(answer.catalogueVersion) ? answer.catalogueVersion : null;
  if (Array.isArray(answer.catalogue)) return { list: answer.catalogue as T[], cache: version ? { version, list: answer.catalogue as T[] } : null };
  if (cache && version === cache.version) return { list: cache.list, cache };
  return null;
}
