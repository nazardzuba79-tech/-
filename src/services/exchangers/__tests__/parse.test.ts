import { parseChangers, parseCurrencies, parsePairKey, parseRates } from '../parse';
import { BestChangeError } from '../errors';
import fixture from './fixtures/bestchange-openapi.json';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BestChangeError);
    expect((error as BestChangeError).message).toBe('BestChange API is unavailable');
    return (error as BestChangeError).code;
  }
  return undefined;
}

describe('parseCurrencies', () => {
  it('keeps every well-formed OpenAPI Currency row and drops a string id', () => {
    const list = parseCurrencies(fixture.currencies);
    expect(list.map((c) => c.id)).toEqual([9001, 9002, 9003, 9004, 9005, 9006, 9101, 9102, 9103]);
    expect(list[0]).toEqual({ id: 9001, name: 'СБП', urlname: 'sbp', code: 'SBPRUB', crypto: false, cash: false, viewname: 'СБП' });
  });

  it('drops rows with wrong types, duplicates, control characters or missing flags', () => {
    const list = parseCurrencies({
      currencies: [
        { id: 1, name: 'A', urlname: 'a', code: 'A', crypto: true, cash: false },
        { id: 1, name: 'dup', urlname: 'dup', code: 'D', crypto: true, cash: false },
        { id: 2, name: 'B', urlname: 'b', code: 'B', crypto: 'true', cash: false },
        { id: 3, name: 'C', urlname: 'c', code: 'C', crypto: true },
        { id: 4, name: 'bad\u0000name', urlname: 'd', code: 'D', crypto: true, cash: false },
        { id: 5, name: '   ', urlname: 'e', code: 'E', crypto: true, cash: false },
        { id: 6.5, name: 'F', urlname: 'f', code: 'F', crypto: true, cash: false },
        { id: -7, name: 'G', urlname: 'g', code: 'G', crypto: true, cash: false },
        { id: 8, name: 'H', urlname: '', code: 'H', crypto: true, cash: false },
        { id: 9, name: 'I', urlname: 'i', code: 9, crypto: true, cash: false },
        null,
        'row',
      ],
    });
    expect(list.map((c) => c.id)).toEqual([1]);
  });

  it('throws a fixed upstream error for a wrong root', () => {
    for (const bad of [null, [], 'x', 1, {}, { currencies: {} }, { currencies: 'x' }, { error: 'Invalid API key' }]) {
      expect(codeOf(() => parseCurrencies(bad))).toBe('upstream');
    }
  });

  it('accepts an empty list', () => {
    expect(parseCurrencies({ currencies: [] })).toEqual([]);
  });
});

describe('parseChangers', () => {
  const changers = parseChangers(fixture.changers);

  it('parses review counters given as numeric strings or numbers', () => {
    expect(changers.get(9201)?.reviews).toEqual({ positive: 390, neutral: 3, claim: 0, closed: 2 });
    expect(changers.get(9202)?.reviews).toEqual({ positive: 12, neutral: 0, claim: 1, closed: 0 });
  });

  it('nulls reviews with any non-counter value, and parses a numeric-string rating', () => {
    expect(changers.get(9204)?.reviews).toBeNull();
    expect(changers.get(9204)?.rating).toBe(4);
    expect(changers.get(9201)?.rating).toBe(5);
  });

  it('only an explicit `active: true` counts as active', () => {
    expect(changers.get(9201)?.active).toBe(true);
    expect(changers.get(9203)?.active).toBe(false);
    const parsed = parseChangers({ changers: [{ id: 1, name: 'X', active: 'true' }, { id: 2, name: 'Y' }] });
    expect(parsed.get(1)?.active).toBe(false);
    expect(parsed.get(2)?.active).toBe(false);
  });

  it('keeps only ru/en string urls (validation happens later) and nothing else', () => {
    expect(changers.get(9202)?.urls).toEqual({ ru: 'https://evil.example/click.php?id=9202', en: 'javascript:alert(1)' });
    const parsed = parseChangers({ changers: [{ id: 3, name: 'Z', active: true, urls: { ru: 5, de: 'https://x.example', en: ['a'] } }] });
    expect(parsed.get(3)?.urls).toEqual({});
    expect(parseChangers({ changers: [{ id: 4, name: 'W', active: true, urls: ['https://www.bestchange.ru/click.php?id=4'] }] }).get(4)?.urls).toEqual({});
  });

  it('drops rows without a positive integer id or a printable name', () => {
    const parsed = parseChangers({ changers: [{ id: '5', name: 'A', active: true }, { id: 6, name: '', active: true }, { id: 7, name: 'Line\nbreak', active: true }] });
    expect(parsed.size).toBe(0);
  });

  it('throws a fixed upstream error for a wrong root', () => {
    for (const bad of [null, [], { changers: null }, { changers: {} }]) {
      expect(codeOf(() => parseChangers(bad))).toBe('upstream');
    }
  });
});

describe('parseRates', () => {
  const rates = parseRates(fixture.rates);

  it('accepts only "from-to" keys and ignores city triples and junk', () => {
    expect([...rates.keys()].sort()).toEqual(['9001-9101', '9001-9102', '9002-9101', '9005-9101']);
    expect(parsePairKey('9001-9101')).toEqual([9001, 9101]);
    for (const bad of ['9001-9101-1', 'junk', '01-2', '1-', '-1-2', '1_2', '1-2 ', '12345678901-1']) expect(parsePairKey(bad)).toBeNull();
  });

  it('reads rate as a number or a numeric string, and rankrate/reserve/inmin/inmax as strings or numbers', () => {
    expect(rates.get('9005-9101')).toEqual([
      { changer: 9205, rate: 96, rankrate: 96.2, reserve: 77, inmin: 10, inmax: 20000, marks: ['card2card'] },
    ]);
    const first = rates.get('9001-9101')![0];
    expect(first).toEqual({ changer: 9201, rate: 0.0105, rankrate: 0.0104, reserve: 12345.6, inmin: 1000, inmax: 500000, marks: ['manual', 'verifying'] });
  });

  it('filters marks to the documented enum and de-duplicates them', () => {
    expect(rates.get('9001-9101')![0].marks).toEqual(['manual', 'verifying']);
  });

  it('keeps unparsable optional numbers as null and drops rows without changer or rate', () => {
    const row = rates.get('9001-9101')!.find((r) => r.changer === 9204 && r.rate === 94.1)!;
    expect(row.rankrate).toBeNull();
    const parsed = parseRates({ rates: { '1-2': [{ changer: 1 }, { rate: 5 }, { changer: '1', rate: 5 }, { changer: 1, rate: 'abc' }, { changer: 1, rate: 5, marks: 'manual' }] } });
    expect(parsed.get('1-2')).toEqual([{ changer: 1, rate: 5, rankrate: null, reserve: null, inmin: null, inmax: null, marks: [] }]);
  });

  it('accepts an empty array as "no rows" (empty map from a PHP-style encoder)', () => {
    expect(parseRates({ rates: [] }).size).toBe(0);
    expect(parseRates({ rates: {} }).size).toBe(0);
  });

  it('throws a fixed upstream error for a wrong root', () => {
    for (const bad of [null, [], {}, { rates: null }, { rates: [1] }, { rates: 'x' }]) {
      expect(codeOf(() => parseRates(bad))).toBe('upstream');
    }
  });
});
