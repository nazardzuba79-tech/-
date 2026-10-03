import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { DerivPublicStreamQuoteSource } from '../../services/marketData/cfd/DerivPublicStreamQuoteSource';

const discovery = [
  { symbol: 'frxEURUSD', display_name: 'EUR/USD', exchange_is_open: 1 },
  { symbol: 'frxGBPUSD', display_name: 'GBP/USD', exchange_is_open: 1 },
  { symbol: 'frxXAUUSD', display_name: 'Gold/USD', exchange_is_open: 1 },
];

class ContractSocket extends EventEmitter {
  requests: Record<string, unknown>[] = [];
  rejected: unknown[] = [];
  close = jest.fn();
  terminate = jest.fn();

  send(text: string) {
    const request = JSON.parse(text);
    this.requests.push(request);
    // Reproduce Deriv's wire contract: a string ID refuses the subscription.
    if (!Number.isInteger(request.req_id)) {
      this.rejected.push(request.req_id);
      this.emit('message', JSON.stringify({ error: { code: 'InputValidationFailed' }, req_id: request.req_id }));
    } else if (request.active_symbols) {
      this.emit('message', JSON.stringify({ msg_type: 'active_symbols', active_symbols: discovery, req_id: request.req_id }));
    } else if (request.ticks) {
      this.emit('message', JSON.stringify({ msg_type: 'tick', req_id: request.req_id,
        tick: { symbol: request.ticks, quote: 1.25, epoch: Math.floor(Date.now() / 1000) } }));
    }
  }
}

function fixture() {
  const sockets: ContractSocket[] = [];
  const source = new DerivPublicStreamQuoteSource({ shadow: true, reconnectBaseMs: 250,
    socketFactory: () => {
      const socket = new ContractSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { source, sockets };
}

describe('Deriv integer request IDs', () => {
  afterEach(() => jest.useRealTimers());

  test('discovery and every subscription use unique integer IDs on the wire', () => {
    const { source, sockets } = fixture();
    try {
      source.start(); sockets[0].emit('open');
      const requests = sockets[0].requests;
      expect(requests.filter(r => r.ticks).map(r => r.ticks).sort()).toEqual(discovery.map(r => r.symbol).sort());
      expect(requests).toHaveLength(discovery.length + 1);
      expect(requests.every(r => Number.isSafeInteger(r.req_id))).toBe(true);
      expect(new Set(requests.map(r => r.req_id)).size).toBe(requests.length);
      expect(sockets[0].rejected).toEqual([]);
    } finally { source.stop(); }
  });

  test.each(['initial', 'reconnect', 'restart'])('%s subscriptions are accepted and yield reference quotes without execution rights', async (mode) => {
    jest.useFakeTimers();
    const { source, sockets } = fixture();
    try {
      source.start(); sockets[0].emit('open');
      if (mode === 'reconnect') {
        sockets[0].emit('close'); jest.advanceTimersByTime(250); sockets[1].emit('open');
      } else if (mode === 'restart') {
        source.stop(); source.start(); sockets[1].emit('open');
      }
      const active = sockets[sockets.length - 1];
      expect(active.rejected).toEqual([]);
      expect(active.requests.filter(r => r.subscribe === 1)).toHaveLength(3);
      expect(source.diagnostics().lastError).toBeNull();
      const quotes = (await source.getQuotes()).filter(q => ['EURUSD', 'GBPUSD', 'XAUUSD'].includes(q.symbol));
      expect(quotes).toHaveLength(3);
      for (const quote of quotes) {
        expect(quote).toMatchObject({ provider: 'deriv', last: 1.25, referenceStatus: 'available', stale: false,
          entitlementVerified: false, executionAllowed: false });
      }
      expect(source.isConfigured()).toBe(false);
      await expect(source.getFreshQuote('EURUSD')).rejects.toThrow();
    } finally { source.stop(); }
  });
});
