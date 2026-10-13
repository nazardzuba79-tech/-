// OFFLINE CONTRACT PROTOTYPE. Not imported by any service, UI or runtime adapter.
// The injected fixture transport is the only transport: no WebSocket/fetch dependency.
import { instrument } from '../../stocks-global/catalog.mjs';
import { units, decimal } from '../../stocks-global/engine.mjs';

export function nativeTrade(symbol, message, receivedAt) {
  if (message?.e !== 'trade' || message.s !== symbol
      || !Number.isSafeInteger(message.t) || message.t < 0
      || !Number.isSafeInteger(message.T) || message.T < 0
      || !Number.isSafeInteger(receivedAt) || message.T > receivedAt + 2000
      || receivedAt - message.T > 60000) throw Error('INVALID_NATIVE_EVENT');
  // Match the existing REST adapter's positive/fixed policy exactly. This is
  // a contract proof, not permission to change rounding in the actual adapter.
  const input = String(message.p);
  if (!/^\d+(\.\d+)?$/.test(input)) throw Error('INVALID_NATIVE_EVENT');
  const [whole, fraction = ''] = input.split('.');
  const price = decimal(units(whole + '.' + fraction.padEnd(8, '0').slice(0, 8), true));
  return { eventId: String(message.t), timestamp: message.T, receivedAt,
    bid: price, ask: price, last: price, capacity: '1.00000000' };
}

export class OfflineNativeDemand {
  constructor({ fixtureTransport, now = Date.now, maxEntries = 20, maxReaders = 100 }) {
    if (fixtureTransport?.offlineFixture !== true) throw Error('OFFLINE_FIXTURE_REQUIRED');
    this.transport = fixtureTransport; this.now = now;
    this.maxEntries = maxEntries; this.maxReaders = maxReaders;
    this.entries = new Map(); this.nextGeneration = 0;
    this.cleanupErrors = []; this.cleanupFailureCount = 0;
  }
  closeConnection(connection) {
    if (!connection) return;
    try { connection.close(); } catch {
      this.cleanupFailureCount++;
      if (this.cleanupErrors.length < 100) this.cleanupErrors.push({ code: 'FIXTURE_CLOSE_FAILED', unresolved: true });
    }
  }
  acquire(id) {
    const item = instrument(id);
    if (item?.provider !== 'binance' || item.currency !== 'USDT') throw Error('UNSUPPORTED_CONTRACT');
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= this.maxEntries) throw Error('DEMAND_LIMIT');
      entry = { item, readers: 0, generation: ++this.nextGeneration, attempts: 0,
        connection: null, nextAt: null, quote: null, last: null };
      this.entries.set(id, entry);
    }
    if (entry.readers >= this.maxReaders) throw Error('DEMAND_LIMIT');
    entry.readers++;
    if (!entry.connection && entry.attempts === 0) this.connect(entry);
    let released = false;
    return { read: () => {
      if (released) return null;
      const q = entry.quote;
      return q && this.now() - q.receivedAt <= 2000 && this.now() - q.timestamp <= 60000
        ? structuredClone(q) : null;
    }, release: () => {
      if (released) return;
      released = true;
      if (!entry.readers) return;
      if (--entry.readers === 0) {
        this.entries.delete(id); entry.generation = ++this.nextGeneration;
        const connection = entry.connection;
        entry.connection = null; entry.nextAt = null; entry.quote = null;
        this.closeConnection(connection);
      }
    } };
  }
  connect(entry) {
    if (!entry.readers || entry.attempts >= 3) return;
    const generation = entry.generation = ++this.nextGeneration;
    entry.attempts++;
    const current = () => entry.readers > 0 && entry.generation === generation;
    const disconnected = () => {
      if (!current()) return;
      entry.generation = ++this.nextGeneration;
      entry.connection = null; entry.quote = null;
      entry.nextAt = entry.attempts < 3 ? this.now() + 1000 * 2 ** (entry.attempts - 1) : null;
    };
    try {
      const connection = this.transport.open(entry.item.sourceSymbol, {
      message: message => {
        if (!current()) return;
        let quote;
        try { quote = nativeTrade(entry.item.sourceSymbol, message, this.now()); }
        catch { return; }
        const old = entry.last;
        if (old && (BigInt(quote.eventId) < BigInt(old.eventId) || quote.timestamp < old.timestamp)) return;
        // Repeated events cannot rejuvenate freshness or replenish capacity.
        if (old?.eventId === quote.eventId) return;
        entry.quote = quote; entry.last = quote;
      },
        disconnect: disconnected,
      });
      if (typeof connection?.close !== 'function') throw Error('INVALID_FIXTURE_CONNECTION');
      if (current()) entry.connection = connection;
      else this.closeConnection(connection);
    } catch {
      // Failed opens are owned by the existing reader and bounded by the same
      // retry policy, never an inaccessible extra reader or stale connection.
      disconnected();
    }
  }
  // Explicit fixture clock step; never an unbounded background reconnect loop.
  step() {
    for (const entry of this.entries.values()) {
      if (entry.nextAt !== null && this.now() >= entry.nextAt) {
        entry.nextAt = null; this.connect(entry);
      }
    }
  }
  close() {
    const connections = [];
    for (const entry of this.entries.values()) {
      entry.readers = 0; entry.generation = ++this.nextGeneration;
      if (entry.connection) connections.push(entry.connection);
      entry.connection = null; entry.nextAt = null; entry.quote = null;
    }
    this.entries.clear();
    for (const connection of connections) this.closeConnection(connection);
    return { attempted: connections.length, cleanupFailureCount: this.cleanupFailureCount,
      cleanupErrors: structuredClone(this.cleanupErrors) };
  }
}
