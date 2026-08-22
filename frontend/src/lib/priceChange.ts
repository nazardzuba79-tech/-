// The backend (KrakenMarketDataService) already computes changePercent24h
// as a percentage value, e.g. "2.10" meaning +2.10% — NOT a fraction like
// 0.021. Every call site must parse it directly; re-multiplying by 100
// (as several components used to) turns a real +2.1% move into a
// displayed +210%, which is exactly the "+300%/-300%" bug reports this
// fixes. Centralized here so that mistake can't be reintroduced per call
// site, and so every reading gets the same anomaly check.
const ANOMALY_THRESHOLD_PCT = 50;

export function parseChangePercent(raw: string, context: string): number {
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) > ANOMALY_THRESHOLD_PCT) {
    // A single asset moving more than 50% in 24h is rare enough that it's
    // more likely a data glitch (stale/zero reference price, a bad tick
    // from the upstream feed) than a real move — flag it rather than
    // silently rendering a number that will look like a bug to the user.
    console.warn(
      `[priceChange] Suspicious 24h change for ${context}: ${value}% (raw="${raw}"). ` +
        `Treating as real, but this is above the ${ANOMALY_THRESHOLD_PCT}% sanity threshold — worth checking the upstream Kraken data.`
    );
  }
  return value;
}
