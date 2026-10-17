import { isWaitingForCurrentQuote, type QuoteReadiness } from '../../pages/stocks/global/quoteReadiness';
import type { State } from '../../pages/stocks/global/types';

const NOW = Date.UTC(2026, 9, 16, 14);
const ID = 'BYBIT:AAPLXUSDT';
const hint = (patch: Partial<QuoteReadiness> = {}): QuoteReadiness => ({
  state: 'WAITING_FOR_QUOTE', reason: 'BEFORE_DEMAND', executable: false,
  quoteTimestamp: NOW - 10000, receivedAt: NOW - 1000, demandSince: NOW - 5000,
  ...patch,
});

describe('Stocks informational pre-demand quote readiness', () => {
  const truthTable = ['QUOTE_STALE', 'READY'].flatMap(error =>
    ['WAITING_FOR_QUOTE', 'READY'].flatMap(state =>
      ['BEFORE_DEMAND', 'QUOTE_FAILED'].flatMap(reason =>
        [false, true, undefined].map(executable => ({
          error, state, reason, executable,
          expected: error === 'QUOTE_STALE' && state === 'WAITING_FOR_QUOTE' &&
            reason === 'BEFORE_DEMAND' && executable === false,
        })))));

  test.each(truthTable)('strict hint discriminants: $error / $state / $reason / $executable', row => {
    const candidate = { ...hint(), state: row.state, reason: row.reason, executable: row.executable } as unknown as QuoteReadiness;
    expect(isWaitingForCurrentQuote(candidate, row.error, NOW)).toBe(row.expected);
  });

  test.each([
    '', 'quote_stale', 'QUOTE_UNAVAILABLE', 'INVALID_QUOTE', 'MARKET_CLOSED',
    'FX_UNAVAILABLE', 'FX_STALE', 'SOURCE_UNAVAILABLE', 'SOURCE_BLOCKED',
    'RATE_LIMIT', 'ACCOUNT_BUSY', 'AUTH_REQUIRED',
  ])('does not relabel another authoritative error: %s', error => {
    expect(isWaitingForCurrentQuote(hint(), error, NOW)).toBe(false);
  });

  test('missing, null and incomplete transport hints cannot create a waiting state', () => {
    for (const candidate of [undefined, null, {}, { reason: 'BEFORE_DEMAND' }, { state: 'WAITING_FOR_QUOTE' }]) {
      expect(isWaitingForCurrentQuote(candidate as QuoteReadiness | undefined, 'QUOTE_STALE', NOW)).toBe(false);
    }
  });

  test.each([
    { age: 29999, expected: true },
    { age: 30000, expected: true },
    { age: 30001, expected: false },
  ])('receipt age fence is inclusive at 30 seconds: $age ms', ({ age, expected }) => {
    expect(isWaitingForCurrentQuote(hint({ receivedAt: NOW - age }), 'QUOTE_STALE', NOW)).toBe(expected);
  });

  test.each([
    { delay: 0, age: 59999, expected: true },
    { delay: 0, age: 60000, expected: true },
    { delay: 0, age: 60001, expected: false },
    { delay: 900, age: 959999, expected: true },
    { delay: 900, age: 960000, expected: true },
    { delay: 900, age: 960001, expected: false },
  ])('respects declared delay without renewing quote age: $delay s / $age ms', ({ delay, age, expected }) => {
    expect(isWaitingForCurrentQuote(hint({ quoteTimestamp: NOW - age }), 'QUOTE_STALE', NOW, delay)).toBe(expected);
  });

  test('provider delay cannot extend the receipt freshness fence', () => {
    expect(isWaitingForCurrentQuote(hint({ quoteTimestamp: NOW - 900000, receivedAt: NOW - 30001 }), 'QUOTE_STALE', NOW, 900)).toBe(false);
  });

  test('only quotes strictly before current demand receive the hint', () => {
    expect(isWaitingForCurrentQuote(hint({ quoteTimestamp: NOW - 5001 }), 'QUOTE_STALE', NOW)).toBe(true);
    expect(isWaitingForCurrentQuote(hint({ quoteTimestamp: NOW - 5000 }), 'QUOTE_STALE', NOW)).toBe(false);
    expect(isWaitingForCurrentQuote(hint({ quoteTimestamp: NOW - 4999 }), 'QUOTE_STALE', NOW)).toBe(false);
    expect(isWaitingForCurrentQuote(hint({ demandSince: NOW }), 'QUOTE_STALE', NOW)).toBe(true);
  });

  test.each(['quoteTimestamp', 'receivedAt', 'demandSince'] as const)('rejects future %s', field => {
    expect(isWaitingForCurrentQuote(hint({ [field]: NOW + 1 }), 'QUOTE_STALE', NOW)).toBe(false);
  });

  test.each(['quoteTimestamp', 'receivedAt', 'demandSince', 'now'] as const)('requires a positive, safe integer %s', field => {
    const valid = hint({ quoteTimestamp: 1, receivedAt: 2, demandSince: 3 });
    expect(isWaitingForCurrentQuote(valid, 'QUOTE_STALE', 4)).toBe(true);
    for (const invalid of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, undefined]) {
      const candidate = field === 'now' ? valid : { ...valid, [field]: invalid } as unknown as QuoteReadiness;
      const now = field === 'now' ? invalid as number : 4;
      expect(isWaitingForCurrentQuote(candidate, 'QUOTE_STALE', now)).toBe(false);
    }
  });

  test('invalid or overflowing provider delay fails closed', () => {
    for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, '900', null]) {
      expect(isWaitingForCurrentQuote(hint(), 'QUOTE_STALE', NOW, invalid as number)).toBe(false);
    }
    expect(isWaitingForCurrentQuote(hint(), 'QUOTE_STALE', NOW, undefined)).toBe(true);
  });

  test('presentation preserves the authoritative stale error and non-executable hint', () => {
    const readiness = Object.freeze(hint());
    const view: Pick<State, 'errors' | 'readiness'> = Object.freeze({
      errors: Object.freeze({ [ID]: 'QUOTE_STALE' }), readiness: Object.freeze({ [ID]: readiness }),
    });
    const before = JSON.stringify(view);
    expect(isWaitingForCurrentQuote(view.readiness?.[ID], view.errors[ID], NOW)).toBe(true);
    expect(view.errors[ID]).toBe('QUOTE_STALE');
    expect(view.readiness?.[ID].executable).toBe(false);
    expect(JSON.stringify(view)).toBe(before);
    expect(isWaitingForCurrentQuote(view.readiness?.[ID], view.errors[ID], NOW + 30001)).toBe(false);
    expect(JSON.stringify(view)).toBe(before);
  });
});
