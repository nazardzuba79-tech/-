import { parseFredBrentCsv, parseGoldApiReference, HomeCommodityReferenceError } from '../HomeCommodityReferenceService';

const now = Date.parse('2026-09-12T20:00:00Z');

describe('HomeCommodityReferenceService parsing', () => {
  test('accepts a fresh real gold reference', () => {
    expect(parseGoldApiReference({ price: 4323.1, updatedAt: '2026-09-12T19:59:30Z' }, now)).toEqual({
      price: 4323.1,
      observedAt: Date.parse('2026-09-12T19:59:30Z'),
      source: 'gold-api',
      label: 'XAU/USD',
    });
  });

  test.each([
    { price: 0, updatedAt: '2026-09-12T19:59:30Z' },
    { price: 'bad', updatedAt: '2026-09-12T19:59:30Z' },
    { price: 4323.1, updatedAt: '2026-09-12T19:30:00Z' },
  ])('rejects malformed or stale gold rather than inventing a value: %j', payload => {
    expect(() => parseGoldApiReference(payload, now)).toThrow(HomeCommodityReferenceError);
  });

  test('selects the latest published non-missing EIA Brent observation', () => {
    const csv = [
      'observation_date,DCOILBRENTEU',
      '2026-09-08,106.12',
      '2026-09-09,109.51',
      '2026-09-10,.',
    ].join('\n');
    expect(parseFredBrentCsv(csv, now)).toEqual({
      price: 109.51,
      observedAt: Date.parse('2026-09-09T23:59:59Z'),
      source: 'eia',
      label: 'Brent spot · EIA · USD/bbl',
    });
  });

  test('rejects stale or unusable oil data', () => {
    expect(() => parseFredBrentCsv('observation_date,DCOILBRENTEU\n2026-08-20,88.50', now)).toThrow(HomeCommodityReferenceError);
    expect(() => parseFredBrentCsv('observation_date,DCOILBRENTEU\n2026-09-09,.', now)).toThrow(HomeCommodityReferenceError);
  });
});
