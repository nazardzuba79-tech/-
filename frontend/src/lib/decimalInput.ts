/** Decimal drafts stay text until they are known to be complete and valid. */
export type DecimalRefusal = 'exponent' | 'sign' | 'separator' | 'character';

export type DecimalInput =
  | { status: 'empty'; value: null }
  | { status: 'incomplete'; value: null }
  | { status: 'valid'; value: string }
  | { status: 'invalid'; value: null; reason: DecimalRefusal };

const DECIMAL = /^(\d*)(?:[.,](\d*))?$/;

function refusal(text: string): DecimalRefusal {
  if (/^[+\-−]/.test(text)) return 'sign';
  if (/^(?:\d+[.,]?\d*|[.,]\d+)[eE][+\-]?\d*$/.test(text)) return 'exponent';
  if (/^[\d.,]+$/.test(text)) return 'separator';
  return 'character';
}

/**
 * Read the whole draft, without stripping unsupported characters or rounding
 * through Number. A trailing separator remains an unfinished editing state.
 * Whitespace is refused too, matching the ticket's existing manual-input rule.
 */
export function readDecimalInput(raw: string): DecimalInput {
  if (raw === '') return { status: 'empty', value: null };
  const match = DECIMAL.exec(raw);
  // `$` alone also matches before a final newline; require the whole string.
  if (!match || match[0] !== raw) return { status: 'invalid', value: null, reason: refusal(raw) };
  const [, whole, fraction = ''] = match;
  if ((whole === '' && fraction === '') || /[.,]$/.test(raw)) {
    return { status: 'incomplete', value: null };
  }
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  return { status: 'valid', value: fraction ? `${integer}.${fraction}` : integer };
}

export function decimalUnreadable(input: DecimalInput): boolean {
  return input.status === 'invalid' || input.status === 'incomplete';
}

/**
 * Expand scientific notation only for programmatic prices, never for typed
 * drafts. Preserve the source digits rather than round to a display precision.
 * Out-of-range values stay unchanged so an invalid external string cannot
 * request an unbounded zero-filled allocation or silently become zero.
 */
export function plainDecimal(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+\-]?\d+)$/.exec(text);
  if (!match || match[0] !== text) return text;
  const [, sign, whole, fraction = '', exponentText] = match;
  const digits = whole + fraction;
  if (!/[1-9]/.test(digits)) return sign + '0';
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric === 0) return text;
  const point = whole.length + Number(exponentText);
  let expanded: string;
  if (point <= 0) expanded = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) expanded = digits + '0'.repeat(point - digits.length);
  else expanded = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + (expanded.replace(/^0+(?=\d)/, '') || '0');
}

export function decimalFromNumber(value: number): string {
  return Number.isFinite(value) ? plainDecimal(String(value)) : '';
}
