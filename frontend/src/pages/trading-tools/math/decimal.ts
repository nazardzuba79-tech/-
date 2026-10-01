import BigNumber from 'bignumber.js';
import type { Errors, Failure } from './types';

// Isolated from all trading modules. Downward division keeps risk sizing conservative.
export const Decimal = BigNumber.clone({ DECIMAL_PLACES: 160, ROUNDING_MODE: BigNumber.ROUND_DOWN, EXPONENTIAL_AT: 1e9, RANGE: 1e9 });
export type DecimalValue = BigNumber;
export const INPUT_LIMITS = { integerDigits: 30, fractionalDigits: 24, rawCharacters: 96 } as const;
export type ParseOptions = { positive?: boolean; nonnegative?: boolean; percent?: boolean; risk?: boolean; leverage?: boolean; integer?: boolean };
export type ParsedDecimal = { ok: true; value: string } | { ok: false; status: 'incomplete' | 'invalid'; message: string };

export function parseDecimal(raw: string, options: ParseOptions = {}): ParsedDecimal {
  if (typeof raw !== 'string' || raw.length > INPUT_LIMITS.rawCharacters) return { ok: false, status: 'invalid', message: 'Слишком длинное число.' };
  const trimmed = raw.trim();
  if (['', '-', '+', '.', ','].includes(trimmed)) return { ok: false, status: 'incomplete', message: 'Введите значение.' };
  if (trimmed.includes('.') && trimmed.includes(',')) return { ok: false, status: 'invalid', message: 'Используйте один десятичный разделитель.' };
  // Spaces are accepted only as complete thousands groups in the integer part.
  if (!/^[+-]?(?:(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d*)?|\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed)) {
    return { ok: false, status: 'invalid', message: 'Введите десятичное число без экспоненты.' };
  }
  const normalized = trimmed.replace(/[ \u00a0\u202f]/g, '').replace(',', '.').replace(/^([+-]?)\./, '$10.');
  const [whole, fraction = ''] = normalized.replace(/^[+-]/, '').split('.');
  if (whole.length > INPUT_LIMITS.integerDigits || fraction.length > INPUT_LIMITS.fractionalDigits) {
    return { ok: false, status: 'invalid', message: 'Допустимо до 30 цифр до разделителя и 24 после.' };
  }
  const value = new Decimal(normalized);
  if (!value.isFinite()) return { ok: false, status: 'invalid', message: 'Введите конечное число.' };
  if (options.positive && !value.gt(0)) return { ok: false, status: 'invalid', message: 'Значение должно быть больше нуля.' };
  if (options.nonnegative && value.lt(0)) return { ok: false, status: 'invalid', message: 'Значение не может быть отрицательным.' };
  if (options.percent && (value.lt(0) || value.gte(100))) return { ok: false, status: 'invalid', message: 'Укажите ставку от 0 до менее 100%.' };
  if (options.risk && (!value.gt(0) || value.gt(100))) return { ok: false, status: 'invalid', message: 'Риск должен быть больше 0 и не больше 100%.' };
  if (options.leverage && value.lt(1)) return { ok: false, status: 'invalid', message: 'Плечо должно быть не меньше 1.' };
  if (options.integer && (!value.isInteger() || value.lt(0))) return { ok: false, status: 'invalid', message: 'Укажите целое неотрицательное число.' };
  return { ok: true, value: value.isZero() ? '0' : value.toFixed() };
}

export class Reader {
  errors: Errors = {};
  private invalid = false;
  read(key: string, raw: string, options: ParseOptions = {}): DecimalValue {
    const parsed = parseDecimal(raw, options);
    if (!parsed.ok) {
      this.errors[key] = parsed.message;
      if (parsed.status === 'invalid') this.invalid = true;
      return new Decimal(0);
    }
    return new Decimal(parsed.value);
  }
  rate(key: string, raw: string): DecimalValue { return this.read(key, raw, { percent: true }).div(100); }
  fail(key: string, message: string): void { this.errors[key] = message; this.invalid = true; }
  result(): Failure | null {
    return Object.keys(this.errors).length ? { ok: false, status: this.invalid ? 'invalid' : 'incomplete', errors: this.errors } : null;
  }
}

export function exact(value: DecimalValue): string { return value.isZero() ? '0' : value.toFixed(); }
export function direction(side: 'long' | 'short'): DecimalValue { return new Decimal(side === 'short' ? -1 : 1); }

/** String-only formatting: no financial values are converted to binary floats. */
export function formatDecimal(raw: string, options: { minDecimals?: number; maxDecimals?: number; signed?: boolean } = {}): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(raw) || raw.length > 1000) return '—';
  const min = Math.max(0, Math.min(24, options.minDecimals ?? 2));
  const max = Math.max(min, Math.min(60, options.maxDecimals ?? 8));
  const value = new Decimal(raw);
  let text = value.toFixed(value.abs().gte(1) ? min : max, BigNumber.ROUND_HALF_UP);
  if (!value.isZero() && new Decimal(text).isZero()) {
    const threshold = max === 0 ? '1' : `0,${'0'.repeat(max - 1)}1`;
    return value.isNegative() ? `−<${threshold}` : `${options.signed ? '+' : ''}<${threshold}`;
  }
  let [integer, fraction = ''] = text.split('.');
  while (fraction.length > min && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  if (value.isZero()) integer = '0';
  const sign = integer.startsWith('-') ? '−' : options.signed && !value.isZero() ? '+' : '';
  integer = integer.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + integer + (fraction ? ',' + fraction : '');
}
export function formatPercent(raw: string): string { return `${formatDecimal(raw, { minDecimals: 2, maxDecimals: 8 })}%`; }
export function compareDecimal(left: string, right = '0'): -1 | 0 | 1 { return new Decimal(left).comparedTo(new Decimal(right)) as -1 | 0 | 1; }

/** Coordinates are decimal strings bounded to [0,100]; only these may become SVG Numbers. */
export function normalizeLevels(values: string[]): string[] {
  if (!values.length || values.some((value) => !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 1000)) return [];
  const parsed = values.map((value) => new Decimal(value));
  const lo = Decimal.minimum(...parsed); const hi = Decimal.maximum(...parsed);
  if (hi.eq(lo)) return parsed.map(() => '50');
  return parsed.map((value) => exact(value.minus(lo).div(hi.minus(lo)).times(100)));
}
