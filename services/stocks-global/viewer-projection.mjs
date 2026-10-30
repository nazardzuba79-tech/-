import { snapshot } from './engine.mjs';

const RESPONSE_METADATA = ['catalogue', 'metrics', 'account'];
// The same independent copy structuredClone makes of plain JSON data (objects, arrays, primitives, undefined
// properties kept), without its serializer: for the 50 viewers' polls structuredClone was a tenth of a
// millisecond per answer. Anything that is not a plain object or array still goes through structuredClone.
function plainCopy(value) {
  if (typeof value === 'function' || typeof value === 'symbol') return structuredClone(value); // refused as before
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(plainCopy);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return structuredClone(value);
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = plainCopy(value[key]);
  return copy;
}

// The worker already returned an account snapshot. Re-project its selected
// quote with the same engine rules, without cloning response-only metadata.
export function projectViewerQuote(view, instrumentId, quote, now) {
  const state = { ...view, quotes: { ...view.quotes, [instrumentId]: quote } };
  // Keep historical/held accounts on the original projection path. The measured
  // benefit is for empty read-only viewers, not large trading histories.
  if (view.orders.length || view.fills.length || Object.keys(view.positions).length || view.adjustments?.length) return snapshot(state, now);
  // Keep the existing keys in place so serialized response order is unchanged.
  for (const key of RESPONSE_METADATA) if (Object.hasOwn(view, key)) state[key] = undefined;
  const projected = snapshot(state, now, plainCopy);
  for (const key of RESPONSE_METADATA) if (Object.hasOwn(view, key)) projected[key] = view[key];
  return projected;
}
