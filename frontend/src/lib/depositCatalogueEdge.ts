/** Pure (no import.meta): validates the build-time Cloudflare catalogue origin. https only; http only for a 127.0.0.1 test Worker. */
export function resolveCatalogueEdge(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const loopback = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}
