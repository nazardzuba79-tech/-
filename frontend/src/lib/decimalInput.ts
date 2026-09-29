/**
 * A number typed into the Futures order ticket, read WITHOUT being changed.
 *
 * Owner review of #332 (2026-09-29): the previous reader deleted every
 * character it did not expect, so «1e-8» became 18, «1e3» 13, «-1» 1,
 * «1.2.3» 1.23 and «12abc34» 1234 — a different, valid-looking price or size
 * sitting in an order ticket. Now the field keeps exactly what was typed and
 * this only READS it:
 *
 *  - digits with at most one separator, a dot or a comma, is a number whose
 *    value is the same digits with a dot («12,91» → "12.91", «.5» → "0.5");
 *  - nothing, or a lone separator, is still being typed and has no value;
 *  - anything else — a sign, an exponent, a letter, a space inside, a second
 *    separator — is refused with its reason and is never a value.
 *
 * The value is a STRING of the typed digits (leading zeros dropped, trailing
 * zeros kept), so a long precise size reaches the engine digit for digit
 * rather than through a float.
 */
export type DecimalRefusal = 'exponent' | 'sign' | 'separator' | 'character';

export type DecimalInput =
  | { status: 'empty'; value: null }
  | { status: 'incomplete'; value: null }
  | { status: 'valid'; value: string }
  | { status: 'invalid'; value: null; reason: DecimalRefusal };

const NUMBER = /^(\d*)(?:[.,](\d*))?$/;

function refusal(text: string): DecimalRefusal {
  if (/^[+\-−]/.test(text)) return 'sign';
  if (/^(?:\d+[.,]?\d*|[.,]\d+)[eE][+\-]?\d*$/.test(text)) return 'exponent';
  if (/^[\d.,]+$/.test(text)) return 'separator';
  return 'character';
}

export function readDecimalInput(raw: string): DecimalInput {
  const text = raw.trim();
  if (text === '') return { status: 'empty', value: null };
  const match = NUMBER.exec(text);
  if (!match) return { status: 'invalid', value: null, reason: refusal(text) };
  const [, whole, fraction = ''] = match;
  if (whole === '' && fraction === '') return { status: 'incomplete', value: null };
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  return { status: 'valid', value: fraction ? `${integer}.${fraction}` : integer };
}

/** Whether what is in the field stands in the way of an order: something is
 *  there, and it is not a number. An empty field is the caller's to judge. */
export function decimalUnreadable(input: DecimalInput): boolean {
  return input.status === 'invalid' || input.status === 'incomplete';
}

/**
 * A number the TERMINAL puts in a field (the last price, a chart bar's
 * close), written in plain digits. `String(0.0000001)` is "1e-7", which the
 * reader above refuses; the digits are moved, never rounded, so the value is
 * the same one. Any other text comes back as it was.
 */
export function plainDecimal(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+\-]?\d+)$/.exec(text.trim());
  if (!match) return text;
  const [, sign, whole, fraction = '', exponentText] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponentText);
  let out: string;
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + (out.replace(/^0+(?=\d)/, '') || '0');
}

/** `plainDecimal` for a number; nothing for one that is not finite. */
export function decimalFromNumber(value: number): string {
  return Number.isFinite(value) ? plainDecimal(String(value)) : '';
}
