import { quoteStatus } from './engine.mjs';

// Informational only. This never admits a quote, renews its age or replaces the
// original QUOTE_STALE error. Recovery itself needs authoritative worker state;
// the server can prove only this narrower, otherwise-fresh pre-demand case.
export function preDemandReadiness(quote, now, demandSince) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(demandSince) || demandSince <= 0 || demandSince > now ||
      !quote || quote.timestamp >= demandSince || quoteStatus(quote, now, 'USDT') !== 'READY') return null;
  return {
    state: 'WAITING_FOR_QUOTE', reason: 'BEFORE_DEMAND', executable: false,
    quoteTimestamp: quote.timestamp, receivedAt: quote.receivedAt, demandSince,
  };
}
