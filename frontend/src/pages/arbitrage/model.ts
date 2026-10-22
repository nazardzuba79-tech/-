/** Local price examples. They are not quotes or executable trading instructions. */
export type Scenario = {
  pair: string;
  buyVenue: string;
  buy: number;
  sellVenue: string;
  sell: number;
  feeBuy: number;
  feeSell: number;
  slipBuy: number;
  slipSell: number;
  extra: number;
};

export const NUMERIC_FIELDS = ['budget', 'buy', 'sell', 'feeBuy', 'feeSell', 'slipBuy', 'slipSell', 'extra'] as const;
export type NumericField = typeof NUMERIC_FIELDS[number];
export type FormState = Pick<Scenario, 'pair' | 'buyVenue' | 'sellVenue'> & Record<NumericField, string>;
export type NumericForm = Scenario & { budget: number };
export type ValidationErrors = Partial<Record<NumericField | 'calculation', string>>;
export type InvalidResult = { valid: false; errors: ValidationErrors };
export type ValidResult = {
  valid: true;
  values: NumericForm;
  quantity: number;
  buyExecutionPrice: number;
  sellExecutionPrice: number;
  buyFee: number;
  sellFee: number;
  buySlippage: number;
  sellSlippage: number;
  proceeds: number;
  /** Quoted price difference, as a percentage of the quoted buy price. */
  grossSpread: number;
  net: number;
  roi: number;
  totalCosts: number;
};
export type ArbitrageResult = ValidResult | InvalidResult;

export const TABLE_BUDGET = 10_000;

export const SCENARIOS: readonly Scenario[] = [
  { pair: 'BTC/USDT', buyVenue: 'Площадка A', buy: 84320.5, sellVenue: 'Площадка B', sell: 85210.3, feeBuy: .1, feeSell: .1, slipBuy: .05, slipSell: .05, extra: 4 },
  { pair: 'ETH/USDT', buyVenue: 'Площадка B', buy: 3124.8, sellVenue: 'Площадка C', sell: 3162.4, feeBuy: .12, feeSell: .1, slipBuy: .08, slipSell: .05, extra: 5 },
  { pair: 'SOL/USDT', buyVenue: 'Площадка C', buy: 195.2, sellVenue: 'Площадка A', sell: 198.9, feeBuy: .12, feeSell: .12, slipBuy: .1, slipSell: .08, extra: 7 },
  { pair: 'XRP/USDT', buyVenue: 'Площадка A', buy: 2.184, sellVenue: 'Площадка C', sell: 2.189, feeBuy: .15, feeSell: .15, slipBuy: .12, slipSell: .1, extra: 4 },
  { pair: 'TON/USDT', buyVenue: 'Площадка C', buy: 5.214, sellVenue: 'Площадка B', sell: 5.298, feeBuy: .1, feeSell: .1, slipBuy: .06, slipSell: .05, extra: 4 },
  { pair: 'DOGE/USDT', buyVenue: 'Площадка B', buy: .06728, sellVenue: 'Площадка A', sell: .06815, feeBuy: .15, feeSell: .15, slipBuy: .1, slipSell: .1, extra: 5 },
  { pair: 'AVAX/USDT', buyVenue: 'Площадка A', buy: 27.18, sellVenue: 'Площадка B', sell: 27.62, feeBuy: .1, feeSell: .1, slipBuy: .08, slipSell: .06, extra: 6 },
  { pair: 'LINK/USDT', buyVenue: 'Площадка B', buy: 14.82, sellVenue: 'Площадка C', sell: 14.76, feeBuy: .12, feeSell: .12, slipBuy: .1, slipSell: .1, extra: 5 },
];

export function createForm(scenario: Scenario = SCENARIOS[0], budget = String(TABLE_BUDGET)): FormState {
  return {
    pair: scenario.pair, buyVenue: scenario.buyVenue, sellVenue: scenario.sellVenue, budget,
    buy: String(scenario.buy), sell: String(scenario.sell), feeBuy: String(scenario.feeBuy), feeSell: String(scenario.feeSell),
    slipBuy: String(scenario.slipBuy), slipSell: String(scenario.slipSell), extra: String(scenario.extra),
  };
}

/** A pair is a whole scenario: never retain another asset's prices under its label. */
export function selectPair(form: FormState, pair: string, scenarios: readonly Scenario[] = SCENARIOS): FormState {
  const scenario = scenarios.find((item) => item.pair === pair);
  return scenario ? createForm(scenario, form.budget) : form;
}

export function resetForm(): FormState {
  return createForm();
}

export function parseArbitrageForm(form: FormState): { valid: true; values: NumericForm } | InvalidResult {
  const errors: ValidationErrors = {};
  const parsed = {} as Record<NumericField, number>;
  for (const field of NUMERIC_FIELDS) {
    const raw = form[field].trim();
    if (raw === '') {
      errors[field] = 'Введите значение.';
      continue;
    }
    // Accept decimal commas without accepting hexadecimal or a partially parsed number.
    const normalized = raw.replace(',', '.');
    const value = Number(normalized);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized) || !Number.isFinite(value)) {
      errors[field] = 'Введите конечное число.';
    } else if ((field === 'budget' || field === 'buy' || field === 'sell') && value <= 0) {
      errors[field] = 'Значение должно быть больше нуля.';
    } else if (value < 0) {
      errors[field] = 'Значение не может быть отрицательным.';
    } else if (field !== 'budget' && field !== 'buy' && field !== 'sell' && field !== 'extra' && value >= 100) {
      errors[field] = 'Укажите значение меньше 100%.';
    } else {
      parsed[field] = value;
    }
  }
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true, values: { pair: form.pair, buyVenue: form.buyVenue, sellVenue: form.sellVenue, ...parsed } };
}

/**
 * The initial budget includes the purchase fee. Extra costs are deducted from the
 * sale proceeds. Each slippage amount is evaluated for the actual bought quantity,
 * so quoted gross profit minus every cost reconciles to the same final result.
 * Keep full precision here; formatting is the only rounding boundary.
 */
export function computeArbitrage(form: FormState): ArbitrageResult {
  const parsed = parseArbitrageForm(form);
  if (!parsed.valid) return parsed;
  const values = parsed.values;
  const buyExecutionPrice = values.buy * (1 + values.slipBuy / 100);
  const sellExecutionPrice = values.sell * (1 - values.slipSell / 100);
  const quantity = values.budget / (buyExecutionPrice * (1 + values.feeBuy / 100));
  const buyFee = quantity * buyExecutionPrice * values.feeBuy / 100;
  const sellFee = quantity * sellExecutionPrice * values.feeSell / 100;
  const buySlippage = quantity * (buyExecutionPrice - values.buy);
  const sellSlippage = quantity * (values.sell - sellExecutionPrice);
  const proceeds = quantity * sellExecutionPrice - sellFee - values.extra;
  const net = proceeds - values.budget;
  const roi = net / values.budget * 100;
  const grossSpread = (values.sell / values.buy - 1) * 100;
  const totalCosts = buyFee + sellFee + buySlippage + sellSlippage + values.extra;
  const amounts = { quantity, buyExecutionPrice, sellExecutionPrice, buyFee, sellFee,
    buySlippage, sellSlippage, proceeds, grossSpread, net, roi, totalCosts };
  if (!Object.values(amounts).every(Number.isFinite) || quantity <= 0 || buyExecutionPrice <= 0 || sellExecutionPrice <= 0) {
    return { valid: false, errors: { calculation: 'Значения слишком велики или малы для расчёта. Измените параметры.' } };
  }
  return { valid: true, values, ...amounts };
}

export type ScenarioFilter = 'all' | 'positive' | 'negative';
export type ScenarioSort = 'spread' | 'result' | 'pair';
export type ScenarioRow = { scenario: Scenario; result: ValidResult };

export function getScenarioRows(
  options: { query?: string; filter?: ScenarioFilter; sort?: ScenarioSort } = {},
  scenarios: readonly Scenario[] = SCENARIOS,
): ScenarioRow[] {
  const { query = '', filter = 'all', sort = 'result' } = options;
  const normalizedQuery = query.trim().toLowerCase();
  const rows: ScenarioRow[] = [];
  for (const scenario of scenarios) {
    if (!scenario.pair.toLowerCase().includes(normalizedQuery)) continue;
    const result = computeArbitrage(createForm(scenario));
    if (!result.valid) continue;
    if (filter === 'positive' && result.net < 0) continue;
    if (filter === 'negative' && result.net >= 0) continue;
    rows.push({ scenario, result });
  }
  return rows.sort((a, b) => {
    if (sort === 'pair') return a.scenario.pair.localeCompare(b.scenario.pair);
    const difference = sort === 'spread' ? b.result.grossSpread - a.result.grossSpread : b.result.net - a.result.net;
    return difference || a.scenario.pair.localeCompare(b.scenario.pair);
  });
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const fractionDigits = Number.isInteger(digits) ? Math.min(20, Math.max(0, digits)) : 2;
  return (value === 0 ? 0 : value).toLocaleString('ru-RU', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

/** Keep small positive prices distinguishable instead of rounding them to zero. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1e-13 || value >= 1e15) {
    return value.toLocaleString('ru-RU', { notation: 'scientific', maximumSignificantDigits: 8 });
  }
  if (value < 1) {
    const maximumFractionDigits = Math.min(20, Math.max(5, 7 - Math.floor(Math.log10(value))));
    return value.toLocaleString('ru-RU', { minimumFractionDigits: 5, maximumFractionDigits });
  }
  return formatNumber(value, value < 10 ? 4 : 2);
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${formatNumber(value, digits)}%`;
}
