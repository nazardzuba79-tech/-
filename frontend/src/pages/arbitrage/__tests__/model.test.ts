import {
  computeArbitrage,
  createForm,
  formatNumber,
  formatPercent,
  formatPrice,
  getScenarioRows,
  NUMERIC_FIELDS,
  parseArbitrageForm,
  resetForm,
  SCENARIOS,
  selectPair,
  TABLE_BUDGET,
  type NumericField,
  type Scenario,
} from '../model';

const exactScenario: Scenario = {
  pair: 'TEST/USDT', buyVenue: 'Площадка A', buy: 100,
  sellVenue: 'Площадка B', sell: 120,
  feeBuy: 1, feeSell: 2, slipBuy: 1, slipSell: 5, extra: 7,
};

describe('arbitrage calculations', () => {
  test('accounts for both fees and slippage within the initial buy budget', () => {
    // 10 assets cost 1,010 + 10.10 buy fee; sell for 1,140 - 22.80 - 7.
    const result = computeArbitrage(createForm(exactScenario, '1020.10'));
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected a valid calculation');
    expect(result.quantity).toBeCloseTo(10, 12);
    expect(result.buyExecutionPrice).toBe(101);
    expect(result.sellExecutionPrice).toBe(114);
    expect(result.buyFee).toBeCloseTo(10.1, 12);
    expect(result.sellFee).toBeCloseTo(22.8, 12);
    expect(result.buySlippage).toBeCloseTo(10, 12);
    expect(result.sellSlippage).toBeCloseTo(60, 12);
    expect(result.totalCosts).toBeCloseTo(109.9, 10);
    expect(result.proceeds).toBeCloseTo(1110.2, 10);
    expect(result.net).toBeCloseTo(90.1, 10);
    expect(result.roi).toBeCloseTo(8.832467405156357, 10);
    expect(result.grossSpread).toBeCloseTo(20, 10);
    expect(result.quantity * result.buyExecutionPrice + result.buyFee).toBeCloseTo(1020.1, 10);
    expect(result.quantity * (120 - 100) - result.totalCosts).toBeCloseTo(result.net, 10);
  });

  test('has zero costs when every cost is explicitly zero', () => {
    const result = computeArbitrage(createForm({ ...exactScenario,
      feeBuy: 0, feeSell: 0, slipBuy: 0, slipSell: 0, extra: 0 }, '1000'));
    expect(result).toMatchObject({ valid: true, quantity: 10, totalCosts: 0, proceeds: 1200, net: 200, roi: 20 });
  });

  test('keeps negative proceeds and losses when expenses exceed proceeds', () => {
    const result = computeArbitrage(createForm({ ...exactScenario, extra: 2000 }, '1020.10'));
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected a valid calculation');
    expect(result.proceeds).toBeCloseTo(-882.8, 10);
    expect(result.net).toBeCloseTo(-1902.9, 10);
    expect(result.roi).toBeLessThan(-100);
  });

  test('does not round quantity before accounting for the proceeds', () => {
    const result = computeArbitrage(createForm({ ...exactScenario, buy: 3, sell: 7,
      feeBuy: 0, feeSell: 0, slipBuy: 0, slipSell: 0, extra: 0 }, '1'));
    expect(result).toMatchObject({ valid: true, quantity: 1 / 3 });
    if (!result.valid) throw new Error('Expected a valid calculation');
    expect(result.proceeds).toBeCloseTo(7 / 3, 14);
  });

  test('table, calculator and breakdown inputs use an identical calculation', () => {
    for (const row of getScenarioRows()) {
      const calculator = computeArbitrage(createForm(row.scenario, String(TABLE_BUDGET)));
      const breakdown = computeArbitrage(createForm(row.scenario));
      expect(row.result).toEqual(calculator);
      expect(breakdown).toEqual(calculator);
    }
  });

  test('retains archive prices and both profitable and loss-making examples', () => {
    expect(SCENARIOS).toHaveLength(8);
    expect(SCENARIOS.find((scenario) => scenario.pair === 'ETH/USDT')).toMatchObject({ buy: 3124.8, sell: 3162.4 });
    expect(getScenarioRows({ filter: 'negative' }).map((row) => row.scenario.pair).sort()).toEqual(['LINK/USDT', 'XRP/USDT']);
    expect(getScenarioRows({ filter: 'positive' })).toHaveLength(6);
    expect(new Set(SCENARIOS.flatMap(({ buyVenue, sellVenue }) => [buyVenue, sellVenue])))
      .toEqual(new Set(['Площадка A', 'Площадка B', 'Площадка C']));
  });
});

describe('arbitrage input validation', () => {
  test.each(NUMERIC_FIELDS)('rejects blank %s rather than coercing it to zero', (field) => {
    const form = { ...createForm(), [field]: '' };
    expect(parseArbitrageForm(form)).toMatchObject({ valid: false, errors: { [field]: expect.any(String) } });
    expect(computeArbitrage(form)).not.toHaveProperty('net');
  });

  test.each(['NaN', 'Infinity', '-Infinity', '1e309', 'not a number', '0x10', '1,2,3', '   '])('rejects invalid numeric input %j', (value) => {
    expect(computeArbitrage({ ...createForm(), budget: value })).toMatchObject({ valid: false, errors: { budget: expect.any(String) } });
  });

  test.each(['budget', 'buy', 'sell'] as NumericField[])('rejects zero and negative %s', (field) => {
    for (const value of ['0', '-0', '-0.01']) {
      expect(computeArbitrage({ ...createForm(), [field]: value })).toMatchObject({ valid: false, errors: { [field]: expect.any(String) } });
    }
  });

  test.each(['feeBuy', 'feeSell', 'slipBuy', 'slipSell', 'extra'] as NumericField[])('rejects negative %s', (field) => {
    expect(computeArbitrage({ ...createForm(), [field]: '-0.1' })).toMatchObject({ valid: false, errors: { [field]: expect.any(String) } });
  });

  test.each(['feeBuy', 'feeSell', 'slipBuy', 'slipSell'] as NumericField[])('rejects %s at and above 100 percent', (field) => {
    for (const value of ['100', '101']) {
      expect(computeArbitrage({ ...createForm(), [field]: value })).toMatchObject({ valid: false, errors: { [field]: expect.any(String) } });
    }
  });

  test('accepts decimal commas and trims only for parsing, retaining the raw form', () => {
    const form = { ...createForm(), budget: ' 1000,50 ', feeBuy: '0,1' };
    const result = computeArbitrage(form);
    expect(result).toMatchObject({ valid: true, values: { budget: 1000.5, feeBuy: 0.1 } });
    expect(form.budget).toBe(' 1000,50 ');
  });

  test('reports all invalid fields together', () => {
    const form = { ...createForm(), budget: '', buy: '0', feeBuy: '-1', extra: 'Infinity' };
    expect(computeArbitrage(form)).toMatchObject({ valid: false, errors: {
      budget: expect.any(String), buy: expect.any(String), feeBuy: expect.any(String), extra: expect.any(String),
    } });
  });

  test.each([
    { budget: '1e308', buy: '1e-308' },
    { budget: '1e-308', buy: '1e308' },
    { buy: '1e308', slipBuy: '99', feeBuy: '99' },
    { budget: '1e308', sell: '1e308' },
  ])('rejects arithmetic overflow or underflow: %j', (patch) => {
    expect(computeArbitrage({ ...createForm(), ...patch })).toMatchObject({
      valid: false, errors: { calculation: expect.any(String) },
    });
  });
});

describe('scenario state, filters and sorting', () => {
  test('selecting ETH changes all BTC parameters and keeps the exact raw budget', () => {
    const previous = { ...createForm(), budget: '001234,50', buy: '99', extra: '77' };
    expect(selectPair(previous, 'ETH/USDT')).toEqual(createForm(SCENARIOS[1], '001234,50'));
    expect(previous.buy).toBe('99');
  });

  test('selecting a pair preserves a blank budget rather than filling one in', () => {
    expect(selectPair({ ...createForm(), budget: '' }, 'SOL/USDT')).toEqual(createForm(SCENARIOS[2], ''));
  });

  test('unknown pairs leave the form unchanged instead of re-labelling current prices', () => {
    const form = createForm();
    expect(selectPair(form, 'UNKNOWN/USDT')).toBe(form);
  });

  test('reset returns a fresh default form without changing scenario seeds', () => {
    const reset = resetForm();
    expect(reset).toEqual(createForm(SCENARIOS[0], '10000'));
    reset.buy = '1';
    expect(resetForm().buy).toBe('84320.5');
    expect(SCENARIOS[0].buy).toBe(84320.5);
  });

  test('search is case-insensitive, trimmed and combined with result filters', () => {
    expect(getScenarioRows({ query: ' eTh ' }).map((row) => row.scenario.pair)).toEqual(['ETH/USDT']);
    expect(getScenarioRows({ query: 'XRP', filter: 'positive' })).toEqual([]);
    expect(getScenarioRows({ query: 'XRP', filter: 'negative' })).toHaveLength(1);
    expect(getScenarioRows({ query: 'no-match' })).toEqual([]);
  });

  test('sorts spread and net result independently using the stated table budget', () => {
    const scenarios: Scenario[] = [
      { ...exactScenario, pair: 'AAA/USDT', buy: 100, sell: 103, feeBuy: 0, feeSell: 0, slipBuy: 0, slipSell: 0, extra: 1000 },
      { ...exactScenario, pair: 'BBB/USDT', buy: 100, sell: 102, feeBuy: 0, feeSell: 0, slipBuy: 0, slipSell: 0, extra: 0 },
    ];
    expect(getScenarioRows({ sort: 'spread' }, scenarios).map((row) => row.scenario.pair)).toEqual(['AAA/USDT', 'BBB/USDT']);
    expect(getScenarioRows({ sort: 'result' }, scenarios).map((row) => row.scenario.pair)).toEqual(['BBB/USDT', 'AAA/USDT']);
    expect(getScenarioRows({ sort: 'pair' }, [...scenarios].reverse()).map((row) => row.scenario.pair)).toEqual(['AAA/USDT', 'BBB/USDT']);
    expect(scenarios[0].pair).toBe('AAA/USDT');
  });

  test('invalid scenarios never become a fabricated zero-result table row', () => {
    expect(getScenarioRows({}, [{ ...exactScenario, buy: 0 }])).toEqual([]);
  });

  test('formats grouped percentages only at display time and never renders unavailable numbers as zero', () => {
    expect(formatPercent(12345.6789).replace(/\s/g, ' ')).toBe('+12 345,68%');
    expect(formatPercent(-12.345)).toBe('-12,35%');
    expect(formatNumber(12345.6789).replace(/\s/g, ' ')).toBe('12 345,68');
    expect(formatNumber(NaN)).toBe('—');
    expect(formatPercent(Infinity)).toBe('—');
    expect(formatPercent(-0)).toBe('+0,00%');
  });

  test('preserves requested small-price precision and formats large finite inputs safely', () => {
    expect(formatNumber(0.06728, 5)).toBe('0,06728');
    expect(formatNumber(0.06815, 5)).toBe('0,06815');
    expect(formatNumber(1e100)).not.toMatch(/NaN|Infinity/);
    expect(formatNumber(12.345, NaN)).toBe('12,35');
    expect(() => formatNumber(12.345, 999)).not.toThrow();
  });

  test('keeps small valid scenario prices distinct instead of showing two zero prices', () => {
    expect(formatPrice(0.000001)).toBe('0,000001');
    expect(formatPrice(0.0000011)).toBe('0,0000011');
    expect(formatPrice(0.000001123456789)).toBe('0,0000011234568');
    expect(formatPrice(0.06728)).toBe('0,06728');
    expect(formatPrice(84320.5).replace(/\s/g, ' ')).toBe('84 320,50');
  });

  test.each([Number.MIN_VALUE, 1e-300, 1e-14, 1e15, 1e100, Number.MAX_VALUE])('uses readable nonzero scientific notation for extreme finite price %s', (value) => {
    const displayed = formatPrice(value);
    expect(displayed).toMatch(/^[1-9](?:,\d+)?E-?\d+$/);
    expect(displayed.length).toBeLessThan(20);
    expect(displayed).not.toMatch(/NaN|Infinity/);
  });

  test.each([0, -1, NaN, Infinity, -Infinity])('does not present invalid price %s as a valid zero', (value) => {
    expect(formatPrice(value)).toBe('—');
  });
});
