/**
 * RUB amount parsing and ru-RU number formatting for «Обменники».
 * Pure; shared by the Express router (query validation) and the page.
 */

export const RUB_AMOUNT_MIN = 1;
export const RUB_AMOUNT_MAX = 100_000_000;

const NBSP = ' ';
const MAX_INPUT_LENGTH = 32;

function isGroupSeparator(ch: string): boolean {
  return ch === ' ' || ch === ' ' || ch === ' ';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) if (!isDigit(s[i])) return false;
  return true;
}

/**
 * Parses a user-entered RUB amount. Accepts digits, optional thousands grouping
 * with a single space / NBSP / narrow NBSP between groups of three, and at most
 * ONE decimal separator ('.' or ',') followed by 1–2 digits. Anything else —
 * signs, exponents, letters, two separators ("1,234.56"), 3+ fraction digits
 * ("1.234", ambiguous), a trailing separator — returns null, as does a value
 * outside RUB_AMOUNT_MIN..RUB_AMOUNT_MAX. Leading/trailing whitespace is ignored.
 */
export function parseRubAmount(input: unknown): number | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) return null;
  let start = 0;
  let end = input.length;
  while (start < end && isGroupSeparator(input[start])) start++;
  while (end > start && isGroupSeparator(input[end - 1])) end--;
  const s = input.slice(start, end);
  if (s.length === 0) return null;

  let sepIndex = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '.' || ch === ',') {
      if (sepIndex !== -1) return null;
      sepIndex = i;
    } else if (!isDigit(ch) && !isGroupSeparator(ch)) {
      return null;
    }
  }

  const intRaw = sepIndex === -1 ? s : s.slice(0, sepIndex);
  const frac = sepIndex === -1 ? '' : s.slice(sepIndex + 1);
  if (sepIndex !== -1 && (frac.length < 1 || frac.length > 2 || !isDigits(frac))) return null;

  // Integer part: plain digits, or groups "d{1,3}( d{3})*" with one separator between groups.
  const groups: string[] = [];
  let current = '';
  for (let i = 0; i < intRaw.length; i++) {
    const ch = intRaw[i];
    if (isGroupSeparator(ch)) {
      groups.push(current);
      current = '';
    } else current += ch;
  }
  groups.push(current);
  if (!groups.every(isDigits)) return null;
  if (groups.length > 1) {
    if (groups[0].length > 3) return null;
    for (let i = 1; i < groups.length; i++) if (groups[i].length !== 3) return null;
  }
  const intDigits = groups.join('');
  if (intDigits.length > 1 && intDigits[0] === '0') return null;

  const value = Number(frac ? `${intDigits}.${frac}` : intDigits);
  if (!Number.isFinite(value) || value < RUB_AMOUNT_MIN || value > RUB_AMOUNT_MAX) return null;
  return value;
}

function formatNumber(value: number, maxDecimals: number, minDecimals: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

const DASH = '—';

/** "10 000 ₽", "95,12 ₽" (ru-RU grouping, NBSP before the sign). Non-finite → "—". */
export function formatRub(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return DASH;
  return `${formatNumber(value, maxDecimals, 0)}${NBSP}₽`;
}

/**
 * "105,13 USDT", "0,001234 BTC". `decimals` is the asset's displayDecimals;
 * at least min(2, decimals) fraction digits are kept. Symbol is optional.
 * Non-finite → "—".
 */
export function formatCrypto(value: number, decimals: number, symbol?: string): string {
  if (!Number.isFinite(value)) return DASH;
  const max = Number.isInteger(decimals) && decimals >= 0 && decimals <= 20 ? decimals : 8;
  const text = formatNumber(value, max, Math.min(2, max));
  return symbol ? `${text}${NBSP}${symbol}` : text;
}
