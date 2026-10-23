// Keep the existing local-only simulator boundary identical for its route and
// Wallet projection. Public feature flags alone do not authorize either view.
export function isStocksLocalPreviewHost(hostname: string | undefined): boolean {
  return hostname === '127.0.0.1';
}

/** A distinct, build-time opt-in for the real VOLTEX login on a hosted domain.
 * The existing synthetic simulator stays STRICTLY loopback-only. Neither
 * switch authorizes server trading or creates/assumes a price feed. */
export function shouldMountGlobalStocks(hostname: string | undefined, localSimulator: boolean, hostedPilot: boolean): boolean {
  return hostedPilot || (localSimulator && isStocksLocalPreviewHost(hostname));
}
