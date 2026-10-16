// Response encoding only. No account, authentication, quote or execution result
// is retained. The caller must publish the returned owned catalogue snapshot.
const UNSUPPORTED = Symbol('unsupported plain JSON data');
const MAX_FRAGMENT_BYTES = 1024 * 1024;

function plainData(value, budget, { copy = false, skipRootKey } = {}, depth = 0, ancestors = new Set()) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    budget.characters -= value.length;
    return budget.characters >= 0 ? value : UNSUPPORTED;
  }
  if (typeof value !== 'object' || depth > 16 || --budget.objects < 0 || ancestors.has(value)) return UNSUPPORTED;
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return UNSUPPORTED;
  // Reject large ledgers before enumerating their indices or allocating one
  // descriptor per order/fill. The fallback should pay only the baseline cost.
  if (array) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length > budget.entries) return UNSUPPORTED;
  }
  // JSON.stringify consults toJSON, including an inherited method. Accessors
  // and custom objects keep the original encoder and its side effects/errors.
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') ||
      array && Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON') ||
      Object.getOwnPropertySymbols(value).length) return UNSUPPORTED;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Object.keys(descriptors);
  if (Object.hasOwn(descriptors, 'toJSON')) return UNSUPPORTED;
  budget.entries -= array ? descriptors.length.value : keys.length;
  if (budget.entries < 0) return UNSUPPORTED;
  const result = copy ? array ? new Array(descriptors.length.value) : Object.create(prototype) : value;
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
        array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= descriptors.length.value)) {
      ancestors.delete(value); return UNSUPPORTED;
    }
    budget.characters -= key.length;
    if (budget.characters < 0) { ancestors.delete(value); return UNSUPPORTED; }
    if (depth === 0 && key === skipRootKey) continue;
    const next = plainData(descriptor.value, budget, { copy }, depth + 1, ancestors);
    if (next === UNSUPPORTED) { ancestors.delete(value); return UNSUPPORTED; }
    if (copy) Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true });
  }
  ancestors.delete(value);
  return copy ? Object.freeze(result) : result;
}

// The input is already JSON.stringify output. Locate only a root-level property,
// ignoring escaped text and nested objects. No user-controlled marker is used.
function catalogueNullOffset(encoded) {
  let depth = 0;
  for (let index = 0; index < encoded.length; index++) {
    const character = encoded[index];
    if (character === '"') {
      const start = index;
      while (++index < encoded.length) {
        if (encoded[index] === '\\') index++;
        else if (encoded[index] === '"') break;
      }
      if (depth === 1 && encoded.slice(start, index + 1) === '"catalogue"' && encoded.slice(index + 1, index + 6) === ':null') return index + 2;
    } else if (character === '{' || character === '[') depth++;
    else if (character === '}' || character === ']') depth--;
  }
  return -1;
}

export function createStateResponseSerializer() {
  let current = null;
  return {
    publishCatalogue(catalogue) {
      // Clear first: a rejected publication must not retain/use the old fragment.
      current = null;
      if (!Array.isArray(catalogue)) return catalogue;
      const snapshot = plainData(catalogue, { objects: 2048, entries: 8192, characters: 131072 }, { copy: true });
      if (snapshot === UNSUPPORTED) return catalogue;
      const encoded = JSON.stringify(snapshot);
      if (Buffer.byteLength(encoded) > MAX_FRAGMENT_BYTES) return catalogue;
      current = { catalogue: snapshot, encoded };
      return snapshot;
    },
    stringify(body) {
      const cached = current;
      if (!cached || body === null || typeof body !== 'object' || Array.isArray(body)) return JSON.stringify(body);
      const descriptor = Object.getOwnPropertyDescriptor(body, 'catalogue');
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value !== cached.catalogue) return JSON.stringify(body);
      // Only bounded ordinary response data uses the fast path. Large ledgers,
      // getters, custom toJSON/prototypes and cycles preserve baseline behavior.
      if (plainData(body, { objects: 128, entries: 512, characters: 32768 }, { skipRootKey: 'catalogue' }) === UNSUPPORTED) return JSON.stringify(body);
      // No replacer callback per node. All remaining values are unchanged plain
      // data and the root spread preserves JSON.stringify's property ordering.
      const encoded = JSON.stringify({ ...body, catalogue: null });
      const offset = catalogueNullOffset(encoded);
      // Defensive fail-safe; valid admitted roots always contain this property.
      if (offset < 0) return JSON.stringify(body);
      return encoded.slice(0, offset) + cached.encoded + encoded.slice(offset + 4);
    },
  };
}
