import { snapshot } from './engine.mjs';

const RESPONSE_METADATA = ['catalogue', 'metrics', 'account'];

// The worker already returned an account snapshot. Re-project its selected
// quote with the same engine rules, without cloning response-only metadata.
export function projectViewerQuote(view, instrumentId, quote, now) {
  const state = { ...view, quotes: { ...view.quotes, [instrumentId]: quote } };
  // Keep historical/held accounts on the original projection path. The measured
  // benefit is for empty read-only viewers, not large trading histories.
  if (view.orders.length || view.fills.length || Object.keys(view.positions).length || view.adjustments?.length) return snapshot(state, now);
  // Keep the existing keys in place so serialized response order is unchanged.
  for (const key of RESPONSE_METADATA) if (Object.hasOwn(view, key)) state[key] = undefined;
  const projected = snapshot(state, now);
  for (const key of RESPONSE_METADATA) if (Object.hasOwn(view, key)) projected[key] = view[key];
  return projected;
}
