// Keep the existing local-only simulator boundary identical for its route and
// Wallet projection. Public feature flags alone do not authorize either view.
export function isStocksLocalPreviewHost(hostname: string | undefined): boolean {
  return hostname === '127.0.0.1';
}
