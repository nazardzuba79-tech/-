// Keep the existing local-only simulator boundary identical for its route and
// Wallet projection. Public feature flags alone do not authorize either view.
export function isStocksLocalPreviewHost(hostname: string | undefined): boolean {
  return hostname === '127.0.0.1';
}

/** The professional catalogue/terminal mounts on a hosted domain only with the explicit
 * build-time visibility flag; the synthetic simulator stays strictly loopback-only.
 * Neither switch authorizes trading or creates a price feed (#611 helper, canonical flag). */
export function shouldMountGlobalStocks(hostname: string | undefined, localSimulator: boolean, hostedStocks: boolean): boolean {
  return hostedStocks || (localSimulator && isStocksLocalPreviewHost(hostname));
}
