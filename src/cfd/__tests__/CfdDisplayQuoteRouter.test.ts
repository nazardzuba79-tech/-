import { CfdDisplayQuoteRouter } from '../../services/marketData/cfd/CfdDisplayQuoteRouter';
import { CFD_REFERENCE_CATALOG } from '../../services/marketData/cfd/catalog';
import type { CfdQuote } from '../../services/marketData/cfd/CfdQuote';

const now = Date.UTC(2026, 8, 13, 9, 0, 0);

function quote(symbol: string, provider: string, price: number, at = now, over: Partial<CfdQuote> = {}): CfdQuote {
  const providerSymbol = CFD_REFERENCE_CATALOG.find(row => row.symbol === symbol)?.providerSymbol ?? symbol;
  return {
    provider,
    symbol,
    providerSymbol,
    bid: null,
    ask: null,
    mid: price,
    last: price,
    providerTimestamp: at,
    fetchedAt: at,
    stale: false,
    status: 'live',
    referenceStatus: 'available',
    entitlementVerified: true,
    executionAllowed: true,
    ...over,
  };
}

function source(rows: CfdQuote[]) {
  return { getQuotes: jest.fn(async () => rows) };
}

test('routes each symbol independently and strips all execution permission', async () => {
  const primary = source([
    quote('XAUUSD', 'primary', 2400),
    quote('EURUSD', 'primary', 1.1, now - 300_000, { stale: true, status: 'stale', referenceStatus: 'stale' }),
  ]);
  const reserve = source([
    quote('XAUUSD', 'reserve', 2399.5),
    quote('EURUSD', 'reserve', 1.2),
  ]);
  const router = new CfdDisplayQuoteRouter([
    { id: 'primary', priority: 10, source: primary },
    { id: 'reserve', priority: 20, source: reserve },
  ], { now: () => now, providerWaitMs: 100, freshAgeMs: 120_000 });

  const rows = await router.getQuotes();
  expect(rows).toHaveLength(13);
  expect(rows.find(row => row.symbol === 'XAUUSD')).toMatchObject({ provider: 'primary', last: 2400, status: 'reference_only' });
  expect(rows.find(row => row.symbol === 'EURUSD')).toMatchObject({ provider: 'reserve', last: 1.2, status: 'reference_only' });
  expect(rows.every(row => row.executionAllowed === false && row.entitlementVerified === false)).toBe(true);
});

test('one provider failure does not blank healthy symbols from another source', async () => {
  const failed = { getQuotes: jest.fn(async () => { throw new Error('down'); }) };
  const reserve = source(CFD_REFERENCE_CATALOG.map((row, index) => quote(row.symbol, 'reserve', 1 + index)));
  const router = new CfdDisplayQuoteRouter([
    { id: 'failed', priority: 10, source: failed },
    { id: 'reserve', priority: 20, source: reserve },
  ], { now: () => now, providerWaitMs: 100, freshAgeMs: 120_000 });

  const rows = await router.getQuotes();
  expect(rows).toHaveLength(13);
  expect(rows.every(row => row.provider === 'reserve' && row.last !== null)).toBe(true);
});

test('never substitutes one canonical instrument for another', async () => {
  const provider = source([quote('XBRUSD', 'oil', 80)]);
  const router = new CfdDisplayQuoteRouter([{ id: 'oil', priority: 10, source: provider }], {
    now: () => now, providerWaitMs: 100, freshAgeMs: 120_000,
  });
  const rows = await router.getQuotes();
  expect(rows.find(row => row.symbol === 'XBRUSD')?.last).toBe(80);
  expect(rows.find(row => row.symbol === 'WTIUSD')).toMatchObject({ last: null, status: 'unavailable' });
});

test('a fresh financial/reference primary wins; a current alternative replaces unavailable primary for display only', () => {
  const router = new CfdDisplayQuoteRouter([{ id: 'reserve', priority: 10, source: source([]) }], {
    now: () => now, providerWaitMs: 100, freshAgeMs: 120_000,
  });
  const fresh = quote('XAUUSD', 'primary', 2400);
  const alternative = quote('XAUUSD', 'reserve', 2399);
  expect(router.choose(fresh, alternative).provider).toBe('primary');
  const missing = quote('XAUUSD', 'primary', 1, now, { last: null, mid: null, status: 'unavailable', referenceStatus: 'unavailable' });
  expect(router.choose(missing, alternative).provider).toBe('reserve');
});
