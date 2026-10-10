import { check, units, decimal, SYMBOLS, SimError } from './engine.mjs';

// Only a read-only quote URL is constructible. No broker/exchange order APIs.
export class TwelveDataQuotes {
  constructor({ apiKey = '', fetchImpl = fetch, now = Date.now } = {}) {
    this.apiKey = apiKey; this.fetch = fetchImpl; this.now = now;
    this.starts = []; this.daily = 0; this.day = ''; this.busy = false;
  }
  async quote(symbol) {
    check(SYMBOLS.includes(symbol), 'INVALID_PAIR');
    if (!this.apiKey && symbol !== 'AAPL') throw new SimError('SOURCE_KEY_REQUIRED');
    const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.daily = 0; }
    this.starts = this.starts.filter(t => now - t < 60_000);
    check(!this.busy, 'PROVIDER_BUSY');
    check(this.starts.length < 8 && this.daily < 800, 'PROVIDER_RATE_LIMIT');
    this.starts.push(now); this.daily++; this.busy = true;
    try {
      const url = new URL('https://api.twelvedata.com/quote');
      for (const [key, value] of Object.entries({ symbol, interval: '1min', timezone: 'UTC', prepost: 'false', apikey: this.apiKey || 'demo' })) url.searchParams.set(key, value);
      const response = await this.fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000) });
      check(response.ok, response.status === 429 ? 'PROVIDER_RATE_LIMIT' : response.status === 401 || response.status === 403 ? 'SOURCE_KEY_REQUIRED' : 'PROVIDER_UNAVAILABLE');
      check(!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= 65536, 'INVALID_QUOTE');
      const reader = response.body.getReader(); let bytes = 0, parts = [];
      try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; check(bytes <= 65536, 'INVALID_QUOTE'); parts.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const raw = JSON.parse(Buffer.concat(parts).toString('utf8'));
      check(raw.status !== 'error' && raw.symbol === symbol && raw.currency === 'USD' && raw.exchange === 'NASDAQ', 'INVALID_QUOTE');
      check(typeof raw.is_market_open === 'boolean' && Number.isSafeInteger(raw.timestamp), 'INVALID_QUOTE');
      check(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw.datetime), 'INVALID_QUOTE');
      check(Date.parse(raw.datetime.replace(' ', 'T') + 'Z') === raw.timestamp * 1000, 'INVALID_QUOTE');
      return { symbol, currency: 'USD', priceUsd: decimal(units(raw.close, true)), timestamp: raw.timestamp * 1000,
        receivedAt: this.now(), marketOpen: raw.is_market_open, provider: 'Twelve Data', interval: '1min' };
    } catch (error) { if (error instanceof SimError) throw error; throw new SimError('PROVIDER_UNAVAILABLE'); }
    finally { this.busy = false; }
  }
}
