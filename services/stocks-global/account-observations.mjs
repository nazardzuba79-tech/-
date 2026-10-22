import { createHash } from 'node:crypto';
import { active, check, quoteStatus, snapshot, submit } from './engine.mjs';
import { instrument } from './catalog.mjs';

const digest = q => createHash('sha256').update(JSON.stringify(q ?? null)).digest('hex');
const hasOrders = (state, id) => state.orders.some(o => o.instrumentId === id && active(o));

// A bounded read model, never an acknowledgement of durable account state.
// Handles/tombstones have the worker's existing 512-account lifetime. Losing a
// whole handle requires a provider timestamp beyond the recovery epoch + the
// engine's accepted 2s future skew; receipt time alone cannot prove monotonicity.
export function createObservations({ now = Date.now, maxBytes = 4 * 1048576 } = {}) {
  const owners = new Map(), lru = new Map();
  let bytes = 0;
  const counters = { observationsVolatile: 0, observationsDurable: 0, observationEvictions: 0 };
  const key = (owner, id) => owner + '/' + id;
  const dropPayload = (owner, id, slot) => {
    if (slot.quote) { bytes -= slot.bytes; slot.quote = null; slot.bytes = 0; }
    lru.delete(key(owner, id));
  };
  const entry = owner => { const value = owners.get(owner); check(value, 'ACCOUNT_UNAVAILABLE'); return value; };
  const slotFor = (owner, state, id) => {
    const account = entry(owner); let slot = account.slots.get(id);
    if (!slot) {
      check(instrument(id), 'INVALID_PAIR');
      const q = state.quotes[id];
      slot = { quote: null, bytes: 0, timestamp: q?.timestamp ?? -1, eventKey: digest(q?.eventId), used: q?.used ?? '0.00000000', base: digest(q), revision: state.revision, active: hasOrders(state, id), failed: false, recovery: account.recovery };
      account.slots.set(id, slot);
    }
    return slot;
  };
  const retain = (owner, id, slot, quote) => {
    dropPayload(owner, id, slot);
    const size = Buffer.byteLength(JSON.stringify(quote));
    check(size <= maxBytes, 'INVALID_QUOTE');
    slot.quote = structuredClone(quote); slot.bytes = size; bytes += size;
    lru.set(key(owner, id), { owner, id, slot });
    while (bytes > maxBytes) {
      const first = lru.values().next().value;
      dropPayload(first.owner, first.id, first.slot); counters.observationEvictions++;
    }
  };
  const usable = slot => !!slot?.quote && !slot.failed && slot.recovery === null;
  const view = (owner, state, time = now()) => {
    const account = entry(owner);
    for (const id of new Set([...Object.keys(state.quotes), ...account.slots.keys()])) {
      const slot = account.slots.get(id);
      const current = slot?.revision === state.revision && slot?.base === digest(state.quotes[id]);
      if (usable(slot) && current && !hasOrders(state, id)) state.quotes[id] = structuredClone(slot.quote);
      else if ((!slot || !usable(slot) || !current) && state.quotes[id]) state.quotes[id] = { ...state.quotes[id], failed: true };
    }
    return snapshot(state, time);
  };
  return {
    register(owner, created) { owners.set(owner, { recovery: created ? null : now() + 2000, slots: new Map() }); },
    forget(owner) { const account = owners.get(owner); if (account) for (const [id, slot] of account.slots) dropPayload(owner, id, slot); owners.delete(owner); },
    hasOrders,
    view,
    // Called in worker order, from trusted server observations only. No source
    // fetch, await or client-selected quote enters a SQLite transaction.
    observe(owner, state, q) {
      check(instrument(q?.instrumentId) && Number.isSafeInteger(q.timestamp) && q.timestamp <= now() + 2000, 'INVALID_QUOTE');
      const id = q.instrumentId, slot = slotFor(owner, state, id);
      if (slot.base !== digest(state.quotes[id])) {
        // Another durable operation changed this instrument. Never use a stale
        // in-memory capacity baseline to overwrite its committed evidence.
        const durable = state.quotes[id];
        dropPayload(owner, id, slot);
        if (durable && durable.timestamp >= slot.timestamp) {
          slot.timestamp = durable.timestamp; slot.eventKey = digest(durable.eventId); slot.used = durable.used ?? '0.00000000';
        }
        slot.base = digest(durable);
      }
      if (q.timestamp < slot.timestamp) return { quote: null, ignored: true };
      slot.revision = state.revision;
      slot.active = hasOrders(state, id);
      const used = slot.eventKey === digest(q.eventId) ? slot.used : '0.00000000';
      slot.timestamp = q.timestamp; slot.eventKey = digest(q.eventId); slot.used = used; slot.failed = false;
      if (slot.recovery !== null && q.timestamp >= slot.recovery) slot.recovery = null;
      const observed = { ...q, used, ...(slot.recovery === null ? {} : { failed: true }) };
      retain(owner, id, slot, observed);
      return { quote: observed, ignored: false };
    },
    failed(owner, state, id) { const slot = slotFor(owner, state, id); slot.failed = true; if (slot.quote) retain(owner, id, slot, { ...slot.quote, failed: true }); },
    committed(owner, state, id) {
      // Only our acknowledged serial mutation may advance other projections.
      // An external writer changing the ledger revision instead invalidates
      // admission until another trusted observation has inspected that state.
      for (const [other, known] of entry(owner).slots) if (known.base === digest(state.quotes[other]) && (!hasOrders(state, other) || known.active)) known.revision = state.revision;
      if (!id) return;
      const slot = slotFor(owner, state, id), q = state.quotes[id];
      slot.base = digest(q);
      slot.revision = state.revision;
      slot.active = hasOrders(state, id);
      if (q && q.timestamp < slot.timestamp) { dropPayload(owner, id, slot); slot.failed = true; }
      else if (q) { slot.timestamp = q.timestamp; slot.eventKey = digest(q.eventId); slot.used = q.used ?? '0.00000000'; slot.failed = !!q.failed; retain(owner, id, slot, q); }
    },
    submit(owner, state, { order, sourceBlocked = false }, time) {
      // Canonical signature validation and durable same-ID recovery come first.
      // A retry must never rehydrate/re-match a new observation.
      if (state.orders.some(o => o.id === order?.id)) return submit(state, order, time);
      const id = order?.instrumentId, slot = slotFor(owner, state, id);
      const admitted = !sourceBlocked && usable(slot) && slot.revision === state.revision && slot.base === digest(state.quotes[id]);
      if (order?.type === 'MARKET') {
        check(admitted, 'QUOTE_STALE');
        const status = quoteStatus(slot.quote, time, order.currency); check(status === 'READY', status);
      }
      if (admitted) state.quotes[id] = structuredClone(slot.quote);
      else if (state.quotes[id]) state.quotes[id] = { ...state.quotes[id], failed: true };
      return submit(state, order, time);
    },
    count(durable) { counters[durable ? 'observationsDurable' : 'observationsVolatile']++; },
    metrics() { return { ...counters, observationBytes: bytes, observationMaxBytes: maxBytes, observationOwners: owners.size, observationSlots: [...owners.values()].reduce((n, a) => n + a.slots.size, 0) }; },
  };
}
